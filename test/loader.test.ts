import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { test } from 'node:test';
import { loadStreams } from '../src/modules/streams';
import { audioFixture, readDeclaration, tempServicesDir, videoFixture, writeDeclaration, writeFixture }
    from './helpers/fixtures';

test('a well-formed pair of streams loads', () => {
    const dir = tempServicesDir();
    writeFixture(dir, videoFixture({ audioStreamId: 'audio', segmentCount: 8 }));
    writeFixture(dir, audioFixture({ segmentCount: 10 }));
    const result = loadStreams(dir, new Map());
    assert.deepEqual(result.refusals, []);
    assert.deepEqual([...result.streams.keys()].sort(), ['audio', 'video']);
});

test('a segment of wrong duration makes the load refuse the stream', () => {
    const dir = tempServicesDir();
    writeFixture(dir, videoFixture({ wrongSegment: { index: 7, samples: 119 } }));
    const result = loadStreams(dir, new Map());
    assert.equal(result.streams.size, 0);
    assert.match(result.refusals[0].reason, /segment 7 lasts 357000, expected 360000/);
});

test('a segment of wrong duration in the middle breaks the tfdt sequence', () => {
    const dir = tempServicesDir();
    writeFixture(dir, videoFixture({ wrongSegment: { index: 2, samples: 121 } }));
    const result = loadStreams(dir, new Map());
    assert.equal(result.streams.size, 0);
    assert.match(result.refusals[0].reason, /segment 2 lasts|segment 3 tfdt/);
});

test('a declared lapDuration that differs from segmentCount × D is refused', () => {
    const dir = tempServicesDir();
    const video = videoFixture();
    writeFixture(dir, video);
    writeDeclaration(dir, video, { ...readDeclaration(dir, video), lapDuration: 1 });
    const result = loadStreams(dir, new Map());
    assert.match(result.refusals[0].reason, /lapDuration/);
});

test('a window shorter than three target durations is refused', () => {
    const dir = tempServicesDir();
    writeFixture(dir, videoFixture({ windowSize: 2 }));
    const result = loadStreams(dir, new Map());
    assert.match(result.refusals[0].reason, /window/);
});

test('an unknown field in the declaration is refused', () => {
    const dir = tempServicesDir();
    const video = videoFixture();
    writeFixture(dir, video);
    writeDeclaration(dir, video, { ...readDeclaration(dir, video), extra: true });
    const result = loadStreams(dir, new Map());
    assert.equal(result.streams.size, 0);
});

test('a streamId repeated across services is refused in both', () => {
    const dir = tempServicesDir();
    writeFixture(dir, videoFixture({ serviceId: '1001' }));
    writeFixture(dir, videoFixture({ serviceId: '1002' }));
    const result = loadStreams(dir, new Map());
    assert.equal(result.streams.size, 0);
    assert.equal(result.refusals.length, 2);
});

test('an audio pairing with another lap duration is refused', () => {
    const dir = tempServicesDir();
    writeFixture(dir, videoFixture({ audioStreamId: 'audio' }));
    writeFixture(dir, audioFixture({ segmentCount: 9 }));
    const result = loadStreams(dir, new Map());
    assert.deepEqual([...result.streams.keys()], ['audio']);
    assert.match(result.refusals[0].reason, /lap duration/);
});

test('media changed without a new epoch keeps the previous declaration', () => {
    const dir = tempServicesDir();
    const video = videoFixture();
    writeFixture(dir, video);
    const first = loadStreams(dir, new Map());
    writeFixture(dir, { ...video, segmentCount: 6 });
    fs.rmSync(path.join(dir, '1001', 'segmentos', 'video', 'seg-000007.m4s'));
    fs.rmSync(path.join(dir, '1001', 'segmentos', 'video', 'seg-000006.m4s'));
    const second = loadStreams(dir, first.streams);
    assert.equal(second.streams.get('video'), first.streams.get('video'));
    assert.match(second.refusals[0].reason, /without a new availabilityStartTime/);

    writeFixture(dir, { ...video, segmentCount: 6, availabilityStartTime: '2026-02-01T00:00:00Z' });
    const third = loadStreams(dir, second.streams);
    assert.equal(third.streams.get('video')?.declaration.segmentCount, 6);
    assert.deepEqual(third.refusals, []);
});
