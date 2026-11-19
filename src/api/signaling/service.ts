import crypto from 'crypto';
import fs from 'fs';
import { LiveMedia, mpd } from '../live';
import {
    EmissionDescriptor, Envelope, LLS_TABLE_ID_BAMT, LLS_TABLE_ID_SLT, LlsResponse, LoadedChannel, LoadedService,
    MetadataUri,
} from '../../modules/emission';
import { LoadedStream } from '../../modules/streams';

// Responses of the signaling routes: the LLS tables of the scan, the SLS
// package of the Signaling Server and the emission descriptor.

export type SlsPackage = {
    contentType: string;
    body: string;
};

export type SlsResult =
    | { kind: 'ok'; package: SlsPackage }
    | { kind: 'not-yet' };

type Part = {
    location: MetadataUri | 'envelope';
    contentType: string;
    body: string;
};

type MpdPart = {
    body: string;
    versionMs: number;
};

const JSON_TYPE = 'application/json';
const MPD_TYPE = 'application/dash+xml';
const ENVELOPE_LOCATION = 'envelope';
const BOUNDARY_PREFIX = 'sls-';
const BOUNDARY_HASH_LENGTH = 16;
const MS_PER_SECOND = 1000;
const PACKAGE_ORDER: MetadataUri[] = ['usbd', 'stsid', 'mpd', 'bald', 'prrd'];
// MPD.BaseURL of a service whose carousel carries its streams: relative,
// resolved against the object proxy.
const BROADCAST_LIVE_BASE = '/live/';

export function llsResponse(channels: LoadedChannel[]): LlsResponse {
    return {
        rfChannels: channels.map((channel) => {
            const tables: LlsResponse['rfChannels'][number]['tables'] = [{
                LLS_table_id: LLS_TABLE_ID_SLT,
                LLS_group_id: 0,
                group_count_minus1: 0,
                LLS_table_version: channel.slt.version,
                SLT: channel.slt.content,
            }];
            if (channel.bamt !== null) {
                tables.push({
                    LLS_table_id: LLS_TABLE_ID_BAMT,
                    LLS_group_id: 0,
                    group_count_minus1: 0,
                    LLS_table_version: channel.bamt.version,
                    BAMT: channel.bamt.content,
                });
            }
            return { bsid: channel.bsid, llsCyclePeriod: channel.llsCyclePeriod, tables };
        }),
    };
}

// The envelope first, then one part per fragment, in referenced mode. Not
// yet when a stream of the service has no segment available.
export function slsPackage(service: LoadedService, streams: LoadedStream[], liveBaseUrl: string, nowMs: number):
    SlsResult {
    const baseUrl = service.carriesStreams ? BROADCAST_LIVE_BASE : liveBaseUrl;
    const mpdPart = serviceMpd(streams, baseUrl, nowMs);
    if (mpdPart === null) {
        return { kind: 'not-yet' };
    }
    const items: Envelope['item'] = [];
    const parts: Part[] = [];
    for (const uri of PACKAGE_ORDER) {
        if (uri === 'mpd') {
            items.push({ metadataURI: uri, version: mpdPart.versionMs, contentType: MPD_TYPE,
                validFrom: isoTime(mpdPart.versionMs) });
            parts.push({ location: uri, contentType: MPD_TYPE, body: mpdPart.body });
            continue;
        }
        const fragment = service.fragments.get(uri);
        if (fragment === undefined) {
            continue;
        }
        items.push({ metadataURI: uri, version: fragment.version, contentType: JSON_TYPE,
            validFrom: isoTime(fragment.version * MS_PER_SECOND) });
        parts.push({ location: uri, contentType: JSON_TYPE, body: JSON.stringify(fragment.content) });
    }
    const envelope: Envelope = { item: items };
    const all: Part[] = [{ location: ENVELOPE_LOCATION, contentType: JSON_TYPE, body: JSON.stringify(envelope) },
        ...parts];
    return { kind: 'ok', package: multipart(all) };
}

export function emissionDescriptor(service: LoadedService): EmissionDescriptor | null {
    return service.descriptor;
}

// Generated from all the streams of the service, versioned by the instant
// of its newest segment, in milliseconds; a ready-made MPD is versioned by
// its modification time.
function serviceMpd(streams: LoadedStream[], liveBaseUrl: string, nowMs: number): MpdPart | null {
    const ready = streams.length === 1 ? streams[0].manifestPaths.mpd : null;
    if (ready !== null) {
        return { body: fs.readFileSync(ready, 'utf8'), versionMs: Math.floor(fs.statSync(ready).mtimeMs) };
    }
    const live: LiveMedia[] = [];
    for (const stream of [...streams].sort(videoFirst)) {
        if (stream.media === null) {
            return null;
        }
        live.push({ stream, media: stream.media });
    }
    const document = mpd(live, liveBaseUrl, nowMs);
    if (document === null) {
        return null;
    }
    return { body: document.body, versionMs: document.publishTimeMs };
}

function videoFirst(one: LoadedStream, other: LoadedStream): number {
    const rank = (stream: LoadedStream): number => (stream.declaration.representation.mimeType === 'video/mp4' ? 0 : 1);
    return rank(one) - rank(other);
}

// RFC 2387. The boundary is derived from the parts, so that it does not
// occur in them and the same package gives the same bytes.
function multipart(parts: Part[]): SlsPackage {
    const digest = crypto.createHash('sha256');
    for (const part of parts) {
        digest.update(part.body);
    }
    const boundary = `${BOUNDARY_PREFIX}${digest.digest('hex').slice(0, BOUNDARY_HASH_LENGTH)}`;
    const sections = parts.map((part) => [
        `--${boundary}`,
        `Content-Type: ${part.contentType}`,
        `Content-Location: ${part.location}`,
        '',
        part.body,
    ].join('\r\n'));
    const body = `${sections.join('\r\n')}\r\n--${boundary}--\r\n`;
    return { contentType: `multipart/related; type="${JSON_TYPE}"; boundary=${boundary}`, body };
}

function isoTime(ms: number): string {
    return new Date(ms).toISOString().replace('.000Z', 'Z');
}
