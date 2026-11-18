import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { test } from 'node:test';
import { mpd } from '../src/api/live';
import { llsResponse, slsPackage } from '../src/api/signaling';
import {
    LoadedService, baldSchema, emissionDescriptorSchema, envelopeSchema, llsResponseSchema, nextVersion, prrdSchema,
    servicesDirOf, stsidSchema, usbdSchema,
} from '../src/modules/emission';
import { LoadedStream } from '../src/modules/streams';
import {
    BSID, LIVE_BASE_URL, SERVICE_ID, applicationDeclaration, carouselDeclaration, channelFile, load,
    serviceDeclaration, serviceDirOf, writeEmission, writeJson,
} from './helpers/emission-fixtures';
import { videoFixture, writeFixture } from './helpers/fixtures';

type Part = {
    headers: Map<string, string>;
    body: string;
};

const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');
const NOW_MS = EPOCH_MS + 4150 * 1000;

test('a complete emission loads and every fragment validates against its schema (M2)', () => {
    const { load: result, streams } = load(writeEmission());
    assert.deepEqual(result.refusals, []);
    const lls = llsResponseSchema.parse(llsResponse([...result.channels.values()]));
    assert.equal(lls.rfChannels[0].bsid, BSID);
    assert.equal(lls.rfChannels[0].llsCyclePeriod, 5000);
    assert.deepEqual(lls.rfChannels[0].tables.map((table) => table.LLS_table_id), [1, 144]);

    const service = loadedService(result.services.get(SERVICE_ID));
    const parts = parseMultipart(packageOf(service, streams));
    const envelope = envelopeSchema.parse(JSON.parse(parts[0].body));
    assert.equal(parts[0].headers.get('content-location'), 'envelope');
    assert.deepEqual(envelope.item.map((item) => item.metadataURI), ['usbd', 'stsid', 'mpd', 'bald', 'prrd']);
    const schemas = { usbd: usbdSchema, stsid: stsidSchema, bald: baldSchema, prrd: prrdSchema };
    for (const part of parts.slice(1)) {
        const location = part.headers.get('content-location');
        switch (location) {
            case 'usbd':
            case 'stsid':
            case 'bald':
            case 'prrd':
                schemas[location].parse(JSON.parse(part.body));
                assert.equal(part.headers.get('content-type'), 'application/json');
                break;
            case 'mpd':
                assert.equal(part.headers.get('content-type'), 'application/dash+xml');
                break;
            default:
                assert.fail(`unexpected part ${location}`);
        }
    }
    emissionDescriptorSchema.parse(service.descriptor);
});

test('the MPD of the SLS package is the one of the live simulator, video first', () => {
    const { load: result, streams } = load(writeEmission());
    const service = loadedService(result.services.get(SERVICE_ID));
    const parts = parseMultipart(packageOf(service, streams));
    const part = parts.find((candidate) => candidate.headers.get('content-location') === 'mpd');
    const video = liveMedia(streams, 'video');
    const audio = liveMedia(streams, 'audio');
    const expected = mpd([video, audio], LIVE_BASE_URL, NOW_MS);
    assert.ok(expected !== null);
    assert.equal(part?.body, expected.body);
    const envelope = envelopeSchema.parse(JSON.parse(parts[0].body));
    const item = envelope.item.find((candidate) => candidate.metadataURI === 'mpd');
    assert.equal(item?.version, expected.publishTimeMs);
    assert.ok((part?.body ?? '').indexOf('contentType="video"') < (part?.body ?? '').indexOf('contentType="audio"'));
});

test('the SLS package is not available before the first segment', () => {
    const { load: result, streams } = load(writeEmission());
    const service = loadedService(result.services.get(SERVICE_ID));
    assert.equal(slsPackage(service, [...streams.values()], LIVE_BASE_URL, EPOCH_MS + 1000).kind, 'not-yet');
});

test('a changed declaration changes the version of its fragment and only of it (M2)', () => {
    const emissionDir = writeEmission();
    const first = load(emissionDir).load;
    const serviceDir = serviceDirOf(emissionDir);

    const application = applicationDeclaration();
    application[0].appName = 'Outra';
    writeJson(path.join(serviceDir, 'aplicacao.json'), application, 5);
    const second = load(emissionDir, first.versions).load;
    assert.deepEqual(changedKeys(first.versions, second.versions), ['sls/1001/bald']);

    const service = serviceDeclaration();
    (service.bam as Record<string, unknown>).appName = 'Outro nome';
    writeJson(path.join(serviceDir, 'servico.json'), service, 10);
    const third = load(emissionDir, second.versions).load;
    assert.deepEqual(changedKeys(second.versions, third.versions), ['lls/10/bamt']);

    const carousel = carouselDeclaration();
    carousel.signalingCyclePeriod = 2000;
    writeJson(path.join(serviceDir, 'carrossel.json'), carousel, 15);
    const fourth = load(emissionDir, third.versions).load;
    assert.deepEqual(changedKeys(third.versions, fourth.versions), []);
    assert.equal(fourth.services.get(SERVICE_ID)?.descriptor?.signaling.cyclePeriod, 2000);
});

test('a version grows even when the modification time does not, and LLS_table_version wraps at 256', () => {
    const previous = { content: 'a', version: 300 };
    assert.equal(nextVersion(previous, 'a', 500, null), previous);
    assert.equal(nextVersion(previous, 'b', 200, null).version, 301);
    assert.equal(nextVersion(previous, 'b', 500, null).version, 500);
    assert.equal(nextVersion(undefined, 'b', 513, 256).version, 1);
    assert.equal(nextVersion({ content: 'a', version: 1 }, 'b', 513, 256).version, 2);
});

test('the BAM carries the icons as SVG text, and an icon that is not SVG refuses the service', () => {
    const emissionDir = writeEmission();
    const bamt = load(emissionDir).load.channels.get(BSID)?.bamt;
    assert.match(bamt?.content.BAM[0].appIcon ?? '', /^<svg /);
    fs.writeFileSync(path.join(serviceDirOf(emissionDir), 'arquivos', 'icone.svg'), 'not svg');
    const result = load(emissionDir).load;
    assert.equal(result.services.size, 0);
    assert.match(result.refusals.map((refusal) => refusal.reason).join('\n'), /icon 'arquivos\/icone\.svg'/);
});

test('declaration rules that cross files refuse the service', () => {
    const cases: { name: string; change: (emissionDir: string) => void; reason: RegExp }[] = [
        {
            name: 'Broadband without MPD.BaseURL among the unicast patterns',
            change: (emissionDir) => {
                const service = serviceDeclaration();
                (service.delivery as Record<string, unknown>).unicastBasePatterns = ['http://elsewhere/'];
                writeJson(path.join(serviceDirOf(emissionDir), 'servico.json'), service);
            },
            reason: /MPD\.BaseURL/,
        },
        {
            name: 'lctTSIRef outside the carousel',
            change: (emissionDir) => {
                const application = applicationDeclaration();
                application[0].lctTSIRef = [99];
                writeJson(path.join(serviceDirOf(emissionDir), 'aplicacao.json'), application);
            },
            reason: /lctTSIRef 99/,
        },
        {
            name: 'carousel file missing',
            change: (emissionDir) => {
                fs.rmSync(path.join(serviceDirOf(emissionDir), 'arquivos', 'app', 'style.css'));
            },
            reason: /app\/style\.css/,
        },
        {
            name: 'segment flow with more than the initialization segment',
            change: (emissionDir) => {
                const carousel = carouselDeclaration();
                const flows = carousel.flows as Record<string, unknown>[];
                const extra = { contentLocation: 'live/video/other.mp4', contentType: 'video/mp4' };
                (flows[1].files as unknown[]).push(extra);
                writeJson(path.join(serviceDirOf(emissionDir), 'carrossel.json'), carousel);
            },
            reason: /exactly one file/,
        },
        {
            name: 'service in no channel',
            change: (emissionDir) => {
                writeJson(channelFile(emissionDir), { bsid: BSID, bandwidth: 6, bamtGroupingType: 'noGrouping',
                    services: [2002] });
            },
            reason: /not listed in exactly one channel/,
        },
        {
            name: 'majorChannelNo in a type 31 service',
            change: (emissionDir) => {
                const service = serviceDeclaration();
                (service.slt as Record<string, unknown>).serviceCategory = 31;
                writeJson(path.join(serviceDirOf(emissionDir), 'servico.json'), service);
            },
            reason: /only allowed in type 30/,
        },
    ];
    for (const testCase of cases) {
        const emissionDir = writeEmission();
        testCase.change(emissionDir);
        const result = load(emissionDir).load;
        assert.equal(result.services.size, 0, testCase.name);
        assert.match(result.refusals.map((refusal) => refusal.reason).join('\n'), testCase.reason, testCase.name);
    }
});

test('a declaration references the base URLs as variables, and an unknown one refuses it', () => {
    const emissionDir = writeEmission();
    const slt = load(emissionDir).load.channels.get(BSID)?.slt.content;
    assert.equal(slt?.Service[0].SvcInetUrl?.[0].value, 'http://bcast-sim:8082/signaling/sls/1001');
    const service = serviceDeclaration();
    (service.slt as Record<string, unknown>).svcInetUrl = [{ urlType: 1, url: '${UNKNOWN_URL}sls/1001' }];
    writeJson(path.join(serviceDirOf(emissionDir), 'servico.json'), service);
    const result = load(emissionDir).load;
    assert.equal(result.services.size, 0);
    assert.match(result.refusals.map((refusal) => refusal.reason).join('\n'), /unknown variable UNKNOWN_URL/);
});

test('a type 31 service needs a type 30 service that names it in additionalServices', () => {
    const emissionDir = writeEmission();
    const extra = serviceDeclaration();
    const slt = extra.slt as Record<string, unknown>;
    slt.serviceId = 1002;
    slt.globalServiceId = 'urn:sbtvd:tv3.0:service:1002';
    slt.serviceCategory = 31;
    delete slt.majorChannelNo;
    delete slt.minorChannelNo;
    delete extra.bam;
    writeJson(path.join(serviceDirOf(emissionDir, 1002), 'servico.json'), extra);
    writeFixture(servicesDirOf(emissionDir), videoFixture({ serviceId: '1002', streamId: 'video-1002' }));
    writeJson(channelFile(emissionDir), { bsid: BSID, bandwidth: 6, bamtGroupingType: 'noGrouping',
        services: [SERVICE_ID, 1002] });
    const result = load(emissionDir).load;
    assert.match(result.refusals.map((refusal) => refusal.reason).join('\n'), /additionalServices of a type 30/);
    assert.ok(result.services.has(SERVICE_ID));
    assert.ok(!result.services.has(1002));
});

function loadedService(service: LoadedService | undefined): LoadedService {
    assert.ok(service !== undefined);
    return service;
}

function packageOf(service: LoadedService, streams: Map<string, LoadedStream>): { contentType: string; body: string } {
    const result = slsPackage(service, [...streams.values()], LIVE_BASE_URL, NOW_MS);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') {
        throw new Error('no package');
    }
    return result.package;
}

function liveMedia(streams: Map<string, LoadedStream>, streamId: string):
    { stream: LoadedStream; media: NonNullable<LoadedStream['media']> } {
    const stream = streams.get(streamId);
    assert.ok(stream !== undefined && stream.media !== null);
    return { stream, media: stream.media };
}

function changedKeys(before: Map<string, { version: number }>, after: Map<string, { version: number }>): string[] {
    return [...after.keys()].filter((key) => before.get(key)?.version !== after.get(key)?.version).sort();
}

// RFC 2387: the boundary comes from the Content-Type.
function parseMultipart(pkg: { contentType: string; body: string }): Part[] {
    const boundary = /boundary=([^;]+)/.exec(pkg.contentType)?.[1];
    assert.ok(boundary !== undefined);
    assert.match(pkg.contentType, /^multipart\/related; type="application\/json"; /);
    const sections = pkg.body.split(`--${boundary}`);
    assert.equal(sections[sections.length - 1], '--\r\n');
    return sections.slice(1, -1).map((section) => {
        const [head, ...rest] = section.replace(/^\r\n/, '').replace(/\r\n$/, '').split('\r\n\r\n');
        const headers = new Map(head.split('\r\n').map((line) => {
            const [name, value] = line.split(': ');
            return [name.toLowerCase(), value];
        }));
        return { headers, body: rest.join('\r\n\r\n') };
    });
}
