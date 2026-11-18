import fs from 'fs';
import { CheckedMedia, Representation, shiftSegment } from '../../media';
import { LoadedStream } from '../../modules/streams';
import { TimelineInput, availableFirst, diskPosition, isAvailable, lastAvailable, playlistFirst } from './timeline';

// Responses of the live simulator: HLS media and master playlists (4.4), MPD
// (4.5), for one stream or for all the streams of a service, and segments
// (4.6). Each one is a function of the declaration, the files and the clock.

export type LiveMedia = {
    stream: LoadedStream;
    media: CheckedMedia;
};

export type MpdDocument = {
    body: string;
    publishTimeMs: number;
};

export type SegmentResult =
    | { kind: 'ok'; body: Buffer }
    | { kind: 'not-yet' }
    | { kind: 'out-of-window' };

type StreamWindow = {
    live: LiveMedia;
    first: number;
    last: number;
    publishTimeMs: number;
};

const HLS_VERSION = 6;
const MPD_PROFILE = 'http://dashif.org/guidelines/dash-atsc-main';
const COMPONENT_TAG_SCHEME = 'urn:sbtvd:dash:component-tag';
const PRESENTATION_DELAY_SEGMENTS = 3;
const MS_PER_SECOND = 1000;

export function timelineOf(stream: LoadedStream, media: CheckedMedia): TimelineInput {
    return {
        availabilityStartMs: stream.availabilityStartMs,
        timescale: stream.declaration.timescale,
        segmentDuration: media.segmentDuration,
        segmentCount: stream.declaration.segmentCount,
        windowSize: stream.declaration.windowSize,
    };
}

// Null when no segment is available yet.
export function mediaPlaylist(stream: LoadedStream, media: CheckedMedia, nowMs: number): string | null {
    const timeline = timelineOf(stream, media);
    const last = lastAvailable(timeline, nowMs);
    if (last < 1) {
        return null;
    }
    const first = playlistFirst(timeline, last);
    const extinf = (media.segmentDuration / timeline.timescale).toFixed(3);
    const lines = [
        '#EXTM3U',
        `#EXT-X-VERSION:${HLS_VERSION}`,
        `#EXT-X-TARGETDURATION:${Math.ceil(stream.declaration.nominalDuration)}`,
        `#EXT-X-MEDIA-SEQUENCE:${first}`,
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-MAP:URI="init.mp4"',
    ];
    for (let segmentNumber = first; segmentNumber <= last; segmentNumber++) {
        lines.push(`#EXTINF:${extinf},`);
        lines.push(`seg/${segmentNumber}.m4s`);
    }
    return `${lines.join('\n')}\n`;
}

export function masterPlaylist(video: LoadedStream, audio: LoadedStream): string {
    const videoRepresentation = video.declaration.representation;
    const audioRepresentation = audio.declaration.representation;
    const bandwidth = videoRepresentation.bandwidth + audioRepresentation.bandwidth;
    const codecs = `${videoRepresentation.codecs},${audioRepresentation.codecs}`;
    const resolution = `${videoRepresentation.width}x${videoRepresentation.height}`;
    const frameRate = frameRateValue(videoRepresentation).toFixed(3);
    const audioId = audio.declaration.streamId;
    const lines = [
        '#EXTM3U',
        `#EXT-X-VERSION:${HLS_VERSION}`,
        '#EXT-X-INDEPENDENT-SEGMENTS',
        `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${audioId}",DEFAULT=YES,AUTOSELECT=YES,`
            + `URI="../${audioId}/playlist.m3u8"`,
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="${codecs}",RESOLUTION=${resolution},`
            + `FRAME-RATE=${frameRate},AUDIO="audio"`,
        'playlist.m3u8',
    ];
    return `${lines.join('\n')}\n`;
}

// Null when some stream has no segment available yet. The timeline of each
// stream lists exactly its available segments (4.7), so the document
// changes with each new segment of any stream. All streams share the
// availabilityStartTime of the first one, which the loader enforces.
export function mpd(streams: LiveMedia[], liveBaseUrl: string, nowMs: number): MpdDocument | null {
    const windows: StreamWindow[] = [];
    for (const live of streams) {
        const timeline = timelineOf(live.stream, live.media);
        const last = lastAvailable(timeline, nowMs);
        if (last < 1) {
            return null;
        }
        const publishTimeMs = live.stream.availabilityStartMs
            + Math.floor(last * live.media.segmentDuration * MS_PER_SECOND / timeline.timescale);
        windows.push({ live, first: availableFirst(timeline, last), last, publishTimeMs });
    }
    const declarations = streams.map((live) => live.stream.declaration);
    const nominals = declarations.map((declaration) => declaration.nominalDuration);
    const depths = declarations.map((declaration) => declaration.windowSize * declaration.nominalDuration);
    const longest = Math.max(...nominals);
    const publishTimeMs = Math.max(...windows.map((window) => window.publishTimeMs));
    const publishTime = new Date(publishTimeMs).toISOString().replace('.000Z', 'Z');

    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<MPD${attributes([
            ['xmlns', 'urn:mpeg:dash:schema:mpd:2011'],
            ['type', 'dynamic'],
            ['profiles', MPD_PROFILE],
            ['availabilityStartTime', declarations[0].availabilityStartTime],
            ['publishTime', publishTime],
            ['minimumUpdatePeriod', isoDuration(Math.min(...nominals))],
            ['timeShiftBufferDepth', isoDuration(Math.min(...depths))],
            ['maxSegmentDuration', isoDuration(longest)],
            ['minBufferTime', isoDuration(longest)],
            ['suggestedPresentationDelay', isoDuration(PRESENTATION_DELAY_SEGMENTS * longest)],
        ])}>`,
        `  <BaseURL>${escapeXml(liveBaseUrl)}</BaseURL>`,
        '  <Period id="0" start="PT0S">',
    ];
    windows.forEach((window, index) => {
        lines.push(...adaptationSet(window, index + 1));
    });
    lines.push('  </Period>');
    lines.push('</MPD>');
    return { body: `${lines.join('\n')}\n`, publishTimeMs };
}

export function segment(stream: LoadedStream, media: CheckedMedia, segmentNumber: number, nowMs: number):
    SegmentResult {
    const timeline = timelineOf(stream, media);
    const last = lastAvailable(timeline, nowMs);
    if (last < 1) {
        return { kind: 'not-yet' };
    }
    if (!isAvailable(timeline, last, segmentNumber)) {
        return { kind: 'out-of-window' };
    }
    const position = diskPosition(timeline, segmentNumber);
    const bytes = fs.readFileSync(media.segmentPaths[position.index]);
    const timeDelta = BigInt(position.lap) * BigInt(stream.declaration.lapDuration);
    const sequenceDelta = position.lap * stream.declaration.segmentCount;
    const body = shiftSegment(bytes, media.segmentPatches[position.index], timeDelta, sequenceDelta);
    return { kind: 'ok', body };
}

function adaptationSet(window: StreamWindow, id: number): string[] {
    const { stream, media } = window.live;
    const declaration = stream.declaration;
    const representation = declaration.representation;
    const contentType = representation.mimeType === 'video/mp4' ? 'video' : 'audio';
    const firstTime = media.firstDecodeTime + BigInt(window.first - 1) * BigInt(media.segmentDuration);
    const repeat = window.last - window.first;

    const representationAttributes: [string, string][] = [
        ['id', declaration.streamId],
        ['mimeType', representation.mimeType],
        ['codecs', representation.codecs],
        ['bandwidth', String(representation.bandwidth)],
    ];
    if (representation.width !== undefined && representation.height !== undefined
        && representation.frameRate !== undefined) {
        representationAttributes.push(['width', String(representation.width)]);
        representationAttributes.push(['height', String(representation.height)]);
        representationAttributes.push(['frameRate', representation.frameRate]);
    }
    if (representation.audioSamplingRate !== undefined) {
        representationAttributes.push(['audioSamplingRate', String(representation.audioSamplingRate)]);
    }

    return [
        `    <AdaptationSet${attributes([
            ['id', String(id)],
            ['contentType', contentType],
            ['mimeType', representation.mimeType],
        ])}>`,
        `      <BaseURL>${escapeXml(declaration.streamId)}/</BaseURL>`,
        `      <SupplementalProperty${attributes([
            ['schemeIdUri', COMPONENT_TAG_SCHEME],
            ['value', declaration.componentTag],
        ])}/>`,
        `      <RandomAccess${attributes([['type', 'closed'], ['interval', String(media.segmentDuration)]])}/>`,
        `      <SegmentTemplate${attributes([
            ['timescale', String(declaration.timescale)],
            ['presentationTimeOffset', media.firstDecodeTime.toString()],
            ['startNumber', String(window.first)],
            ['initialization', 'init.mp4'],
            ['media', 'seg/$Number$.m4s'],
        ])}>`,
        `        <SegmentTimeline><S${attributes([
            ['t', firstTime.toString()],
            ['d', String(media.segmentDuration)],
            ['r', String(repeat)],
        ])}/></SegmentTimeline>`,
        '      </SegmentTemplate>',
        `      <Representation${attributes(representationAttributes)}/>`,
        '    </AdaptationSet>',
    ];
}

function frameRateValue(representation: Representation): number {
    const [numerator, denominator] = (representation.frameRate ?? '0').split('/');
    return Number(numerator) / Number(denominator ?? '1');
}

function isoDuration(seconds: number): string {
    return `PT${Number(seconds.toFixed(3))}S`;
}

function attributes(pairs: [string, string][]): string {
    return pairs.map(([name, value]) => ` ${name}="${escapeXml(value)}"`).join('');
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
