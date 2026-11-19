import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diskPosition, isAvailable, lastAvailable, playlistFirst, secondsUntilFirstSegment } from '../src/api/live/timeline';

// The example: D = 360000 (4 s at 90 kHz), N = 120, k = 5.
const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');
const TIMELINE = {
    availabilityStartMs: EPOCH_MS,
    timescale: 90000,
    segmentDuration: 360000,
    segmentCount: 120,
    windowSize: 5,
};

test('4.7 example: 4150 s after the epoch', () => {
    const last = lastAvailable(TIMELINE, EPOCH_MS + 4150 * 1000);
    assert.equal(last, 1037);
    assert.equal(playlistFirst(TIMELINE, last), 1033);
    assert.deepEqual(diskPosition(TIMELINE, 1037), { index: 76, lap: 8 });
});

test('availability spans one segment beyond the playlist window', () => {
    const last = 1037;
    assert.equal(isAvailable(TIMELINE, last, 1032), true);
    assert.equal(isAvailable(TIMELINE, last, 1031), false);
    assert.equal(isAvailable(TIMELINE, last, 1038), false);
});

test('no segment before one segment duration has elapsed', () => {
    assert.equal(lastAvailable(TIMELINE, EPOCH_MS - 1000), 0);
    assert.equal(lastAvailable(TIMELINE, EPOCH_MS + 3999), 0);
    assert.equal(lastAvailable(TIMELINE, EPOCH_MS + 4000), 1);
    assert.equal(secondsUntilFirstSegment(TIMELINE, EPOCH_MS + 1500), 3);
});
