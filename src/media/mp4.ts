// ISO BMFF (ISO/IEC 14496-12) reading: the boxes of an initialization
// segment and of fragmented media segments that the preparation tool and the
// live simulator need.

export type Box = {
    type: string;
    start: number;
    bodyStart: number;
    end: number;
};

export type TrackKind = 'video' | 'audio';

export type InitInfo = {
    kind: TrackKind;
    timescale: number;
    codecs: string;
    width: number | null;
    height: number | null;
    sampleRate: number | null;
    defaultSampleDuration: number;
    defaultSampleFlags: number;
};

// A field of a media segment that the live simulator shifts on each lap.
export type Patch = {
    offset: number;
    size: 4 | 8;
    field: 'time' | 'sequence';
};

export type SegmentInfo = {
    fragmentCount: number;
    // baseMediaDecodeTime of the first traf of the first moof.
    firstDecodeTime: bigint;
    // Every tfdt version found, in order.
    tfdtVersions: number[];
    sidxVersions: number[];
    duration: number;
    firstSampleIsSync: boolean;
    patches: Patch[];
};

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf']);
const SAMPLE_IS_NON_SYNC = 0x00010000;
const TFHD_BASE_DATA_OFFSET = 0x01;
const TFHD_SAMPLE_DESCRIPTION_INDEX = 0x02;
const TFHD_DEFAULT_DURATION = 0x08;
const TFHD_DEFAULT_SIZE = 0x10;
const TFHD_DEFAULT_FLAGS = 0x20;
const TRUN_DATA_OFFSET = 0x01;
const TRUN_FIRST_SAMPLE_FLAGS = 0x04;
const TRUN_SAMPLE_DURATION = 0x100;
const TRUN_SAMPLE_SIZE = 0x200;
const TRUN_SAMPLE_FLAGS = 0x400;
const TRUN_SAMPLE_CTO = 0x800;
const VISUAL_SAMPLE_ENTRY_SIZE = 78;
const AUDIO_SAMPLE_ENTRY_SIZE = 28;
const ES_DESCRIPTOR_TAG = 0x03;
const DECODER_CONFIG_TAG = 0x04;
const DECODER_SPECIFIC_INFO_TAG = 0x05;

export function readBoxes(buf: Buffer, start: number, end: number): Box[] {
    const boxes: Box[] = [];
    let offset = start;
    while (offset < end) {
        if (offset + 8 > end) {
            throw new Error(`truncated box header at byte ${offset}`);
        }
        let size = buf.readUInt32BE(offset);
        const type = buf.toString('latin1', offset + 4, offset + 8);
        let headerSize = 8;
        if (size === 1) {
            size = Number(buf.readBigUInt64BE(offset + 8));
            headerSize = 16;
        }
        else if (size === 0) {
            size = end - offset;
        }
        if (size < headerSize || offset + size > end) {
            throw new Error(`box '${type}' at byte ${offset} overruns its parent`);
        }
        boxes.push({ type, start: offset, bodyStart: offset + headerSize, end: offset + size });
        offset += size;
    }
    return boxes;
}

export function readInit(buf: Buffer): InitInfo {
    const top = readBoxes(buf, 0, buf.length);
    const moov = requireBox(top, 'moov');
    const moovChildren = readBoxes(buf, moov.bodyStart, moov.end);
    const traks = moovChildren.filter((box) => box.type === 'trak');
    if (traks.length !== 1) {
        throw new Error(`initialization segment has ${traks.length} tracks; exactly one is required`);
    }
    const mdia = requireBox(children(buf, traks[0]), 'mdia');
    const mdiaChildren = children(buf, mdia);
    const timescale = readMdhdTimescale(buf, requireBox(mdiaChildren, 'mdhd'));
    const handler = readHandler(buf, requireBox(mdiaChildren, 'hdlr'));
    const stbl = requireBox(children(buf, requireBox(mdiaChildren, 'minf')), 'stbl');
    const stsd = requireBox(children(buf, stbl), 'stsd');
    const entry = readBoxes(buf, stsd.bodyStart + 8, stsd.end)[0];
    if (entry === undefined) {
        throw new Error('stsd has no sample entry');
    }
    const mvex = requireBox(moovChildren, 'mvex');
    const trex = requireBox(children(buf, mvex), 'trex');
    const defaultSampleDuration = buf.readUInt32BE(trex.bodyStart + 12);
    const defaultSampleFlags = buf.readUInt32BE(trex.bodyStart + 20);

    switch (handler) {
        case 'vide': {
            const width = buf.readUInt16BE(entry.bodyStart + 24);
            const height = buf.readUInt16BE(entry.bodyStart + 26);
            const codecs = readVideoCodecs(buf, entry);
            return { kind: 'video', timescale, codecs, width, height, sampleRate: null,
                defaultSampleDuration, defaultSampleFlags };
        }
        case 'soun': {
            const codecs = readAudioCodecs(buf, entry);
            return { kind: 'audio', timescale, codecs, width: null, height: null, sampleRate: timescale,
                defaultSampleDuration, defaultSampleFlags };
        }
        default:
            throw new Error(`track handler '${handler}' is neither video nor audio`);
    }
}

export function readSegment(buf: Buffer, init: InitInfo): SegmentInfo {
    const top = readBoxes(buf, 0, buf.length);
    const info: SegmentInfo = {
        fragmentCount: 0,
        firstDecodeTime: BigInt(-1),
        tfdtVersions: [],
        sidxVersions: [],
        duration: 0,
        firstSampleIsSync: false,
        patches: [],
    };
    for (const box of top) {
        switch (box.type) {
            case 'moof':
                readMoof(buf, box, init, info);
                break;
            case 'sidx': {
                const version = buf.readUInt8(box.bodyStart);
                info.sidxVersions.push(version);
                if (version === 1) {
                    info.patches.push({ offset: box.bodyStart + 12, size: 8, field: 'time' });
                }
                break;
            }
            case 'emsg': {
                const version = buf.readUInt8(box.bodyStart);
                if (version === 1) {
                    info.patches.push({ offset: box.bodyStart + 8, size: 8, field: 'time' });
                }
                break;
            }
            default:
                break;
        }
    }
    if (info.fragmentCount === 0) {
        throw new Error('segment has no moof');
    }
    return info;
}

// Returns a copy of the segment with the time fields shifted by timeDelta and
// the sequence numbers by sequenceDelta (4.6, step 4).
export function shiftSegment(buf: Buffer, patches: Patch[], timeDelta: bigint, sequenceDelta: number): Buffer {
    const copy = Buffer.from(buf);
    for (const patch of patches) {
        if (patch.offset + patch.size > copy.length) {
            throw new Error(`patch at byte ${patch.offset} is beyond the segment`);
        }
        switch (patch.field) {
            case 'time': {
                const value = copy.readBigUInt64BE(patch.offset);
                copy.writeBigUInt64BE(value + timeDelta, patch.offset);
                break;
            }
            case 'sequence': {
                const value = copy.readUInt32BE(patch.offset);
                copy.writeUInt32BE(value + sequenceDelta, patch.offset);
                break;
            }
            default:
                break;
        }
    }
    return copy;
}

function readMoof(buf: Buffer, moof: Box, init: InitInfo, info: SegmentInfo): void {
    const moofChildren = children(buf, moof);
    const mfhd = requireBox(moofChildren, 'mfhd');
    info.patches.push({ offset: mfhd.bodyStart + 4, size: 4, field: 'sequence' });
    const isFirstFragment = info.fragmentCount === 0;
    info.fragmentCount += 1;

    const trafs = moofChildren.filter((box) => box.type === 'traf');
    for (const [trafIndex, traf] of trafs.entries()) {
        const trafChildren = children(buf, traf);
        const tfhd = requireBox(trafChildren, 'tfhd');
        const defaults = readTfhdDefaults(buf, tfhd, init);
        const tfdt = requireBox(trafChildren, 'tfdt');
        const version = buf.readUInt8(tfdt.bodyStart);
        info.tfdtVersions.push(version);
        if (version === 1) {
            info.patches.push({ offset: tfdt.bodyStart + 4, size: 8, field: 'time' });
        }
        if (isFirstFragment && trafIndex === 0) {
            info.firstDecodeTime = version === 1
                ? buf.readBigUInt64BE(tfdt.bodyStart + 4)
                : BigInt(buf.readUInt32BE(tfdt.bodyStart + 4));
        }
        const truns = trafChildren.filter((box) => box.type === 'trun');
        for (const [trunIndex, trun] of truns.entries()) {
            const run = readTrun(buf, trun, defaults);
            info.duration += run.duration;
            if (isFirstFragment && trafIndex === 0 && trunIndex === 0) {
                info.firstSampleIsSync = (run.firstSampleFlags & SAMPLE_IS_NON_SYNC) === 0;
            }
        }
    }
}

function readTfhdDefaults(buf: Buffer, tfhd: Box, init: InitInfo): { duration: number; flags: number } {
    const flags = buf.readUInt32BE(tfhd.bodyStart) & 0xffffff;
    let offset = tfhd.bodyStart + 8;
    let duration = init.defaultSampleDuration;
    let sampleFlags = init.defaultSampleFlags;
    if (flags & TFHD_BASE_DATA_OFFSET) {
        offset += 8;
    }
    if (flags & TFHD_SAMPLE_DESCRIPTION_INDEX) {
        offset += 4;
    }
    if (flags & TFHD_DEFAULT_DURATION) {
        duration = buf.readUInt32BE(offset);
        offset += 4;
    }
    if (flags & TFHD_DEFAULT_SIZE) {
        offset += 4;
    }
    if (flags & TFHD_DEFAULT_FLAGS) {
        sampleFlags = buf.readUInt32BE(offset);
    }
    return { duration, flags: sampleFlags };
}

function readTrun(buf: Buffer, trun: Box, defaults: { duration: number; flags: number }):
    { duration: number; firstSampleFlags: number } {
    const flags = buf.readUInt32BE(trun.bodyStart) & 0xffffff;
    const sampleCount = buf.readUInt32BE(trun.bodyStart + 4);
    let offset = trun.bodyStart + 8;
    let firstSampleFlags = defaults.flags;
    let hasFirstSampleFlags = false;
    if (flags & TRUN_DATA_OFFSET) {
        offset += 4;
    }
    if (flags & TRUN_FIRST_SAMPLE_FLAGS) {
        firstSampleFlags = buf.readUInt32BE(offset);
        hasFirstSampleFlags = true;
        offset += 4;
    }
    let duration = 0;
    for (let sample = 0; sample < sampleCount; sample++) {
        if (flags & TRUN_SAMPLE_DURATION) {
            duration += buf.readUInt32BE(offset);
            offset += 4;
        }
        else {
            duration += defaults.duration;
        }
        if (flags & TRUN_SAMPLE_SIZE) {
            offset += 4;
        }
        if (flags & TRUN_SAMPLE_FLAGS) {
            if (sample === 0 && !hasFirstSampleFlags) {
                firstSampleFlags = buf.readUInt32BE(offset);
            }
            offset += 4;
        }
        if (flags & TRUN_SAMPLE_CTO) {
            offset += 4;
        }
    }
    return { duration, firstSampleFlags };
}

function readMdhdTimescale(buf: Buffer, mdhd: Box): number {
    const version = buf.readUInt8(mdhd.bodyStart);
    const timescaleOffset = version === 1 ? 20 : 12;
    return buf.readUInt32BE(mdhd.bodyStart + timescaleOffset);
}

function readHandler(buf: Buffer, hdlr: Box): string {
    return buf.toString('latin1', hdlr.bodyStart + 8, hdlr.bodyStart + 12);
}

// RFC 6381 codecs parameter of an AVC sample entry.
function readVideoCodecs(buf: Buffer, entry: Box): string {
    switch (entry.type) {
        case 'avc1':
        case 'avc3': {
            const entryChildren = readBoxes(buf, entry.bodyStart + VISUAL_SAMPLE_ENTRY_SIZE, entry.end);
            const avcC = requireBox(entryChildren, 'avcC');
            const profile = buf.subarray(avcC.bodyStart + 1, avcC.bodyStart + 4).toString('hex');
            return `${entry.type}.${profile}`;
        }
        default:
            throw new Error(`video sample entry '${entry.type}' is not supported`);
    }
}

// RFC 6381 codecs parameter of an MPEG-4 audio sample entry.
function readAudioCodecs(buf: Buffer, entry: Box): string {
    switch (entry.type) {
        case 'mp4a': {
            const entryChildren = readBoxes(buf, entry.bodyStart + AUDIO_SAMPLE_ENTRY_SIZE, entry.end);
            const esds = requireBox(entryChildren, 'esds');
            const config = readDecoderConfig(buf, esds.bodyStart + 4, esds.end);
            const objectType = config.objectTypeIndication.toString(16);
            return `mp4a.${objectType}.${config.audioObjectType}`;
        }
        default:
            throw new Error(`audio sample entry '${entry.type}' is not supported`);
    }
}

// ISO/IEC 14496-1 ES_Descriptor, down to the AudioSpecificConfig.
function readDecoderConfig(buf: Buffer, start: number, end: number):
    { objectTypeIndication: number; audioObjectType: number } {
    let offset = start;
    let objectTypeIndication = -1;
    let audioObjectType = -1;
    while (offset < end) {
        const tag = buf.readUInt8(offset);
        const length = readDescriptorLength(buf, offset + 1);
        const body = offset + 1 + length.bytes;
        switch (tag) {
            case ES_DESCRIPTOR_TAG: {
                const esFlags = buf.readUInt8(body + 2);
                let next = body + 3;
                if (esFlags & 0x80) {
                    next += 2;
                }
                if (esFlags & 0x40) {
                    next += 1 + buf.readUInt8(next);
                }
                if (esFlags & 0x20) {
                    next += 2;
                }
                offset = next;
                break;
            }
            case DECODER_CONFIG_TAG:
                objectTypeIndication = buf.readUInt8(body);
                offset = body + 13;
                break;
            case DECODER_SPECIFIC_INFO_TAG:
                audioObjectType = buf.readUInt8(body) >> 3;
                offset = end;
                break;
            default:
                offset = body + length.value;
                break;
        }
    }
    if (objectTypeIndication < 0 || audioObjectType < 0) {
        throw new Error('esds has no decoder configuration');
    }
    return { objectTypeIndication, audioObjectType };
}

function readDescriptorLength(buf: Buffer, offset: number): { value: number; bytes: number } {
    let value = 0;
    let bytes = 0;
    let byte = 0x80;
    while ((byte & 0x80) !== 0 && bytes < 4) {
        byte = buf.readUInt8(offset + bytes);
        value = (value << 7) | (byte & 0x7f);
        bytes += 1;
    }
    return { value, bytes };
}

function children(buf: Buffer, box: Box): Box[] {
    if (!CONTAINERS.has(box.type)) {
        throw new Error(`box '${box.type}' is not a container`);
    }
    return readBoxes(buf, box.bodyStart, box.end);
}

function requireBox(boxes: Box[], type: string): Box {
    const box = boxes.find((candidate) => candidate.type === type);
    if (box === undefined) {
        throw new Error(`box '${type}' not found`);
    }
    return box;
}
