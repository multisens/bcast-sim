import { Request, Response } from 'express';
import logger from '../../logger';
import { filesDirOfLoaded } from '../../modules/emission';

// Handler of the files of a service, under <emissao>/{serviceId} (2.3).

type Handler = (req: Request, res: Response) => void;

export type ServicesHandlers = {
    file: Handler;
};

const SERVICE_ID = /^\d+$/;
const NOT_FOUND_CODES = new Set(['ENOENT', 'EISDIR', 'ENOTDIR']);

export function createServicesHandlers(emissionDir: string): ServicesHandlers {
    return {
        file: (req: Request, res: Response): void => {
            const serviceId = req.params.serviceId;
            const segments = req.params.path;
            const dir = typeof serviceId === 'string' && SERVICE_ID.test(serviceId)
                ? filesDirOfLoaded(emissionDir, Number(serviceId)) : null;
            if (dir === null || !Array.isArray(segments)) {
                res.sendStatus(404);
                return;
            }
            res.sendFile(segments.join('/'), { root: dir, dotfiles: 'deny' }, (error?: Error) => {
                if (error === undefined || res.headersSent) {
                    return;
                }
                if (NOT_FOUND_CODES.has((error as NodeJS.ErrnoException).code ?? '')) {
                    res.sendStatus(404);
                    return;
                }
                logger.error(`file read failed: ${error.message}`);
                res.sendStatus(500);
            });
        },
    };
}
