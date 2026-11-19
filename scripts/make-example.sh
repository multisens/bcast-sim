#!/bin/sh
# Generates the synthetic example streams: a test pattern with the frame
# number and a beep every second, prepared as one video and one audio stream
# of a service under example/servicos.
#
# Usage: scripts/make-example.sh [1001|1002]...   (default: both)
#   1001  synthetic-video, synthetic-audio: testsrc2, 880 Hz, 1 Mb/s
#   1002  broadcast-video, broadcast-audio: smptebars, 440 Hz, 400 kb/s
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# make_service <serviceId> <stream prefix> <lavfi pattern> <beep Hz> <video bitrate>
make_service() {
    source="$WORK/source-$1.mov"
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "$3=size=1280x720:rate=30,drawtext=text='$1 %{n}':fontsize=120:x=60:y=60:fontcolor=white:box=1:boxcolor=black@0.7" \
        -f lavfi -i "sine=frequency=$4:beep_factor=6:sample_rate=48000" \
        -t 34 -c:v libx264 -crf 16 -c:a pcm_s16le "$source"

    cd "$ROOT"
    npm run --silent prepare-content -- \
        --source "$source" \
        --services-dir example/servicos \
        --service-id "$1" \
        --video-stream-id "$2-video" \
        --audio-stream-id "$2-audio" \
        --segment-duration 4 \
        --max-lap-duration 32 \
        --availability-start 2026-01-01T00:00:00Z \
        --video-bitrate "$5" \
        --audio-bitrate 96k
}

if [ "$#" -eq 0 ]; then
    set -- 1001 1002
fi
for service in "$@"; do
    case "$service" in
        1001)
            make_service 1001 synthetic testsrc2 880 1M
            ;;
        1002)
            make_service 1002 broadcast smptebars 440 400k
            ;;
        *)
            echo "unknown example service: $service" >&2
            exit 1
            ;;
    esac
done
