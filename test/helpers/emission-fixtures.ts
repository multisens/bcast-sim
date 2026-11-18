import fs from 'fs';
import path from 'path';
import { EmissionContext, EmissionLoad, VersionRecord, loadEmission, servicesDirOf } from '../../src/modules/emission';
import { LoadedStream, loadStreams } from '../../src/modules/streams';
import { audioFixture, tempServicesDir, videoFixture, writeFixture } from './fixtures';

// An emission directory with one channel and one service of each kind of
// declaration, over the stream fixtures.

export const LIVE_BASE_URL = 'http://localhost:8082/live/';
export const SERVICES_BASE_URL = 'http://bcast-sim:8082/services/';
export const SIGNALING_BASE_URL = 'http://bcast-sim:8082/signaling/';
export const SERVICE_ID = 1001;
export const BSID = 10;
export const APP_CONTEXT_ID = 'urn:sbtvd:app:1001:hello';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>\n';

export function serviceDeclaration(): Record<string, unknown> {
    return {
        slt: {
            serviceId: SERVICE_ID,
            globalServiceId: 'urn:sbtvd:tv3.0:service:1001',
            serviceCategory: 30,
            shortServiceName: 'SINTET',
            majorChannelNo: 10,
            minorChannelNo: 1,
            broadbandAccessRequired: true,
            sltSvcSeqNum: 0,
            svcInetUrl: [{ urlType: 1, url: '${SIGNALING_BASE_URL}sls/1001' }],
        },
        bam: {
            appVersion: 1,
            appName: 'Sintetico',
            backgroundColor: '#101820',
            foregroundColor: '#FFFFFF',
            appIcon: 'arquivos/icone.svg',
            bannerIcon: 'arquivos/banner.svg',
        },
        delivery: {
            configuration: 'Broadband',
            mainAvOverTheAir: true,
            receptionQuality: 80,
            broadcastBasePatterns: ['http://localhost:8082/services/1001/live/'],
            unicastBasePatterns: ['${LIVE_BASE_URL}'],
        },
    };
}

export function applicationDeclaration(): Record<string, unknown>[] {
    return [{
        appContextId: APP_CONTEXT_ID,
        appType: 'TV30-Ginga-HTML5',
        appId: APP_CONTEXT_ID,
        appName: 'Ola',
        bbandEntryPointUrl: 'http://localhost:8082/services/1001/app/index.html',
        lctTSIRef: [10],
        targetApplication: { displayName: 'Ola', filter: [{ scheme: 'https' }] },
    }];
}

export function carouselDeclaration(): Record<string, unknown> {
    return {
        signalingCyclePeriod: 3000,
        cycleEpoch: '2026-01-01T00:00:00Z',
        flows: [
            {
                tsi: 10,
                cyclePeriod: 10000,
                maxExpiresDelta: 120,
                appContextIdList: [APP_CONTEXT_ID],
                files: [
                    { contentLocation: 'app/index.html', contentType: 'text/html' },
                    { contentLocation: 'app/style.css', contentType: 'text/css', order: 0 },
                ],
            },
            {
                tsi: 11,
                cyclePeriod: 4000,
                fileTemplate: 'live/video/seg/$TOI$.m4s',
                files: [{ contentLocation: 'live/video/init.mp4', contentType: 'video/mp4' }],
            },
        ],
    };
}

export function privacyDeclaration(): Record<string, unknown> {
    return {
        schemaVersion: 'PRRD-1.0-ABC-20251013',
        piiProcessing: [{
            privacyNotice: 'https://www.abc.tv/privacy/br/notice.html',
            language: 'pt-BR',
            broadcastNotice: 'privacy/notice.html',
            deliveryUrl: 'https://privacy.abc.tv/record/submit',
            initialDisclaimer: 'Este serviço processa dados pessoais.',
            purposes: {
                purpose: [{
                    id: 'p1',
                    type: 'dpv:PersonalisedAdvertising',
                    lawfulBasis: 'dpv:Consent',
                    value: 'Anúncios personalizados.',
                    piiInformation: {
                        pii: [{ type: 'pd:TVViewingBehaviour', optional: true, value: 'Histórico' }],
                        piiControllers: { partyId: ['ABC-TV'] },
                        storageLocations: 'BR',
                        retentionPeriod: 'P90D',
                        jurisdiction: 'BR',
                        recipientThirdParties: { partyId: [] },
                        withdrawalMethod: 'TV30AoP-privacyManager',
                        authorityParty: 'ANPD',
                    },
                }],
            },
        }],
        partyIdentification: {
            party: [
                { id: 'ABC-TV', type: 'dpv:DataController', partyName: 'ABC', partyAddress: 'Rua A',
                    partyContact: 'mailto:abc@example.org' },
                { id: 'ANPD', type: 'dpv:Authority', partyName: 'ANPD', partyAddress: 'Brasília',
                    partyContact: 'https://www.gov.br/anpd' },
            ],
        },
    };
}

export function writeEmission(): string {
    const emissionDir = tempServicesDir();
    const servicesDir = servicesDirOf(emissionDir);
    writeFixture(servicesDir, videoFixture({ audioStreamId: 'audio' }));
    writeFixture(servicesDir, audioFixture());
    writeJson(channelFile(emissionDir), { bsid: BSID, bandwidth: 6, bamtGroupingType: 'noGrouping',
        services: [SERVICE_ID] });
    const serviceDir = serviceDirOf(emissionDir);
    writeJson(path.join(serviceDir, 'servico.json'), serviceDeclaration());
    writeJson(path.join(serviceDir, 'aplicacao.json'), applicationDeclaration());
    writeJson(path.join(serviceDir, 'carrossel.json'), carouselDeclaration());
    writeJson(path.join(serviceDir, 'privacidade.json'), privacyDeclaration());
    fs.mkdirSync(path.join(serviceDir, 'arquivos', 'app'), { recursive: true });
    fs.writeFileSync(path.join(serviceDir, 'arquivos', 'icone.svg'), SVG);
    fs.writeFileSync(path.join(serviceDir, 'arquivos', 'banner.svg'), SVG);
    fs.writeFileSync(path.join(serviceDir, 'arquivos', 'app', 'index.html'), '<p>ola</p>\n');
    fs.writeFileSync(path.join(serviceDir, 'arquivos', 'app', 'style.css'), 'p {\n}\n');
    return emissionDir;
}

export function channelFile(emissionDir: string, bsid: number = BSID): string {
    return path.join(emissionDir, 'canais', `${bsid}.json`);
}

export function serviceDirOf(emissionDir: string, serviceId: number = SERVICE_ID): string {
    return path.join(servicesDirOf(emissionDir), String(serviceId));
}

// Writes the file and moves its modification time laterSeconds ahead, so
// that a rewrite within the same second still counts as newer.
export function writeJson(file: string, content: unknown, laterSeconds: number = 0): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(content));
    if (laterSeconds > 0) {
        const time = new Date(Date.now() + laterSeconds * 1000);
        fs.utimesSync(file, time, time);
    }
}

export function load(emissionDir: string, previous: Map<string, VersionRecord> = new Map()):
    { load: EmissionLoad; streams: Map<string, LoadedStream> } {
    const streams = loadStreams(servicesDirOf(emissionDir), new Map()).streams;
    const context: EmissionContext = {
        emissionDir,
        bases: { servicesBaseUrl: SERVICES_BASE_URL, signalingBaseUrl: SIGNALING_BASE_URL },
        liveBaseUrl: LIVE_BASE_URL,
        variables: new Map([['LIVE_BASE_URL', LIVE_BASE_URL], ['SIGNALING_BASE_URL', SIGNALING_BASE_URL]]),
        streamsOfService: (serviceId: string) => [...streams.values()]
            .filter((stream) => stream.serviceId === serviceId)
            .sort((one, other) => one.declaration.streamId.localeCompare(other.declaration.streamId)),
    };
    return { load: loadEmission(context, previous), streams };
}
