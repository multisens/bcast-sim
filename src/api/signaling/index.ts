import express, { Router } from 'express';
import { createSignalingHandlers } from './controller';

// Signaling routes of the emission side, under <sinal>.

export { SlsPackage, SlsResult, emissionDescriptor, llsResponse, slsPackage } from './service';

export function signalingRouter(liveBaseUrl: URL): Router {
    const handlers = createSignalingHandlers(liveBaseUrl);
    const router = express.Router();
    router.get('/lls', handlers.lls);
    router.get('/sls/:serviceId', handlers.sls);
    router.get('/emission/:serviceId', handlers.emission);
    return router;
}
