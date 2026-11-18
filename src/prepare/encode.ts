import { execFileSync } from 'child_process';
import { z } from 'zod';
import { ComponentPlan, Rational, parseRational, toSeconds } from './durations';

// Source probing and encoding of each component into a fragmented MP4 with
// one fragment per segment (8.3, steps 1 and 2), through ffprobe and ffmpeg.

export type SourceInfo = {
    videoFrameRate: Rational;
    audioSampleRate: number;
    durationSeconds: number;
};

export type VideoEncoding = {
    encoder: string;
    bitrate: string;
    frameRate: Rational;
};

export type AudioEncoding = {
    encoder: string;
    bitrate: string;
    sampleRate: number;
};

const probeSchema = z.object({
    streams: z.array(z.object({
        codec_type: z.string(),
        r_frame_rate: z.string().optional(),
        sample_rate: z.string().optional(),
    })),
    format: z.object({ duration: z.string() }),
});

const MICROSECONDS_PER_SECOND = 1000000;
const AUDIO_DURATION_DECIMALS = 6;

export function probeSource(source: string): SourceInfo {
    const output = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json',
        '-show_streams', '-show_format', source], { encoding: 'utf8' });
    const probe = probeSchema.parse(JSON.parse(output));
    const video = probe.streams.find((stream) => stream.codec_type === 'video');
    const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
    if (video?.r_frame_rate === undefined) {
        throw new Error('source has no video stream');
    }
    if (audio?.sample_rate === undefined) {
        throw new Error('source has no audio stream');
    }
    return {
        videoFrameRate: parseRational(video.r_frame_rate),
        audioSampleRate: Number(audio.sample_rate),
        durationSeconds: Number(probe.format.duration),
    };
}

export function encodeVideo(source: string, output: string, plan: ComponentPlan, encoding: VideoEncoding): void {
    const framesPerLap = plan.segmentCount * plan.framesPerSegment;
    const gop = String(plan.framesPerSegment);
    const frameRate = `${encoding.frameRate.num}/${encoding.frameRate.den}`;
    runFfmpeg(source, output, [
        '-map', '0:v:0', '-an', '-sn', '-dn',
        '-frames:v', String(framesPerLap),
        '-r', frameRate,
        '-c:v', encoding.encoder,
        '-pix_fmt', 'yuv420p',
        '-b:v', encoding.bitrate, '-maxrate', encoding.bitrate,
        '-bf', '0',
        '-g', gop, '-keyint_min', gop, '-sc_threshold', '0',
        '-force_key_frames', `expr:eq(mod(n,${gop}),0)`,
        '-video_track_timescale', String(plan.timescale),
        '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
    ]);
}

export function encodeAudio(source: string, output: string, lap: Rational, plan: ComponentPlan,
    encoding: AudioEncoding): void {
    const fragmentMicroseconds = Math.floor(toSeconds(plan.segmentDuration) * MICROSECONDS_PER_SECOND);
    runFfmpeg(source, output, [
        '-map', '0:a:0', '-vn', '-sn', '-dn',
        '-t', toSeconds(lap).toFixed(AUDIO_DURATION_DECIMALS),
        '-c:a', encoding.encoder,
        '-ar', String(encoding.sampleRate),
        '-ac', '2',
        '-b:a', encoding.bitrate,
        '-frag_duration', String(fragmentMicroseconds),
        '-movflags', '+empty_moov+default_base_moof',
    ]);
}

function runFfmpeg(source: string, output: string, outputArgs: string[]): void {
    execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', source,
        ...outputArgs,
        '-map_metadata', '-1',
        '-fflags', '+bitexact', '-flags', '+bitexact',
        '-f', 'mp4', output,
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
}
