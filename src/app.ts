import express, { Express } from 'express';
import { liveRouter } from './api/live';
import { Config } from './config';

export function createApp(config: Config): Express {
    const app = express();
    app.disable('x-powered-by');
    app.use(config.liveBaseUrl.pathname, liveRouter(config.liveBaseUrl));
    return app;
}
