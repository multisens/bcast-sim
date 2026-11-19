import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseArgs } from 'util';
import logger from '../logger';
import { InitInfo, StreamDeclaration, checkStream, readSegment, segmentFileName, streamDeclarationSchema } from '../media';
import { ComponentPlan, DurationPlan, Rational, decodeTimeOffsetSeconds, planDurations, toSeconds } from './durations';
import { encodeAudio, encodeVideo, probeSource } from './encode';
import { splitFragmented } from './split';

// Content preparation tool: one source file in, one video and one audio stream
// out, each with its segments and its stream declaration.

type Options = {
    source: string;
    servicesDir: string;
    serviceId: string;
    videoStreamId: string;
    audioStreamId: string;
    segmentDuration: number;
    maxLapDuration: number | null;
    availabilityStartTime: string;
    windowSize: number;
    videoEncoder: string;
    videoBitrate: string;
    audioEncoder: string;
    audioBitrate: string;
    audioFrameSize: number;
};

type Prepared = {
    declaration: StreamDeclaration;
    mediaDir: string;
};

const USAGE = `usage: prepare-content --source <file> --services-dir <dir> --service-id <id>
    --video-stream-id <id> --audio-stream-id <id> [--segment-duration <s>] [--max-lap-duration <s>]
    [--availability-start <ISO 8601>] [--window-size <n>] [--video-encoder <ffmpeg encoder>]
    [--video-bitrate <rate>] [--audio-encoder <ffmpeg encoder>] [--audio-bitrate <rate>]
    [--audio-frame-size <samples>]`;
const SEGMENT_TEMPLATE = 'seg-%06d.m4s';
const INIT_SEGMENT = 'init.mp4';
const STREAMS_DIR = 'fluxos';
const MEDIA_DIR = 'segmentos';
const BITS_PER_BYTE = 8;

function main(): void {
    const options = readOptions(process.argv.slice(2));
    const source = probeSource(options.source);
    const plan = planDurations({
        videoFrameRate: source.videoFrameRate,
        audioSampleRate: source.audioSampleRate,
        audioFrameSize: options.audioFrameSize,
        sourceSeconds: source.durationSeconds,
        maxLapSeconds: options.maxLapDuration,
        targetSegmentSeconds: options.segmentDuration,
    });
    logPlan(plan);

    const offsetSeconds = decodeTimeOffsetSeconds([plan.video.timescale, plan.audio.timescale]);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-content-'));
    try {
        const videoFile = path.join(workDir, 'video.mp4');
        const audioFile = path.join(workDir, 'audio.mp4');
        encodeVideo(options.source, videoFile, plan.video, {
            encoder: options.videoEncoder, bitrate: options.videoBitrate, frameRate: source.videoFrameRate });
        encodeAudio(options.source, audioFile, plan.lap, plan.audio, {
            encoder: options.audioEncoder, bitrate: options.audioBitrate, sampleRate: source.audioSampleRate });

        const video = prepareComponent(videoFile, workDir, options.videoStreamId, plan.video, offsetSeconds,
            options, source.videoFrameRate, options.audioStreamId);
        const audio = prepareComponent(audioFile, workDir, options.audioStreamId, plan.audio, offsetSeconds,
            options, source.videoFrameRate, null);
        checkSameLap(video.declaration, audio.declaration);
        install(options, [video, audio]);
    }
    finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

// Splits, names and checks the segments of one component and writes its
// stream declaration.
function prepareComponent(encodedFile: string, workDir: string, streamId: string, plan: ComponentPlan,
    offsetSeconds: number, options: Options, frameRate: Rational, audioStreamId: string | null): Prepared {
    const decodeTimeOffset = BigInt(offsetSeconds) * BigInt(plan.timescale);
    const split = splitFragmented(fs.readFileSync(encodedFile), decodeTimeOffset);
    if (split.segments.length < plan.segmentCount) {
        throw new Error(`${streamId}: encoder produced ${split.segments.length} fragments, `
            + `${plan.segmentCount} required`);
    }
    const extra = split.segments.length - plan.segmentCount;
    if (extra > 0) {
        logger.info(`${streamId}: discarding ${extra} fragment(s) beyond the lap`);
    }
    const segments = split.segments.slice(0, plan.segmentCount);

    const mediaDir = path.join(workDir, MEDIA_DIR, streamId);
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, INIT_SEGMENT), split.init);

    const durations: number[] = [];
    const decodeTimes: bigint[] = [];
    let peakBandwidth = 0;
    for (const [index, bytes] of segments.entries()) {
        const info = readSegment(bytes, split.initInfo);
        if (split.initInfo.kind === 'video' && !info.firstSampleIsSync) {
            throw new Error(`${streamId}: segment ${index} does not start with a key frame`);
        }
        durations.push(info.duration);
        decodeTimes.push(info.firstDecodeTime);
        const bandwidth = Math.ceil(bytes.length * BITS_PER_BYTE * plan.timescale / info.duration);
        peakBandwidth = Math.max(peakBandwidth, bandwidth);
        fs.writeFileSync(path.join(mediaDir, segmentFileName(SEGMENT_TEMPLATE, index)), bytes);
    }
    const last = segments.length - 1;
    const lapDuration = Number(decodeTimes[last] + BigInt(durations[last]) - decodeTimes[0]);

    const declaration = streamDeclarationSchema.parse({
        streamId,
        availabilityStartTime: options.availabilityStartTime,
        segmentCount: plan.segmentCount,
        segmentTemplate: SEGMENT_TEMPLATE,
        initSegment: INIT_SEGMENT,
        nominalDuration: toSeconds(plan.segmentDuration),
        segmentDurations: durations,
        timescale: split.initInfo.timescale,
        lapDuration,
        windowSize: options.windowSize,
        representation: representationOf(split.initInfo, peakBandwidth, frameRate),
        componentTag: streamId,
        ...(audioStreamId === null ? {} : { audioStreamId }),
    });
    checkStream(declaration, mediaDir);
    logger.info(`${streamId}: ${plan.segmentCount} segments of ${declaration.nominalDuration} s, `
        + `${declaration.representation.codecs}, ${peakBandwidth} bit/s`);
    return { declaration, mediaDir };
}

function representationOf(init: InitInfo, bandwidth: number, frameRate: Rational):
    StreamDeclaration['representation'] {
    switch (init.kind) {
        case 'video':
            return {
                mimeType: 'video/mp4',
                codecs: init.codecs,
                bandwidth,
                width: init.width ?? 0,
                height: init.height ?? 0,
                frameRate: frameRateText(frameRate),
            };
        case 'audio':
            return {
                mimeType: 'audio/mp4',
                codecs: init.codecs,
                bandwidth,
                audioSamplingRate: init.sampleRate ?? 0,
            };
        default:
            throw new Error('unknown track kind');
    }
}

function frameRateText(rate: Rational): string {
    return rate.den === 1 ? String(rate.num) : `${rate.num}/${rate.den}`;
}

// The lap of every component of a service lasts the same in seconds.
function checkSameLap(video: StreamDeclaration, audio: StreamDeclaration): void {
    const videoLap = BigInt(video.lapDuration) * BigInt(audio.timescale);
    const audioLap = BigInt(audio.lapDuration) * BigInt(video.timescale);
    if (videoLap !== audioLap) {
        throw new Error('video and audio laps differ in seconds');
    }
}

// Writes the segments first and the declarations last, so that a failure
// leaves no declaration behind.
function install(options: Options, prepared: Prepared[]): void {
    const serviceDir = path.join(options.servicesDir, options.serviceId);
    for (const component of prepared) {
        const target = path.join(serviceDir, MEDIA_DIR, component.declaration.streamId);
        fs.rmSync(target, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.cpSync(component.mediaDir, target, { recursive: true });
    }
    const streamsDir = path.join(serviceDir, STREAMS_DIR);
    fs.mkdirSync(streamsDir, { recursive: true });
    for (const component of prepared) {
        const file = path.join(streamsDir, `${component.declaration.streamId}.json`);
        fs.writeFileSync(file, `${JSON.stringify(component.declaration, null, 4)}\n`);
        logger.info(`declaration written: ${file}`);
    }
}

function logPlan(plan: DurationPlan): void {
    logger.info(`common unit ${toSeconds(plan.unit).toFixed(4)} s; lap ${toSeconds(plan.lap)} s`);
}

function readOptions(args: string[]): Options {
    const { values } = parseArgs({
        args,
        options: {
            'source': { type: 'string' },
            'services-dir': { type: 'string' },
            'service-id': { type: 'string' },
            'video-stream-id': { type: 'string' },
            'audio-stream-id': { type: 'string' },
            'segment-duration': { type: 'string', default: '4' },
            'max-lap-duration': { type: 'string' },
            'availability-start': { type: 'string' },
            'window-size': { type: 'string', default: '5' },
            'video-encoder': { type: 'string', default: 'libx264' },
            'video-bitrate': { type: 'string', default: '2M' },
            'audio-encoder': { type: 'string', default: 'aac' },
            'audio-bitrate': { type: 'string', default: '128k' },
            'audio-frame-size': { type: 'string', default: '1024' },
        },
        strict: true,
    });
    const required = ['source', 'services-dir', 'service-id', 'video-stream-id', 'audio-stream-id'] as const;
    for (const name of required) {
        if (values[name] === undefined) {
            throw new Error(`--${name} is required\n${USAGE}`);
        }
    }
    const nowSeconds = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    return {
        source: values['source'] ?? '',
        servicesDir: values['services-dir'] ?? '',
        serviceId: values['service-id'] ?? '',
        videoStreamId: values['video-stream-id'] ?? '',
        audioStreamId: values['audio-stream-id'] ?? '',
        segmentDuration: positiveNumber('segment-duration', values['segment-duration']),
        maxLapDuration: values['max-lap-duration'] === undefined
            ? null
            : positiveNumber('max-lap-duration', values['max-lap-duration']),
        availabilityStartTime: values['availability-start'] ?? nowSeconds,
        windowSize: positiveNumber('window-size', values['window-size']),
        videoEncoder: values['video-encoder'] ?? '',
        videoBitrate: values['video-bitrate'] ?? '',
        audioEncoder: values['audio-encoder'] ?? '',
        audioBitrate: values['audio-bitrate'] ?? '',
        audioFrameSize: positiveNumber('audio-frame-size', values['audio-frame-size']),
    };
}

function positiveNumber(name: string, text: string | undefined): number {
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`--${name} must be a positive number; got '${text}'`);
    }
    return value;
}

try {
    main();
}
catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
