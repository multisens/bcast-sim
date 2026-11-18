import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeTimeOffsetSeconds, planDurations, toSeconds } from '../src/prepare/durations';

test('8.2 example: 30 frames/s and AAC at 48 kHz over 480 s', () => {
    const plan = planDurations({
        videoFrameRate: { num: 30, den: 1 },
        audioSampleRate: 48000,
        audioFrameSize: 1024,
        sourceSeconds: 480.2,
        maxLapSeconds: null,
        targetSegmentSeconds: 4,
    });
    assert.deepEqual(plan.unit, { num: 8, den: 15 });
    assert.equal(toSeconds(plan.lap), 480);
    assert.equal(plan.video.segmentDurationUnits, 360000);
    assert.equal(plan.video.segmentCount, 120);
    assert.equal(plan.audio.segmentDurationUnits, 184320);
    assert.equal(plan.audio.segmentCount, 125);
});

test('29.97 frames/s gets a timescale with a whole frame duration', () => {
    const plan = planDurations({
        videoFrameRate: { num: 30000, den: 1001 },
        audioSampleRate: 48000,
        audioFrameSize: 1024,
        sourceSeconds: 600,
        maxLapSeconds: null,
        targetSegmentSeconds: 4,
    });
    const frameUnits = plan.video.timescale * 1001 / 30000;
    assert.ok(Number.isInteger(frameUnits));
    assert.equal(plan.video.segmentDurationUnits % frameUnits, 0);
});

test('decode time offset puts the first tfdt at or above 2^32', () => {
    const seconds = decodeTimeOffsetSeconds([90000, 48000]);
    assert.ok(seconds * 48000 >= 2 ** 32);
    assert.ok((seconds - 1) * 48000 < 2 ** 32);
});
