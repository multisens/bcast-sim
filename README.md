# bcast-sim

Broadcaster side of the TV 3.0 AoP testbed. It simulates what a broadcaster
emits: the live streams of each service and, in later milestones, the
transport layer signaling. It is outside the platform: the platform reaches it
over HTTP only.

This repository holds the engine. The services it serves are declarations and
files under a services directory; `example/servicos` holds a synthetic one.

## Parts

| Part | Where | Runs |
|---|---|---|
| Live simulator | `src/api/live`, `src/modules/streams` | in the service |
| Content preparation tool | `src/prepare` | from the command line, once per source file |
| ISO BMFF reading and stream checks | `src/media` | shared by both |

## Live simulator

Serves each declared stream as a live window over a pre-recorded loop. Every
response is a function of the stream declaration, the segment files and the
clock; two instances with the same inputs answer the same bytes.

| Route | Returns |
|---|---|
| `GET <live>/{streamId}/master.m3u8` | HLS master playlist, for a video stream with an `audioStreamId` |
| `GET <live>/{streamId}/playlist.m3u8` | HLS media playlist of the current window |
| `GET <live>/{streamId}/mpd` | DASH MPD whose segment timeline lists the available segments |
| `GET <live>/{streamId}/init.mp4` | initialization segment |
| `GET <live>/{streamId}/seg/{n}.m4s` | segment number `n`, with its decode times shifted onto the continuous timeline |

`<live>` is `LIVE_BASE_URL`. Before the first segment is available the window
routes answer `503` with `Retry-After`; a segment outside the window answers
`404`.

### Environment

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port |
| `SERVICES_DIR` | services directory: `{serviceId}/fluxos/{streamId}.json` and `{serviceId}/segmentos/{streamId}/` |
| `LIVE_BASE_URL` | absolute base URL of the live routes as players reach it, ending in `/`; its path is where the routes are mounted |
| `LOG_LEVEL` | `ERROR`, `INFO` (default) or `DEBUG` |

Declarations are loaded at startup and again when a file under
`SERVICES_DIR` changes. A declaration that fails a check is not served and the
reason goes to the log. Changing the segments of a stream requires a new
`availabilityStartTime`; otherwise the previous declaration stays.

```sh
npm install
PORT=8082 SERVICES_DIR=example/servicos LIVE_BASE_URL=http://localhost:8082/live/ npm run dev
```

## Content preparation tool

Cuts a source file with video and audio into fragmented MP4 segments of
constant, exact duration, one stream per component, and writes the stream
declarations. It needs `ffmpeg` and `ffprobe` on the path.

```sh
npm run prepare-content -- --source <file> --services-dir <dir> --service-id <id> \
    --video-stream-id <id> --audio-stream-id <id> [--segment-duration 4] \
    [--max-lap-duration <s>] [--availability-start <ISO 8601>] [--window-size 5] \
    [--video-encoder libx264] [--video-bitrate 2M] [--audio-encoder aac] \
    [--audio-bitrate 128k] [--audio-frame-size 1024]
```

The lap is the longest multiple of the common unit of the video and audio
frame durations that fits the source; each component gets the segment
duration closest to `--segment-duration` that divides the lap. The tool
checks the result with the same checks the live simulator applies and writes
no declaration if any fails. Without `--availability-start`, the epoch is the
current time.

`scripts/make-example.sh` regenerates `example/servicos/1001` from a synthetic
test pattern with a frame counter and a beep every second.

## Container

```sh
docker build -t tv30-bcast-sim .
docker run --rm -p 8082:8082 -e LIVE_BASE_URL=http://localhost:8082/live/ tv30-bcast-sim
```

The image bundles `example/servicos` as the default services directory.

## Tests

```sh
npm test
npx tsc --noEmit
```

## License

Apache License 2.0; see `LICENSE`.
