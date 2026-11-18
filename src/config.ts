import fs from 'fs';

// Environment of the service, checked at startup. Each base URL is absolute,
// ends with '/', and its path is where the routes are mounted (DP10). The
// base URLs are also the variables a declaration can reference as ${NAME}.

export type Config = {
    port: number;
    // Holds canais/ and servicos/ (3.1).
    emissionDir: string;
    // <aovivo>, as players reach it; the MPD.BaseURL.
    liveBaseUrl: URL;
    // <emissao>, as the platform reaches it; the base of the emission
    // descriptor.
    servicesBaseUrl: URL;
    // <sinal>, as the platform reaches it.
    signalingBaseUrl: URL;
    // <emissao>, as players and browsers reach it; same path as
    // servicesBaseUrl.
    publicServicesBaseUrl: URL;
};

export function readConfig(env: NodeJS.ProcessEnv): Config {
    const port = Number(requireVariable(env, 'PORT'));
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`PORT must be a positive integer; got '${env.PORT}'`);
    }
    const emissionDir = requireVariable(env, 'EMISSION_DIR');
    if (!fs.existsSync(emissionDir) || !fs.statSync(emissionDir).isDirectory()) {
        throw new Error(`EMISSION_DIR '${emissionDir}' is not a directory`);
    }
    const liveBaseUrl = baseUrl(env, 'LIVE_BASE_URL');
    const servicesBaseUrl = baseUrl(env, 'SERVICES_BASE_URL');
    const signalingBaseUrl = baseUrl(env, 'SIGNALING_BASE_URL');
    const publicServicesBaseUrl = baseUrl(env, 'PUBLIC_SERVICES_BASE_URL');
    if (publicServicesBaseUrl.pathname !== servicesBaseUrl.pathname) {
        throw new Error('PUBLIC_SERVICES_BASE_URL and SERVICES_BASE_URL need the same path');
    }
    const mounts = [liveBaseUrl.pathname, servicesBaseUrl.pathname, signalingBaseUrl.pathname];
    if (new Set(mounts).size !== mounts.length) {
        throw new Error(`LIVE_BASE_URL, SERVICES_BASE_URL and SIGNALING_BASE_URL need distinct paths; got ${mounts}`);
    }
    return { port, emissionDir, liveBaseUrl, servicesBaseUrl, signalingBaseUrl, publicServicesBaseUrl };
}

export function declarationVariables(config: Config): Map<string, string> {
    return new Map([
        ['LIVE_BASE_URL', config.liveBaseUrl.href],
        ['SERVICES_BASE_URL', config.servicesBaseUrl.href],
        ['SIGNALING_BASE_URL', config.signalingBaseUrl.href],
        ['PUBLIC_SERVICES_BASE_URL', config.publicServicesBaseUrl.href],
    ]);
}

function baseUrl(env: NodeJS.ProcessEnv, name: string): URL {
    const url = new URL(requireVariable(env, name));
    if (!url.pathname.endsWith('/')) {
        throw new Error(`${name} must end with '/'; got '${url.href}'`);
    }
    return url;
}

function requireVariable(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name];
    if (value === undefined || value === '') {
        throw new Error(`environment variable ${name} is required`);
    }
    return value;
}
