import express, { Express } from 'express';
import { liveRouter } from './api/live';
import { servicesRouter } from './api/services';
import { signalingRouter } from './api/signaling';
import { Config } from './config';

export function createApp(config: Config): Express {
    const app = express();
    app.disable('x-powered-by');
    app.use(config.liveBaseUrl.pathname, liveRouter(config.liveBaseUrl));
    app.use(config.servicesBaseUrl.pathname, servicesRouter(config.emissionDir, config.liveBaseUrl));
    app.use(config.signalingBaseUrl.pathname, signalingRouter(config.liveBaseUrl));
    return app;
}
