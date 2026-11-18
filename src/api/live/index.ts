import express, { Router } from 'express';
import { createLiveHandlers } from './controller';

// Routes of the live simulator, under <aovivo> (4.3).

export function liveRouter(liveBaseUrl: URL): Router {
    const handlers = createLiveHandlers(liveBaseUrl);
    const router = express.Router();
    router.use((_req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*');
        next();
    });
    router.get('/:streamId/master.m3u8', handlers.master);
    router.get('/:streamId/playlist.m3u8', handlers.playlist);
    router.get('/:streamId/mpd', handlers.mpd);
    router.get('/:streamId/init.mp4', handlers.init);
    router.get('/:streamId/seg/:file', handlers.segment);
    return router;
}
