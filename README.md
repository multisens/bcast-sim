# bcast-sim

Broadcaster side of the TV 3.0 AoP testbed. It simulates what a broadcaster
emits: the transport layer signaling of each service, its live streams and
its files. It is outside the platform: the platform reaches it over HTTP only.

This repository holds the engine. The services it serves are declarations and
files under an emission directory; `example/` holds a synthetic one.

## Parts

| Part | Where | Runs |
|---|---|---|
| Signaling routes | `src/api/signaling`, `src/modules/emission` | in the service |
| Service files | `src/api/services` | in the service |
| Live simulator | `src/api/live`, `src/modules/streams` | in the service |
| Content preparation tool | `src/prepare` | from the command line, once per source file |
| ISO BMFF reading and stream checks | `src/media` | shared by the live simulator and the tool |

## Emission directory

```
canais/{bsid}.json                     RF channel: bandwidth, BAMT grouping, services
servicos/{serviceId}/
    servico.json                       SLT entry, BAM and delivery
    aplicacao.json                     Entry Packages of the BALD (optional)
    carrossel.json                     broadcast carousel (optional)
    privacidade.json                   PRRD (optional)
    fluxos/{streamId}.json             stream declarations
    segmentos/{streamId}/              initialization and media segments
    arquivos/                          application files and icons
```

Every declaration has a schema; a declaration that fails it, or a rule that
crosses files, is not served, and the reason goes to the log. A service
belongs to exactly one channel and has at least one stream: one MPD joins all
the streams of the service.

## Signaling routes

| Route | Returns |
|---|---|
| `GET <signaling>/lls` | SLT and BAMT of every RF channel, in JSON |
| `GET <signaling>/lls?rf={bsid}` | the tables of one RF channel |
| `GET <signaling>/sls/{serviceId}` | `multipart/related`: the metadata envelope, then USBD, S-TSID, MPD, BALD and PRRD, as declared |
| `GET <signaling>/emission/{serviceId}` | emission descriptor of a service with a carousel |

The fragments are JSON, field by field with the names of the standard; only
the MPD is XML. A fragment version changes only when its content changes. The
MPD lists the available segments of each stream, so it changes with every new
segment; the SLS package answers `503` before the first one.

In the S-TSID, the `appContextIdList` of a flow also has the `appContextId` of
each Entry Package whose `lctTSIRef` lists that flow. When the carousel has a
flow with a `fileTemplate` under `live/`, the MPD has `MPD.BaseURL` `/live/`,
relative, to be resolved against the object proxy; otherwise it is the
absolute `LIVE_BASE_URL`.

## Service files

| Route | Returns |
|---|---|
| `GET <services>/{serviceId}/live/{streamId}/…` | the live routes below, for the streams of that service |
| `GET <services>/{serviceId}/{path}` | `servicos/{serviceId}/arquivos/{path}` |
| `GET <services>/{serviceId}/{p}`, `{p}` an entry package of the carousel | `multipart/related`: a part per file of `arquivos/{p}/`, with `Content-Location` relative to it |

A carousel file of `contentType` `multipart/related` is an entry package (ATSC
A/331, A.3.3.4): `arquivos/{p}/` must be a folder with files of known media
type; each part has `Content-Transfer-Encoding: binary`.

## Live simulator

Serves each declared stream as a live window over a pre-recorded loop. Every
response is a function of the stream declaration, the segment files and the
clock; two instances with the same inputs answer the same bytes.

| Route | Returns |
|---|---|
| `GET <live>/{streamId}/master.m3u8` | HLS master playlist, for a video stream with an `audioStreamId` |
| `GET <live>/{streamId}/playlist.m3u8` | HLS media playlist of the current window |
| `GET <live>/{streamId}/mpd` | DASH MPD of the stream, whose segment timeline lists the available segments |
| `GET <live>/{streamId}/init.mp4` | initialization segment |
| `GET <live>/{streamId}/seg/{n}.m4s` | segment number `n`, with its decode times shifted onto the continuous timeline |

Before the first segment is available the window routes answer `503` with
`Retry-After`; a segment outside the window answers `404`. Changing the
segments of a stream requires a new `availabilityStartTime`; otherwise the
previous declaration stays.

## Environment

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port |
| `EMISSION_DIR` | emission directory, with `canais/` and `servicos/` |
| `LIVE_BASE_URL` | `<live>`, as players reach it; it is the `MPD.BaseURL` |
| `SERVICES_BASE_URL` | `<services>`, as the platform reaches it; base of the emission descriptor |
| `SIGNALING_BASE_URL` | `<signaling>`, as the platform reaches it |
| `PUBLIC_SERVICES_BASE_URL` | `<services>`, as browsers reach it; same path as `SERVICES_BASE_URL` |
| `LOG_LEVEL` | `ERROR`, `INFO` (default) or `DEBUG` |

Each base URL is absolute and ends in `/`; its path is where the routes are
mounted, and the paths of live, services and signaling differ. Declarations
are loaded at startup and again when a file under `EMISSION_DIR` changes.

A declaration can reference the four base URLs as `${LIVE_BASE_URL}`,
`${SERVICES_BASE_URL}`, `${SIGNALING_BASE_URL}` and
`${PUBLIC_SERVICES_BASE_URL}`; any other name refuses the declaration. A
service in the `Broadband` configuration must list `LIVE_BASE_URL` in its
`unicastBasePatterns`; the example declares `${LIVE_BASE_URL}`.

```sh
npm install
PORT=8082 EMISSION_DIR=example LIVE_BASE_URL=http://localhost:8082/live/ \
    SERVICES_BASE_URL=http://localhost:8082/services/ \
    SIGNALING_BASE_URL=http://localhost:8082/signaling/ \
    PUBLIC_SERVICES_BASE_URL=http://localhost:8082/services/ npm run dev
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

`--services-dir` is the `servicos/` of an emission directory.

The lap is the longest multiple of the common unit of the video and audio
frame durations that fits the source; each component gets the segment
duration closest to `--segment-duration` that divides the lap. The tool
checks the result with the same checks the live simulator applies and writes
no declaration if any fails. Without `--availability-start`, the epoch is the
current time.

`scripts/make-example.sh [1001|1002]` regenerates the streams of the example
services from a synthetic test pattern with the service number, a frame
counter and a beep every second. 1001 is broadband only, with its application
on `bbandEntryPointUrl`; 1002 is broadcast only, with its stream and its
application (an entry package) in the carousel, and a file whose
`maxExpiresDelta` is shorter than its `cyclePeriod`.

## Container

```sh
docker build -t tv30-bcast-sim .
docker run --rm -p 8082:8082 -e LIVE_BASE_URL=http://localhost:8082/live/ \
    -e SERVICES_BASE_URL=http://localhost:8082/services/ \
    -e SIGNALING_BASE_URL=http://localhost:8082/signaling/ \
    -e PUBLIC_SERVICES_BASE_URL=http://localhost:8082/services/ tv30-bcast-sim
```

The image bundles `example/` as the default emission directory.

## Tests

```sh
npm test
npx tsc --noEmit
```

## License

Apache License 2.0; see `LICENSE`.
