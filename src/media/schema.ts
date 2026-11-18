import { z } from 'zod';

// Stream declaration, servicos/{serviceId}/fluxos/{streamId}.json.

const PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
const RELATIVE_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._/-]+$/;
const SEGMENT_TEMPLATE = /^[A-Za-z0-9._-]*%0?\d*d[A-Za-z0-9._-]*$/;
const FRAME_RATE = /^\d+(\/\d+)?$/;

const representationSchema = z.strictObject({
    mimeType: z.enum(['video/mp4', 'audio/mp4']),
    codecs: z.string().min(1),
    bandwidth: z.int().positive(),
    width: z.int().positive().optional(),
    height: z.int().positive().optional(),
    frameRate: z.string().regex(FRAME_RATE).optional(),
    audioSamplingRate: z.int().positive().optional(),
}).superRefine((representation, context) => {
    switch (representation.mimeType) {
        case 'video/mp4':
            if (representation.width === undefined || representation.height === undefined
                || representation.frameRate === undefined) {
                context.addIssue({ code: 'custom', message: 'video requires width, height and frameRate' });
            }
            if (representation.audioSamplingRate !== undefined) {
                context.addIssue({ code: 'custom', message: 'video takes no audioSamplingRate' });
            }
            break;
        case 'audio/mp4':
            if (representation.audioSamplingRate === undefined) {
                context.addIssue({ code: 'custom', message: 'audio requires audioSamplingRate' });
            }
            if (representation.width !== undefined || representation.height !== undefined
                || representation.frameRate !== undefined) {
                context.addIssue({ code: 'custom', message: 'audio takes no width, height or frameRate' });
            }
            break;
        default:
            break;
    }
});

export const streamDeclarationSchema = z.strictObject({
    streamId: z.string().regex(PATH_SEGMENT),
    availabilityStartTime: z.iso.datetime({ offset: true }),
    segmentCount: z.int().positive(),
    segmentTemplate: z.string().regex(SEGMENT_TEMPLATE),
    initSegment: z.string().regex(RELATIVE_PATH),
    nominalDuration: z.number().positive(),
    segmentDurations: z.array(z.int().positive()),
    timescale: z.int().positive(),
    lapDuration: z.int().positive(),
    windowSize: z.int().positive(),
    representation: representationSchema,
    componentTag: z.string().min(1),
    audioStreamId: z.string().regex(PATH_SEGMENT).optional(),
    manifest: z.strictObject({
        mpd: z.string().regex(RELATIVE_PATH).optional(),
        hls: z.string().regex(RELATIVE_PATH).optional(),
    }).optional(),
});

export type StreamDeclaration = z.infer<typeof streamDeclarationSchema>;
export type Representation = z.infer<typeof representationSchema>;
