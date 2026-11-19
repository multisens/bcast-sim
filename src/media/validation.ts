import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Patch, readInit, readSegment } from './mp4';
import { StreamDeclaration } from './schema';

// Load checks of a stream declaration against its files, shared by the
// preparation tool and the live simulator.

export type CheckedMedia = {
    segmentDuration: number;
    firstDecodeTime: bigint;
    initPath: string;
    segmentPaths: string[];
    segmentPatches: Patch[][];
    fingerprint: string;
};

const DURATION_TOLERANCE = 1e-6;
const MIN_WINDOW_TARGET_DURATIONS = 3;

export function checkStream(declaration: StreamDeclaration, mediaDir: string): CheckedMedia {
    const segmentDuration = segmentDurationUnits(declaration);

    if (declaration.segmentDurations.length !== declaration.segmentCount) {
        throw new Error(`segmentDurations has ${declaration.segmentDurations.length} entries, `
            + `segmentCount is ${declaration.segmentCount}`);
    }
    for (const [index, duration] of declaration.segmentDurations.entries()) {
        if (duration !== segmentDuration) {
            throw new Error(`segmentDurations[${index}] is ${duration}, expected ${segmentDuration}`);
        }
    }

    const expectedLap = declaration.segmentCount * segmentDuration;
    if (declaration.lapDuration !== expectedLap) {
        throw new Error(`lapDuration is ${declaration.lapDuration}, expected ${expectedLap}`);
    }

    const hash = createHash('sha256');
    hash.update(JSON.stringify([declaration.segmentCount, declaration.nominalDuration, declaration.timescale]));

    const initPath = path.join(mediaDir, declaration.initSegment);
    const initBytes = fs.readFileSync(initPath);
    hash.update(initBytes);
    const init = readInit(initBytes);
    if (init.timescale !== declaration.timescale) {
        throw new Error(`mdhd timescale is ${init.timescale}, declared ${declaration.timescale}`);
    }

    const segmentPaths: string[] = [];
    const segmentPatches: Patch[][] = [];
    let firstDecodeTime = BigInt(0);
    for (let index = 0; index < declaration.segmentCount; index++) {
        const segmentPath = path.join(mediaDir, segmentFileName(declaration.segmentTemplate, index));
        const bytes = fs.readFileSync(segmentPath);
        hash.update(bytes);
        const segment = readSegment(bytes, init);

        if (segment.tfdtVersions.some((version) => version !== 1)) {
            throw new Error(`segment ${index} has a tfdt that is not version 1`);
        }
        if (segment.sidxVersions.some((version) => version !== 1)) {
            throw new Error(`segment ${index} has a sidx that is not version 1`);
        }
        if (index === 0) {
            firstDecodeTime = segment.firstDecodeTime;
        }
        const expectedDecodeTime = firstDecodeTime + BigInt(index) * BigInt(segmentDuration);
        if (segment.firstDecodeTime !== expectedDecodeTime) {
            throw new Error(`segment ${index} tfdt is ${segment.firstDecodeTime}, expected ${expectedDecodeTime}`);
        }
        if (segment.duration !== segmentDuration) {
            throw new Error(`segment ${index} lasts ${segment.duration}, expected ${segmentDuration}`);
        }
        segmentPaths.push(segmentPath);
        segmentPatches.push(segment.patches);
    }

    const targetDuration = Math.ceil(declaration.nominalDuration);
    const window = declaration.windowSize * declaration.nominalDuration;
    if (window < MIN_WINDOW_TARGET_DURATIONS * targetDuration) {
        throw new Error(`window of ${window} s is shorter than ${MIN_WINDOW_TARGET_DURATIONS} target durations`);
    }

    return {
        segmentDuration,
        firstDecodeTime,
        initPath,
        segmentPaths,
        segmentPatches,
        fingerprint: hash.digest('hex'),
    };
}

// D = nominalDuration × timescale.
export function segmentDurationUnits(declaration: StreamDeclaration): number {
    const exact = declaration.nominalDuration * declaration.timescale;
    const rounded = Math.round(exact);
    if (Math.abs(exact - rounded) > DURATION_TOLERANCE) {
        throw new Error(`nominalDuration × timescale is ${exact}, not an integer`);
    }
    return rounded;
}

// Formats a printf-like template with a single %d or %0Nd field.
export function segmentFileName(template: string, index: number): string {
    return template.replace(/%(0?)(\d*)d/, (_match, zero: string, width: string) => {
        const digits = String(index);
        if (width === '') {
            return digits;
        }
        return digits.padStart(Number(width), zero === '0' ? '0' : ' ');
    });
}
