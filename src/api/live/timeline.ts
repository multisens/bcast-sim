// Window arithmetic of the live simulator (4.7). Segment numbers start at 1.

export type TimelineInput = {
    availabilityStartMs: number;
    timescale: number;
    segmentDuration: number;
    segmentCount: number;
    windowSize: number;
};

export type DiskPosition = {
    index: number;
    lap: number;
};

const MS_PER_SECOND = 1000;

// L: the last available segment number; below 1, none is available yet.
export function lastAvailable(input: TimelineInput, nowMs: number): number {
    const elapsedMs = nowMs - input.availabilityStartMs;
    if (elapsedMs < 0) {
        return 0;
    }
    const elapsedUnits = BigInt(elapsedMs) * BigInt(input.timescale) / BigInt(MS_PER_SECOND);
    return Number(elapsedUnits / BigInt(input.segmentDuration));
}

// P: the first segment number of the HLS playlist.
export function playlistFirst(input: TimelineInput, last: number): number {
    return Math.max(1, last - input.windowSize + 1);
}

// The first available segment number: one beyond the playlist window, the
// end of availability of the MPD.
export function availableFirst(input: TimelineInput, last: number): number {
    return Math.max(1, last - input.windowSize);
}

export function isAvailable(input: TimelineInput, last: number, segmentNumber: number): boolean {
    return segmentNumber >= availableFirst(input, last) && segmentNumber <= last;
}

export function diskPosition(input: TimelineInput, segmentNumber: number): DiskPosition {
    const index = (segmentNumber - 1) % input.segmentCount;
    const lap = Math.floor((segmentNumber - 1) / input.segmentCount);
    return { index, lap };
}

// Whole seconds until segment 1 becomes available, for Retry-After.
export function secondsUntilFirstSegment(input: TimelineInput, nowMs: number): number {
    const firstAvailableMs = input.availabilityStartMs
        + input.segmentDuration * MS_PER_SECOND / input.timescale;
    const waitMs = firstAvailableMs - nowMs;
    return Math.max(1, Math.ceil(waitMs / MS_PER_SECOND));
}
