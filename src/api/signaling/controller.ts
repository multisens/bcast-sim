import { Request, Response } from 'express';
import { getChannels, getService } from '../../modules/emission';
import { streamsOfService } from '../../modules/streams';
import { emissionDescriptor, llsResponse, slsPackage } from './service';

// Handlers of the signaling routes, under <sinal>.

type Handler = (req: Request, res: Response) => void;

export type SignalingHandlers = {
    lls: Handler;
    sls: Handler;
    emission: Handler;
};

const SERVICE_ID = /^\d+$/;
const RETRY_AFTER_SECONDS = 1;

export function createSignalingHandlers(liveBaseUrl: URL): SignalingHandlers {
    return {
        lls: (req: Request, res: Response): void => {
            const rf = req.query.rf;
            let channels = getChannels();
            if (rf !== undefined) {
                channels = channels.filter((channel) => typeof rf === 'string' && String(channel.bsid) === rf);
                if (channels.length === 0) {
                    res.sendStatus(404);
                    return;
                }
            }
            sendJson(res, llsResponse(channels));
        },

        sls: (req: Request, res: Response): void => {
            const serviceId = param(req, 'serviceId');
            const service = serviceId === null ? undefined : getService(serviceId);
            if (service === undefined) {
                res.sendStatus(404);
                return;
            }
            const result = slsPackage(service, streamsOfService(String(service.serviceId)), liveBaseUrl.href,
                Date.now());
            switch (result.kind) {
                case 'not-yet':
                    res.set('Retry-After', String(RETRY_AFTER_SECONDS));
                    res.sendStatus(503);
                    return;
                case 'ok':
                    res.set('Content-Type', result.package.contentType);
                    res.set('Cache-Control', 'no-cache');
                    res.send(Buffer.from(result.package.body));
                    return;
                default:
                    return;
            }
        },

        emission: (req: Request, res: Response): void => {
            const serviceId = param(req, 'serviceId');
            const service = serviceId === null ? undefined : getService(serviceId);
            const descriptor = service === undefined ? null : emissionDescriptor(service);
            if (descriptor === null) {
                res.sendStatus(404);
                return;
            }
            sendJson(res, descriptor);
        },
    };
}

function sendJson(res: Response, body: unknown): void {
    res.set('Content-Type', 'application/json');
    res.set('Cache-Control', 'no-cache');
    res.send(Buffer.from(JSON.stringify(body)));
}

function param(req: Request, name: string): number | null {
    const value = req.params[name];
    if (typeof value !== 'string' || !SERVICE_ID.test(value)) {
        return null;
    }
    return Number(value);
}
