import logger from '../../logger';
import { LoadResult, LoadedStream, loadStreams } from './loader';

// Registry of the loaded streams (4.2). The emission module reloads it
// whenever a file under the emission directory changes.

export { LoadResult, LoadedStream, Refusal, loadStreams } from './loader';

let streams = new Map<string, LoadedStream>();

export function reloadStreams(servicesDir: string): void {
    const result: LoadResult = loadStreams(servicesDir, streams);
    for (const refusal of result.refusals) {
        logger.error(`stream refused (${refusal.source}): ${refusal.reason}`);
    }
    streams = result.streams;
    logger.info(`streams loaded: ${[...streams.keys()].join(', ') || 'none'}`);
}

export function getStream(streamId: string): LoadedStream | undefined {
    return streams.get(streamId);
}

// Sorted by streamId.
export function streamsOfService(serviceId: string): LoadedStream[] {
    return [...streams.values()]
        .filter((stream) => stream.serviceId === serviceId)
        .sort((one, other) => one.declaration.streamId.localeCompare(other.declaration.streamId));
}
