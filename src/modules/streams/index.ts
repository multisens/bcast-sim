import fs from 'fs';
import logger from '../../logger';
import { LoadResult, LoadedStream, loadStreams } from './loader';

// Registry of the loaded streams: loaded at startup and again whenever a file
// under the services directory changes (4.2).

export { LoadResult, LoadedStream, Refusal, loadStreams } from './loader';

const RELOAD_DELAY_MS = 500;

let streams = new Map<string, LoadedStream>();
let reloadTimer: NodeJS.Timeout | null = null;

export function startStreams(servicesDir: string): void {
    reload(servicesDir);
    const watcher = fs.watch(servicesDir, { recursive: true }, () => {
        scheduleReload(servicesDir);
    });
    watcher.on('error', (error) => {
        logger.error(`watch of ${servicesDir} failed: ${error.message}`);
        process.exit(1);
    });
}

export function getStream(streamId: string): LoadedStream | undefined {
    return streams.get(streamId);
}

function scheduleReload(servicesDir: string): void {
    if (reloadTimer !== null) {
        clearTimeout(reloadTimer);
    }
    reloadTimer = setTimeout(() => {
        reloadTimer = null;
        reload(servicesDir);
    }, RELOAD_DELAY_MS);
}

function reload(servicesDir: string): void {
    const result: LoadResult = loadStreams(servicesDir, streams);
    for (const refusal of result.refusals) {
        logger.error(`stream refused (${refusal.source}): ${refusal.reason}`);
    }
    streams = result.streams;
    logger.info(`streams loaded: ${[...streams.keys()].join(', ') || 'none'}`);
}
