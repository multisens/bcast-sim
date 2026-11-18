import assert from 'node:assert/strict';
import { test } from 'node:test';
import { masterPlaylist, mediaPlaylist, mpd, segment } from '../src/api/live/service';
import { readSegment, readInit } from '../src/media';
import fs from 'fs';
import { LoadedStream, loadStreams } from '../src/modules/streams';
import { audioFixture, tempServicesDir, videoFixture, writeFixture } from './helpers/fixtures';

const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');
const BASE_URL = 'http://localhost:8082/live/';
const T0 = BigInt(8053110000);
const D = 360000;

function mpdBody(stream: LoadedStream, nowMs: number): string | null {
    assert.ok(stream.media !== null);
    return mpd([{ stream, media: stream.media }], BASE_URL, nowMs)?.body ?? null;
}

function loaded(): { video: LoadedStream; audio: LoadedStream } {
    const dir = tempServicesDir();
    writeFixture(dir, videoFixture({ audioStreamId: 'audio' }));
    writeFixture(dir, audioFixture());
    const result = loadStreams(dir, new Map());
    const video = result.streams.get('video');
    const audio = result.streams.get('audio');
    assert.ok(video !== undefined && audio !== undefined);
    return { video, audio };
}

test('media playlist of the current window (4.4)', () => {
    const { video } = loaded();
    assert.ok(video.media !== null);
    const body = mediaPlaylist(video, video.media, EPOCH_MS + 4150 * 1000);
    assert.equal(body, [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MEDIA-SEQUENCE:1033',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:4.000,', 'seg/1033.m4s',
        '#EXTINF:4.000,', 'seg/1034.m4s',
        '#EXTINF:4.000,', 'seg/1035.m4s',
        '#EXTINF:4.000,', 'seg/1036.m4s',
        '#EXTINF:4.000,', 'seg/1037.m4s',
        '',
    ].join('\n'));
});

test('media playlist is shorter than the window early on, and absent before the first segment', () => {
    const { video } = loaded();
    assert.ok(video.media !== null);
    const early = mediaPlaylist(video, video.media, EPOCH_MS + 9000);
    assert.match(early ?? '', /MEDIA-SEQUENCE:1\n/);
    assert.equal((early ?? '').match(/seg\//g)?.length, 2);
    assert.equal(mediaPlaylist(video, video.media, EPOCH_MS + 3000), null);
});

test('master playlist joins video and audio (4.4)', () => {
    const { video, audio } = loaded();
    const body = masterPlaylist(video, audio);
    assert.match(body, /URI="\.\.\/audio\/playlist\.m3u8"/);
    assert.match(body, /BANDWIDTH=1096000,CODECS="avc1\.64001f,mp4a\.40\.2",RESOLUTION=1280x720,FRAME-RATE=30\.000/);
});

test('MPD timeline lists exactly the available segments (4.5)', () => {
    const { video, audio } = loaded();
    assert.ok(video.media !== null && audio.media !== null);
    const nowMs = EPOCH_MS + 4150 * 1000;
    const body = mpdBody(video, nowMs) ?? '';
    assert.match(body, /type="dynamic"/);
    assert.match(body, /availabilityStartTime="2026-01-01T00:00:00Z" publishTime="2026-01-01T01:09:08Z"/);
    assert.match(body, /timeShiftBufferDepth="PT20S"/);
    assert.match(body, /suggestedPresentationDelay="PT12S"/);
    assert.match(body, /<BaseURL>http:\/\/localhost:8082\/live\/<\/BaseURL>/);
    assert.match(body, /presentationTimeOffset="8053110000" startNumber="1032"/);
    const firstTime = T0 + BigInt(1031) * BigInt(D);
    assert.match(body, new RegExp(`<S t="${firstTime}" d="360000" r="5"/>`));
    assert.match(body, /schemeIdUri="urn:sbtvd:dash:component-tag" value="video"/);
    const audioBody = mpdBody(audio, nowMs) ?? '';
    assert.match(audioBody, /contentType="audio"/);
    assert.match(audioBody, /audioSamplingRate="48000"/);
    assert.doesNotMatch(audioBody, / width=/);
    assert.match(audioBody, /timeShiftBufferDepth="PT16S"/);
    assert.equal(mpdBody(video, EPOCH_MS + 3000), null);
});

test('MPD is the same within a segment and changes with the next one', () => {
    const { video } = loaded();
    assert.ok(video.media !== null);
    const start = EPOCH_MS + 4148 * 1000;
    const one = mpdBody(video, start + 500);
    const two = mpdBody(video, start + 3500);
    const three = mpdBody(video, start + 4500);
    assert.equal(one, two);
    assert.notEqual(two, three);
});

test('a segment of a later lap is shifted onto the continuous timeline (4.6)', () => {
    const { video } = loaded();
    assert.ok(video.media !== null);
    const init = readInit(fs.readFileSync(video.media.initPath));
    const nowMs = EPOCH_MS + 4150 * 1000;
    for (const segmentNumber of [1033, 1037, 1036]) {
        const result = segment(video, video.media, segmentNumber, nowMs);
        assert.equal(result.kind, 'ok');
        if (result.kind === 'ok') {
            const info = readSegment(result.body, init);
            assert.equal(info.firstDecodeTime, T0 + BigInt(segmentNumber - 1) * BigInt(D));
            assert.equal(result.body.readUInt32BE(20), segmentNumber);
        }
    }
});

test('segments outside the window are not found, and none exist before the first', () => {
    const { video } = loaded();
    assert.ok(video.media !== null);
    const nowMs = EPOCH_MS + 4150 * 1000;
    assert.equal(segment(video, video.media, 1038, nowMs).kind, 'out-of-window');
    assert.equal(segment(video, video.media, 1031, nowMs).kind, 'out-of-window');
    assert.equal(segment(video, video.media, 1, EPOCH_MS).kind, 'not-yet');
});

test('a restart gives byte-identical responses for the same clock', () => {
    const first = loaded();
    const second = loaded();
    assert.ok(first.video.media !== null && second.video.media !== null);
    const nowMs = EPOCH_MS + 123456789;
    assert.equal(mediaPlaylist(first.video, first.video.media, nowMs),
        mediaPlaylist(second.video, second.video.media, nowMs));
    assert.equal(mpdBody(first.video, nowMs),
        mpdBody(second.video, nowMs));
    const one = segment(first.video, first.video.media, 30860, nowMs);
    const two = segment(second.video, second.video.media, 30860, nowMs);
    assert.equal(one.kind, 'ok');
    assert.deepEqual(one, two);
});
