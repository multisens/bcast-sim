import { createApp } from './app';
import { readConfig } from './config';
import logger from './logger';
import { startStreams } from './modules/streams';

function main(): void {
    const config = readConfig(process.env);
    startStreams(config.servicesDir);
    const app = createApp(config);
    app.listen(config.port, () => {
        logger.info(`bcast-sim listening on port ${config.port}; live base ${config.liveBaseUrl.href}`);
    });
}

main();
