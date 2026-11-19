import fs from 'fs';
import path from 'path';
import { CheckedMedia, StreamDeclaration, checkStream, streamDeclarationSchema } from '../../media';

// Load of the stream declarations of every service; a declaration whose media
// changed without a new availabilityStartTime keeps the previous one.

export type LoadedStream = {
    serviceId: string;
    declaration: StreamDeclaration;
    availabilityStartMs: number;
    // Null when the declaration brings a ready-made manifest.
    media: CheckedMedia | null;
    manifestPaths: { mpd: string | null; hls: string | null };
};

export type Refusal = {
    source: string;
    reason: string;
};

export type LoadResult = {
    streams: Map<string, LoadedStream>;
    refusals: Refusal[];
};

type Candidate = {
    source: string;
    stream: LoadedStream;
};

const SERVICES_STREAMS_DIR = 'fluxos';
const SERVICES_MEDIA_DIR = 'segmentos';

export function loadStreams(servicesDir: string, previous: Map<string, LoadedStream>): LoadResult {
    const refusals: Refusal[] = [];
    const candidates: Candidate[] = [];

    for (const source of declarationFiles(servicesDir)) {
        try {
            candidates.push({ source, stream: loadStream(servicesDir, source) });
        }
        catch (error) {
            refusals.push({ source, reason: errorMessage(error) });
        }
    }

    const unique = new Map<string, Candidate>();
    const repeated = new Set<string>();
    for (const candidate of candidates) {
        const streamId = candidate.stream.declaration.streamId;
        if (unique.has(streamId)) {
            repeated.add(streamId);
        }
        unique.set(streamId, candidate);
    }
    for (const candidate of candidates) {
        const streamId = candidate.stream.declaration.streamId;
        if (repeated.has(streamId)) {
            refusals.push({ source: candidate.source, reason: `streamId '${streamId}' is declared more than once` });
            unique.delete(streamId);
        }
    }

    const streams = new Map<string, LoadedStream>();
    for (const [streamId, candidate] of unique) {
        const before = previous.get(streamId);
        if (before !== undefined && changedWithoutNewEpoch(before, candidate.stream)) {
            refusals.push({ source: candidate.source,
                reason: 'media changed without a new availabilityStartTime; keeping the previous declaration' });
            streams.set(streamId, before);
        }
        else {
            streams.set(streamId, candidate.stream);
        }
    }

    for (const [streamId, stream] of streams) {
        const reason = audioPairingProblem(stream, streams);
        if (reason !== null) {
            refusals.push({ source: streamId, reason });
            streams.delete(streamId);
        }
    }

    return { streams, refusals };
}

function loadStream(servicesDir: string, source: string): LoadedStream {
    const serviceId = path.basename(path.dirname(path.dirname(source)));
    const raw: unknown = JSON.parse(fs.readFileSync(source, 'utf8'));
    const parsed = streamDeclarationSchema.safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(`invalid declaration at '${issue.path.join('.')}': ${issue.message}`);
    }
    const declaration = parsed.data;
    if (path.basename(source, '.json') !== declaration.streamId) {
        throw new Error(`file name does not match streamId '${declaration.streamId}'`);
    }

    const serviceDir = path.join(servicesDir, serviceId);
    const availabilityStartMs = Date.parse(declaration.availabilityStartTime);

    if (declaration.manifest !== undefined) {
        const mpd = optionalFile(serviceDir, declaration.manifest.mpd);
        const hls = optionalFile(serviceDir, declaration.manifest.hls);
        return { serviceId, declaration, availabilityStartMs, media: null, manifestPaths: { mpd, hls } };
    }

    const mediaDir = path.join(serviceDir, SERVICES_MEDIA_DIR, declaration.streamId);
    const media = checkStream(declaration, mediaDir);
    return { serviceId, declaration, availabilityStartMs, media, manifestPaths: { mpd: null, hls: null } };
}

function declarationFiles(servicesDir: string): string[] {
    const files: string[] = [];
    const services = fs.readdirSync(servicesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    for (const service of services) {
        const streamsDir = path.join(servicesDir, service, SERVICES_STREAMS_DIR);
        if (!fs.existsSync(streamsDir)) {
            continue;
        }
        const names = fs.readdirSync(streamsDir).filter((name) => name.endsWith('.json')).sort();
        for (const name of names) {
            files.push(path.join(streamsDir, name));
        }
    }
    return files;
}

function changedWithoutNewEpoch(before: LoadedStream, after: LoadedStream): boolean {
    const sameEpoch = before.declaration.availabilityStartTime === after.declaration.availabilityStartTime;
    const beforeFingerprint = before.media?.fingerprint ?? null;
    const afterFingerprint = after.media?.fingerprint ?? null;
    return sameEpoch && beforeFingerprint !== afterFingerprint;
}

// A video stream with audioStreamId needs that audio stream loaded in the
// same service, with the same availabilityStartTime and lap duration.
function audioPairingProblem(stream: LoadedStream, streams: Map<string, LoadedStream>): string | null {
    const audioStreamId = stream.declaration.audioStreamId;
    if (audioStreamId === undefined) {
        return null;
    }
    if (stream.declaration.representation.mimeType !== 'video/mp4') {
        return 'audioStreamId is only allowed in a video stream';
    }
    const audio = streams.get(audioStreamId);
    if (audio === undefined || audio.serviceId !== stream.serviceId) {
        return `audio stream '${audioStreamId}' is not loaded in service ${stream.serviceId}`;
    }
    if (audio.declaration.representation.mimeType !== 'audio/mp4') {
        return `stream '${audioStreamId}' is not an audio stream`;
    }
    if (audio.declaration.availabilityStartTime !== stream.declaration.availabilityStartTime) {
        return `audio stream '${audioStreamId}' has a different availabilityStartTime`;
    }
    const videoLap = BigInt(stream.declaration.lapDuration) * BigInt(audio.declaration.timescale);
    const audioLap = BigInt(audio.declaration.lapDuration) * BigInt(stream.declaration.timescale);
    if (videoLap !== audioLap) {
        return `audio stream '${audioStreamId}' has a different lap duration`;
    }
    return null;
}

function optionalFile(serviceDir: string, relative: string | undefined): string | null {
    if (relative === undefined) {
        return null;
    }
    const file = path.join(serviceDir, relative);
    if (!fs.existsSync(file)) {
        throw new Error(`manifest file '${relative}' does not exist`);
    }
    return file;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
