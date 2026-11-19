import { InitInfo, readBoxes, readInit, readSegment, shiftSegment } from '../media';

// Split of a fragmented MP4 into the initialization segment and one media
// segment per fragment, with the decode times shifted.

export type SplitResult = {
    init: Buffer;
    initInfo: InitInfo;
    segments: Buffer[];
};

const INIT_BOXES = new Set(['ftyp', 'moov', 'free']);
const TRAILING_BOXES = new Set(['mfra', 'free']);

export function splitFragmented(file: Buffer, decodeTimeOffset: bigint): SplitResult {
    const boxes = readBoxes(file, 0, file.length);
    const firstMoof = boxes.findIndex((box) => box.type === 'moof');
    if (firstMoof < 0) {
        throw new Error('encoded file has no fragment');
    }
    for (const box of boxes.slice(0, firstMoof)) {
        if (!INIT_BOXES.has(box.type)) {
            throw new Error(`unexpected box '${box.type}' before the first fragment`);
        }
    }
    const init = file.subarray(0, boxes[firstMoof].start);
    const initInfo = readInit(init);

    const segments: Buffer[] = [];
    let index = firstMoof;
    while (index < boxes.length && !TRAILING_BOXES.has(boxes[index].type)) {
        const moof = boxes[index];
        const mdat = boxes[index + 1];
        if (moof.type !== 'moof' || mdat === undefined || mdat.type !== 'mdat') {
            throw new Error(`expected moof and mdat at byte ${moof.start}`);
        }
        const bytes = Buffer.from(file.subarray(moof.start, mdat.end));
        const info = readSegment(bytes, initInfo);
        const timePatches = info.patches.filter((patch) => patch.field === 'time');
        segments.push(shiftSegment(bytes, timePatches, decodeTimeOffset, 0));
        index += 2;
    }
    return { init: Buffer.from(init), initInfo, segments };
}
