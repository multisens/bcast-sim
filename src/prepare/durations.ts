// Choice of the lap and segment durations. Durations are exact fractions of a
// second.

export type Rational = {
    num: number;
    den: number;
};

export type ComponentPlan = {
    frameDuration: Rational;
    framesPerSegment: number;
    segmentCount: number;
    segmentDuration: Rational;
    timescale: number;
    segmentDurationUnits: number;
};

export type DurationPlan = {
    unit: Rational;
    lap: Rational;
    video: ComponentPlan;
    audio: ComponentPlan;
};

export type DurationInput = {
    videoFrameRate: Rational;
    audioSampleRate: number;
    audioFrameSize: number;
    sourceSeconds: number;
    maxLapSeconds: number | null;
    targetSegmentSeconds: number;
};

const VIDEO_TIMESCALE = 90000;
const TFDT_32_BIT_LIMIT = 2 ** 32;

export function planDurations(input: DurationInput): DurationPlan {
    const videoFrame = rational(input.videoFrameRate.den, input.videoFrameRate.num);
    const audioFrame = rational(input.audioFrameSize, input.audioSampleRate);
    const unit = rational(lcm(videoFrame.num, audioFrame.num), gcd(videoFrame.den, audioFrame.den));

    const available = input.maxLapSeconds === null
        ? input.sourceSeconds
        : Math.min(input.sourceSeconds, input.maxLapSeconds);
    const units = Math.floor(available * unit.den / unit.num);
    if (units < 1) {
        throw new Error(`source of ${available} s is shorter than the common unit of ${toSeconds(unit)} s`);
    }
    const lap = rational(units * unit.num, unit.den);

    const videoTimescale = isInteger(VIDEO_TIMESCALE * videoFrame.num / videoFrame.den)
        ? VIDEO_TIMESCALE
        : videoFrame.den;
    const video = planComponent(lap, videoFrame, videoTimescale, input.targetSegmentSeconds);
    const audio = planComponent(lap, audioFrame, input.audioSampleRate, input.targetSegmentSeconds);
    return { unit, lap, video, audio };
}

// Whole seconds added to every decode time so that the first tfdt is at least
// 2^32 in every timescale.
export function decodeTimeOffsetSeconds(timescales: number[]): number {
    const smallest = Math.min(...timescales);
    return Math.ceil(TFDT_32_BIT_LIMIT / smallest);
}

export function toSeconds(value: Rational): number {
    return value.num / value.den;
}

export function parseRational(text: string): Rational {
    const [numerator, denominator] = text.split('/');
    const num = Number(numerator);
    const den = Number(denominator ?? '1');
    if (!Number.isInteger(num) || !Number.isInteger(den) || num <= 0 || den <= 0) {
        throw new Error(`'${text}' is not a positive rational`);
    }
    return rational(num, den);
}

function planComponent(lap: Rational, frame: Rational, timescale: number, targetSeconds: number): ComponentPlan {
    const framesPerLap = lap.num * frame.den / (lap.den * frame.num);
    if (!isInteger(framesPerLap)) {
        throw new Error('the lap is not a whole number of frames');
    }
    let best = 1;
    for (let frames = 1; frames <= framesPerLap; frames++) {
        if (framesPerLap % frames !== 0) {
            continue;
        }
        const distance = Math.abs(frames * toSeconds(frame) - targetSeconds);
        const bestDistance = Math.abs(best * toSeconds(frame) - targetSeconds);
        if (distance < bestDistance) {
            best = frames;
        }
    }
    const segmentDuration = rational(best * frame.num, frame.den);
    const segmentDurationUnits = segmentDuration.num * timescale / segmentDuration.den;
    if (!isInteger(segmentDurationUnits)) {
        throw new Error(`segment duration of ${toSeconds(segmentDuration)} s is not whole in timescale ${timescale}`);
    }
    return {
        frameDuration: frame,
        framesPerSegment: best,
        segmentCount: framesPerLap / best,
        segmentDuration,
        timescale,
        segmentDurationUnits,
    };
}

function rational(num: number, den: number): Rational {
    const divisor = gcd(num, den);
    return { num: num / divisor, den: den / divisor };
}

function gcd(a: number, b: number): number {
    let x = a;
    let y = b;
    while (y !== 0) {
        const rest = x % y;
        x = y;
        y = rest;
    }
    return x;
}

function lcm(a: number, b: number): number {
    return a / gcd(a, b) * b;
}

function isInteger(value: number): boolean {
    return Number.isInteger(value);
}
