import fs from 'fs';
import os from 'os';
import path from 'path';

// Minimal fragmented MP4 files and stream declarations for the tests.

export type FixtureStream = {
    serviceId: string;
    streamId: string;
    kind: 'video' | 'audio';
    timescale: number;
    sampleDuration: number;
    samplesPerSegment: number;
    segmentCount: number;
    firstDecodeTime: bigint;
    availabilityStartTime: string;
    windowSize: number;
    audioStreamId?: string;
    // Sample count of one segment, to build a segment of wrong duration.
    wrongSegment?: { index: number; samples: number };
};

export function tempServicesDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'bcast-sim-test-'));
}

export function videoFixture(overrides: Partial<FixtureStream> = {}): FixtureStream {
    return {
        serviceId: '1001',
        streamId: 'video',
        kind: 'video',
        timescale: 90000,
        sampleDuration: 3000,
        samplesPerSegment: 120,
        segmentCount: 8,
        firstDecodeTime: BigInt(8053110000),
        availabilityStartTime: '2026-01-01T00:00:00Z',
        windowSize: 5,
        ...overrides,
    };
}

export function audioFixture(overrides: Partial<FixtureStream> = {}): FixtureStream {
    return {
        serviceId: '1001',
        streamId: 'audio',
        kind: 'audio',
        timescale: 48000,
        sampleDuration: 1024,
        samplesPerSegment: 150,
        segmentCount: 10,
        firstDecodeTime: BigInt(4295040000),
        availabilityStartTime: '2026-01-01T00:00:00Z',
        windowSize: 5,
        ...overrides,
    };
}

export function writeFixture(servicesDir: string, stream: FixtureStream): void {
    const serviceDir = path.join(servicesDir, stream.serviceId);
    const mediaDir = path.join(serviceDir, 'segmentos', stream.streamId);
    const streamsDir = path.join(serviceDir, 'fluxos');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.mkdirSync(streamsDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'init.mp4'), initSegment(stream));

    const segmentUnits = stream.sampleDuration * stream.samplesPerSegment;
    let decodeTime = stream.firstDecodeTime;
    for (let index = 0; index < stream.segmentCount; index++) {
        const samples = stream.wrongSegment?.index === index ? stream.wrongSegment.samples : stream.samplesPerSegment;
        const name = `seg-${String(index).padStart(6, '0')}.m4s`;
        fs.writeFileSync(path.join(mediaDir, name), mediaSegment(stream, index + 1, decodeTime, samples));
        decodeTime += BigInt(stream.sampleDuration * samples);
    }

    const declaration = {
        streamId: stream.streamId,
        availabilityStartTime: stream.availabilityStartTime,
        segmentCount: stream.segmentCount,
        segmentTemplate: 'seg-%06d.m4s',
        initSegment: 'init.mp4',
        nominalDuration: segmentUnits / stream.timescale,
        segmentDurations: Array.from({ length: stream.segmentCount }, () => segmentUnits),
        timescale: stream.timescale,
        lapDuration: segmentUnits * stream.segmentCount,
        windowSize: stream.windowSize,
        representation: stream.kind === 'video'
            ? { mimeType: 'video/mp4', codecs: 'avc1.64001f', bandwidth: 1000000, width: 1280, height: 720,
                frameRate: '30' }
            : { mimeType: 'audio/mp4', codecs: 'mp4a.40.2', bandwidth: 96000, audioSamplingRate: 48000 },
        componentTag: stream.streamId,
        ...(stream.audioStreamId === undefined ? {} : { audioStreamId: stream.audioStreamId }),
    };
    fs.writeFileSync(path.join(streamsDir, `${stream.streamId}.json`), JSON.stringify(declaration));
}

export function readDeclaration(servicesDir: string, stream: FixtureStream): Record<string, unknown> {
    const file = path.join(servicesDir, stream.serviceId, 'fluxos', `${stream.streamId}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

export function writeDeclaration(servicesDir: string, stream: FixtureStream, declaration: Record<string, unknown>):
    void {
    const file = path.join(servicesDir, stream.serviceId, 'fluxos', `${stream.streamId}.json`);
    fs.writeFileSync(file, JSON.stringify(declaration));
}

function initSegment(stream: FixtureStream): Buffer {
    const handler = stream.kind === 'video' ? 'vide' : 'soun';
    const entry = stream.kind === 'video' ? avcEntry() : mp4aEntry();
    const stsd = fullBox('stsd', 0, 0, uint32(1), entry);
    const mdhd = fullBox('mdhd', 0, 0, uint32(0), uint32(0), uint32(stream.timescale), uint32(0), uint32(0));
    const hdlr = fullBox('hdlr', 0, 0, uint32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(13));
    const trak = box('trak', box('mdia', mdhd, hdlr, box('minf', box('stbl', stsd))));
    const trex = fullBox('trex', 0, 0, uint32(1), uint32(1), uint32(0), uint32(0), uint32(0));
    return Buffer.concat([box('ftyp', Buffer.from('isom', 'latin1'), uint32(0)),
        box('moov', trak, box('mvex', trex))]);
}

function mediaSegment(stream: FixtureStream, sequence: number, decodeTime: bigint, samples: number): Buffer {
    const tfhdFlags = 0x020008;
    const tfhd = fullBox('tfhd', 0, tfhdFlags, uint32(1), uint32(stream.sampleDuration));
    const tfdtTime = Buffer.alloc(8);
    tfdtTime.writeBigUInt64BE(decodeTime);
    const tfdt = fullBox('tfdt', 1, 0, tfdtTime);
    const trun = fullBox('trun', 0, 0x000004, uint32(samples), uint32(0x02000000));
    const moof = box('moof', fullBox('mfhd', 0, 0, uint32(sequence)), box('traf', tfhd, tfdt, trun));
    return Buffer.concat([moof, box('mdat', Buffer.alloc(16))]);
}

function avcEntry(): Buffer {
    const body = Buffer.alloc(78);
    body.writeUInt16BE(1, 6);
    body.writeUInt16BE(1280, 24);
    body.writeUInt16BE(720, 26);
    return box('avc1', body, box('avcC', Buffer.from([1, 0x64, 0x00, 0x1f, 0xff])));
}

function mp4aEntry(): Buffer {
    const body = Buffer.alloc(28);
    body.writeUInt16BE(1, 6);
    body.writeUInt16BE(2, 16);
    body.writeUInt32BE(48000 * 65536, 24);
    const decoderSpecific = Buffer.from([0x05, 0x02, 0x11, 0x90]);
    const decoderConfig = Buffer.concat([Buffer.from([0x04, 13 + decoderSpecific.length, 0x40, 0x15]),
        Buffer.alloc(11), decoderSpecific]);
    const esDescriptor = Buffer.concat([Buffer.from([0x03, 3 + decoderConfig.length, 0, 1, 0]), decoderConfig]);
    return box('mp4a', body, fullBox('esds', 0, 0, esDescriptor));
}

function box(type: string, ...payloads: Buffer[]): Buffer {
    const body = Buffer.concat(payloads);
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length + 8, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, body]);
}

function fullBox(type: string, version: number, flags: number, ...payloads: Buffer[]): Buffer {
    return box(type, uint32((version << 24) | flags), ...payloads);
}

function uint32(value: number): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value >>> 0);
    return buf;
}
