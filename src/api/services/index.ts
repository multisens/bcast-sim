import express, { Router } from 'express';
import { liveRouter } from '../live';
import { createServicesHandlers } from './controller';

// Files of each service, under <emissao> (2.3): live/{streamId}/ is the live
// simulator, restricted to the streams of the service (DP10); any other path
// is a file under arquivos/.

export function servicesRouter(emissionDir: string, liveBaseUrl: URL): Router {
    const handlers = createServicesHandlers(emissionDir);
    const router = express.Router();
    router.use('/:serviceId/live', liveRouter(liveBaseUrl));
    router.get('/:serviceId/*path', handlers.file);
    return router;
}
