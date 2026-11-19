import fs from 'fs';
import logger from '../../logger';
import { reloadStreams, streamsOfService } from '../streams';
import { EmissionBases } from './build';
import {
    EmissionLoad, LoadedChannel, LoadedService, VersionRecord, filesDirOf, loadEmission, servicesDirOf,
} from './loader';

// Registry of the emission declarations: loaded at startup and again, after
// the streams, whenever a file under the emission directory changes.

export { EmissionBases } from './build';
export { EntryPackage, buildEntryPackage } from './entry-package';
export * from './fragments';
export {
    EmissionContext, EmissionLoad, LoadedChannel, LoadedService, StaticMetadataUri, VersionRecord, Versioned,
    filesDirOf, loadEmission, nextVersion, servicesDirOf,
} from './loader';

export type EmissionSettings = {
    emissionDir: string;
    bases: EmissionBases;
    liveBaseUrl: string;
    variables: Map<string, string>;
};

const RELOAD_DELAY_MS = 500;

let channels = new Map<number, LoadedChannel>();
let services = new Map<number, LoadedService>();
let versions = new Map<string, VersionRecord>();
let reloadTimer: NodeJS.Timeout | null = null;

export function startEmission(settings: EmissionSettings): void {
    reload(settings);
    const watcher = fs.watch(settings.emissionDir, { recursive: true }, () => {
        scheduleReload(settings);
    });
    watcher.on('error', (error) => {
        logger.error(`watch of ${settings.emissionDir} failed: ${error.message}`);
        process.exit(1);
    });
}

// Sorted by bsid.
export function getChannels(): LoadedChannel[] {
    return [...channels.values()].sort((one, other) => one.bsid - other.bsid);
}

export function getService(serviceId: number): LoadedService | undefined {
    return services.get(serviceId);
}

// Null when the service is not loaded.
export function filesDirOfLoaded(emissionDir: string, serviceId: number): string | null {
    if (!services.has(serviceId)) {
        return null;
    }
    return filesDirOf(emissionDir, serviceId);
}

function scheduleReload(settings: EmissionSettings): void {
    if (reloadTimer !== null) {
        clearTimeout(reloadTimer);
    }
    reloadTimer = setTimeout(() => {
        reloadTimer = null;
        reload(settings);
    }, RELOAD_DELAY_MS);
}

function reload(settings: EmissionSettings): void {
    reloadStreams(servicesDirOf(settings.emissionDir));
    const result: EmissionLoad = loadEmission({
        emissionDir: settings.emissionDir,
        bases: settings.bases,
        liveBaseUrl: settings.liveBaseUrl,
        variables: settings.variables,
        streamsOfService,
    }, versions);
    for (const refusal of result.refusals) {
        logger.error(`declaration refused (${refusal.source}): ${refusal.reason}`);
    }
    channels = result.channels;
    services = result.services;
    versions = result.versions;
    logger.info(`channels loaded: ${[...channels.keys()].join(', ') || 'none'}; `
        + `services loaded: ${[...services.keys()].join(', ') || 'none'}`);
}
