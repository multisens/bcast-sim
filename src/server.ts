import { createApp } from './app';
import { declarationVariables, readConfig } from './config';
import logger from './logger';
import { startEmission } from './modules/emission';

function main(): void {
    const config = readConfig(process.env);
    startEmission({
        emissionDir: config.emissionDir,
        bases: { servicesBaseUrl: config.servicesBaseUrl.href, signalingBaseUrl: config.signalingBaseUrl.href },
        liveBaseUrl: config.liveBaseUrl.href,
        variables: declarationVariables(config),
    });
    const app = createApp(config);
    app.listen(config.port, () => {
        logger.info(`bcast-sim listening on port ${config.port}; live ${config.liveBaseUrl.href}, `
            + `services ${config.servicesBaseUrl.href}, signaling ${config.signalingBaseUrl.href}`);
    });
}

main();
