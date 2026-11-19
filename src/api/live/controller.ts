import { Request, Response } from 'express';
import fs from 'fs';
import logger from '../../logger';
import { getStream } from '../../modules/streams';
import { SegmentResult, masterPlaylist, mediaPlaylist, mpd, segment, timelineOf } from './service';
import { secondsUntilFirstSegment } from './timeline';

// Handlers of the live simulator routes.

type Handler = (req: Request, res: Response) => void;

export type LiveHandlers = {
    master: Handler;
    playlist: Handler;
    mpd: Handler;
    init: Handler;
    segment: Handler;
};

const HLS_TYPE = 'application/vnd.apple.mpegurl';
const MPD_TYPE = 'application/dash+xml';
const LONG_MAX_AGE_SECONDS = 86400;
const SEGMENT_FILE = /^(\d+)\.m4s$/;

export function createLiveHandlers(liveBaseUrl: URL): LiveHandlers {
    return {
        master: (req: Request, res: Response): void => {
            const video = getStream(param(req, 'streamId'));
            const audioStreamId = video?.declaration.audioStreamId;
            const audio = audioStreamId === undefined ? undefined : getStream(audioStreamId);
            if (video === undefined || video.media === null || audio === undefined) {
                notFound(res);
                return;
            }
            res.set('Content-Type', HLS_TYPE);
            res.set('Cache-Control', `max-age=${LONG_MAX_AGE_SECONDS}`);
            res.send(Buffer.from(masterPlaylist(video, audio)));
        },

        playlist: (req: Request, res: Response): void => {
            const stream = getStream(param(req, 'streamId'));
            if (stream === undefined) {
                notFound(res);
                return;
            }
            if (stream.media === null) {
                sendManifest(res, stream.manifestPaths.hls, HLS_TYPE);
                return;
            }
            const nowMs = Date.now();
            const body = mediaPlaylist(stream, stream.media, nowMs);
            if (body === null) {
                notYet(res, secondsUntilFirstSegment(timelineOf(stream, stream.media), nowMs));
                return;
            }
            const maxAge = Math.floor(stream.declaration.nominalDuration / 2);
            res.set('Content-Type', HLS_TYPE);
            res.set('Cache-Control', `max-age=${maxAge}`);
            res.send(Buffer.from(body));
        },

        mpd: (req: Request, res: Response): void => {
            const stream = getStream(param(req, 'streamId'));
            if (stream === undefined) {
                notFound(res);
                return;
            }
            if (stream.media === null) {
                sendManifest(res, stream.manifestPaths.mpd, MPD_TYPE);
                return;
            }
            const nowMs = Date.now();
            const document = mpd([{ stream, media: stream.media }], liveBaseUrl.href, nowMs);
            if (document === null) {
                notYet(res, secondsUntilFirstSegment(timelineOf(stream, stream.media), nowMs));
                return;
            }
            res.set('Content-Type', MPD_TYPE);
            res.set('Cache-Control', 'no-cache');
            res.send(Buffer.from(document.body));
        },

        init: (req: Request, res: Response): void => {
            const stream = getStream(param(req, 'streamId'));
            if (stream === undefined || stream.media === null) {
                notFound(res);
                return;
            }
            const body = readFile(res, stream.media.initPath);
            if (body === null) {
                return;
            }
            res.set('Content-Type', stream.declaration.representation.mimeType);
            res.set('Cache-Control', `max-age=${LONG_MAX_AGE_SECONDS}`);
            res.send(body);
        },

        segment: (req: Request, res: Response): void => {
            const stream = getStream(param(req, 'streamId'));
            const match = SEGMENT_FILE.exec(param(req, 'file'));
            if (stream === undefined || stream.media === null || match === null) {
                notFound(res);
                return;
            }
            const nowMs = Date.now();
            let result: SegmentResult;
            try {
                result = segment(stream, stream.media, Number(match[1]), nowMs);
            }
            catch (error) {
                readFailure(res, error);
                return;
            }
            switch (result.kind) {
                case 'not-yet':
                    notYet(res, secondsUntilFirstSegment(timelineOf(stream, stream.media), nowMs));
                    return;
                case 'out-of-window':
                    notFound(res);
                    return;
                case 'ok': {
                    const maxAge = Math.floor(stream.declaration.windowSize * stream.declaration.nominalDuration);
                    res.set('Content-Type', stream.declaration.representation.mimeType);
                    res.set('Cache-Control', `max-age=${maxAge}`);
                    res.send(result.body);
                    return;
                }
                default:
                    return;
            }
        },
    };
}

function sendManifest(res: Response, file: string | null, contentType: string): void {
    if (file === null) {
        notFound(res);
        return;
    }
    const body = readFile(res, file);
    if (body === null) {
        return;
    }
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-cache');
    res.send(body);
}

function readFile(res: Response, file: string): Buffer | null {
    try {
        return fs.readFileSync(file);
    }
    catch (error) {
        readFailure(res, error);
        return null;
    }
}

function param(req: Request, name: string): string {
    const value = req.params[name];
    return typeof value === 'string' ? value : '';
}

function notFound(res: Response): void {
    res.sendStatus(404);
}

function notYet(res: Response, retryAfterSeconds: number): void {
    res.set('Retry-After', String(retryAfterSeconds));
    res.sendStatus(503);
}

function readFailure(res: Response, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`file read failed: ${message}`);
    res.sendStatus(500);
}
