#!/bin/sh
# Generates the synthetic example stream: a test pattern with the frame
# number and a beep every second, prepared as one video and one audio stream
# of service 1001 under example/servicos.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=1280x720:rate=30,drawtext=text='%{n}':fontsize=120:x=60:y=60:fontcolor=white:box=1:boxcolor=black@0.7" \
    -f lavfi -i "sine=frequency=880:beep_factor=6:sample_rate=48000" \
    -t 34 -c:v libx264 -crf 16 -c:a pcm_s16le "$WORK/source.mov"

cd "$ROOT"
npm run --silent prepare-content -- \
    --source "$WORK/source.mov" \
    --services-dir example/servicos \
    --service-id 1001 \
    --video-stream-id synthetic-video \
    --audio-stream-id synthetic-audio \
    --segment-duration 4 \
    --max-lap-duration 32 \
    --availability-start 2026-01-01T00:00:00Z \
    --video-bitrate 1M \
    --audio-bitrate 96k
