import fs from 'fs';

// Environment of the service, checked at startup.

export type Config = {
    port: number;
    servicesDir: string;
    // <aovivo>: absolute base URL of the live simulator, as players reach it.
    liveBaseUrl: URL;
};

export function readConfig(env: NodeJS.ProcessEnv): Config {
    const port = Number(requireVariable(env, 'PORT'));
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`PORT must be a positive integer; got '${env.PORT}'`);
    }
    const servicesDir = requireVariable(env, 'SERVICES_DIR');
    if (!fs.existsSync(servicesDir) || !fs.statSync(servicesDir).isDirectory()) {
        throw new Error(`SERVICES_DIR '${servicesDir}' is not a directory`);
    }
    const liveBaseUrl = new URL(requireVariable(env, 'LIVE_BASE_URL'));
    if (!liveBaseUrl.pathname.endsWith('/')) {
        throw new Error(`LIVE_BASE_URL must end with '/'; got '${liveBaseUrl.href}'`);
    }
    return { port, servicesDir, liveBaseUrl };
}

function requireVariable(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name];
    if (value === undefined || value === '') {
        throw new Error(`environment variable ${name} is required`);
    }
    return value;
}
