import express, { NextFunction, Request, Response, Router } from 'express';
import { getStream } from '../../modules/streams';
import { createLiveHandlers } from './controller';

// Routes of the live simulator, under <aovivo>. Mounted also under
// <emissao>/{serviceId}/live, where only the streams of that service answer.

export { LiveMedia, MpdDocument, mpd } from './service';

export function liveRouter(liveBaseUrl: URL): Router {
    const handlers = createLiveHandlers(liveBaseUrl);
    const router = express.Router({ mergeParams: true });
    router.use((_req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*');
        next();
    });
    router.param('streamId', checkServiceOwnsStream);
    router.get('/:streamId/master.m3u8', handlers.master);
    router.get('/:streamId/playlist.m3u8', handlers.playlist);
    router.get('/:streamId/mpd', handlers.mpd);
    router.get('/:streamId/init.mp4', handlers.init);
    router.get('/:streamId/seg/:file', handlers.segment);
    return router;
}

function checkServiceOwnsStream(req: Request, res: Response, next: NextFunction, streamId: string): void {
    const serviceId = req.params.serviceId;
    if (typeof serviceId === 'string' && getStream(streamId)?.serviceId !== serviceId) {
        res.sendStatus(404);
        return;
    }
    next();
}
