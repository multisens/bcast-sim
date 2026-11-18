// Service logger: timestamped lines on stdout, errors on stderr.

type LogLevel = 'DEBUG' | 'INFO' | 'ERROR';

const LEVELS: LogLevel[] = ['ERROR', 'INFO', 'DEBUG'];

function currentLevel(): LogLevel {
    const value = process.env.LOG_LEVEL ?? 'INFO';
    const level = LEVELS.find((candidate) => candidate === value);
    if (level === undefined) {
        throw new Error(`LOG_LEVEL must be one of ${LEVELS.join(', ')}; got '${value}'`);
    }
    return level;
}

const LOG_LEVEL = currentLevel();

function enabled(level: LogLevel): boolean {
    return LEVELS.indexOf(level) <= LEVELS.indexOf(LOG_LEVEL);
}

function line(level: LogLevel, message: string): string {
    return `[${new Date().toISOString()}] [${level}] ${message}`;
}

const logger = {
    debug: (message: string): void => {
        if (enabled('DEBUG')) {
            process.stdout.write(`${line('DEBUG', message)}\n`);
        }
    },
    info: (message: string): void => {
        if (enabled('INFO')) {
            process.stdout.write(`${line('INFO', message)}\n`);
        }
    },
    error: (message: string): void => {
        process.stderr.write(`${line('ERROR', message)}\n`);
    },
};

export default logger;
