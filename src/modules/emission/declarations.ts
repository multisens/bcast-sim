import { z } from 'zod';
import {
    appTypeSchema, bandwidthSchema, channelNoSchema, colorSchema, configurationSchema, controlCodeSchema,
    dateTimeSchema, fileTemplateSchema, groupingTypeSchema, prrdSchema, receptionQualitySchema, relativeUriSchema,
    serviceCategorySchema, unsignedByteSchema, unsignedIntSchema, unsignedShortSchema, urnSchema,
} from './fragments';

// Declarations written by the service author: canais/{bsid}.json and
// servicos/{serviceId}/{servico, aplicacao, carrossel, privacidade}.json.

const RELATIVE_PATH = /^(?![/.])(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._/-]+$/;
const MAX_LLS_CYCLE_PERIOD_MS = 5000;

export const DEFAULT_LLS_CYCLE_PERIOD_MS = MAX_LLS_CYCLE_PERIOD_MS;

const relativePathSchema = z.string().regex(RELATIVE_PATH);

// 3.2.
export const channelDeclarationSchema = z.strictObject({
    bsid: unsignedShortSchema,
    bandwidth: bandwidthSchema,
    bamtGroupingType: groupingTypeSchema,
    services: z.array(unsignedShortSchema).min(1),
    llsCyclePeriod: z.int().positive().max(MAX_LLS_CYCLE_PERIOD_MS).optional(),
});

// 3.3.
export const serviceDeclarationSchema = z.strictObject({
    slt: z.strictObject({
        serviceId: unsignedShortSchema,
        globalServiceId: urnSchema,
        serviceCategory: serviceCategorySchema,
        shortServiceName: z.string().min(1).max(7).optional(),
        majorChannelNo: channelNoSchema.optional(),
        minorChannelNo: channelNoSchema.optional(),
        hidden: z.boolean().optional(),
        broadbandAccessRequired: z.boolean().optional(),
        sltSvcSeqNum: unsignedByteSchema,
        svcInetUrl: z.array(z.strictObject({
            urlType: unsignedByteSchema,
            url: z.url(),
        })).min(1).optional(),
    }),
    bam: z.strictObject({
        appVersion: unsignedByteSchema,
        appName: z.string().min(1).max(20),
        appDescription: z.string().min(1).max(40).optional(),
        backgroundColor: colorSchema,
        foregroundColor: colorSchema,
        appIcon: relativePathSchema,
        bannerIcon: relativePathSchema,
        additionalServices: z.array(unsignedShortSchema).min(1).optional(),
        fallbackMediaURLs: z.array(z.url()).min(1).optional(),
        ecgAppDeepLink: z.url().optional(),
    }).optional(),
    delivery: z.strictObject({
        configuration: configurationSchema.default('Broadcast'),
        mainAvOverTheAir: z.boolean(),
        receptionQuality: receptionQualitySchema,
        broadcastBasePatterns: z.array(z.string().min(1)).min(1).optional(),
        unicastBasePatterns: z.array(z.string().min(1)).min(1).optional(),
    }),
}).superRefine((service, context) => {
    const isBootstrapService = service.slt.serviceCategory === 30;
    if (!isBootstrapService && (service.slt.majorChannelNo !== undefined || service.slt.minorChannelNo !== undefined)) {
        context.addIssue({ code: 'custom', message: 'majorChannelNo and minorChannelNo are only allowed in type 30' });
    }
    if (isBootstrapService && service.bam === undefined) {
        context.addIssue({ code: 'custom', message: 'a type 30 service requires the bam block' });
    }
    if (!isBootstrapService && service.bam !== undefined) {
        context.addIssue({ code: 'custom', message: 'the bam block is only allowed in type 30' });
    }
    if (service.delivery.configuration === 'Broadband') {
        if (service.slt.broadbandAccessRequired !== true) {
            context.addIssue({ code: 'custom', message: 'Broadband configuration requires broadbandAccessRequired' });
        }
        if (service.delivery.unicastBasePatterns === undefined) {
            context.addIssue({ code: 'custom', message: 'Broadband configuration requires unicastBasePatterns' });
        }
    }
});

// The application declaration: one entry per Entry Package. targetApplication is accepted and
// ignored.
const applicationEntrySchema = z.strictObject({
    appContextId: urnSchema,
    appType: appTypeSchema,
    appId: urnSchema,
    appName: z.string().min(1).max(20),
    controlCode: controlCodeSchema.optional(),
    bbandEntryPointUrl: z.url().optional(),
    bcastEntryPackageUrl: relativeUriSchema.optional(),
    bcastEntryPointUrl: relativeUriSchema.optional(),
    lctTSIRef: z.array(unsignedIntSchema).min(1).optional(),
    validFrom: dateTimeSchema.optional(),
    validUntil: dateTimeSchema.optional(),
    clearAppContextCacheDate: dateTimeSchema.optional(),
    appIcon: relativePathSchema.optional(),
    targetApplication: z.strictObject({
        displayName: z.string().min(1),
        filter: z.array(z.strictObject({
            scheme: z.string().min(1),
            host: z.string().min(1).optional(),
            path: z.string().min(1).optional(),
        })).min(1),
    }).optional(),
}).superRefine((entry, context) => {
    if (entry.bbandEntryPointUrl === undefined && entry.bcastEntryPackageUrl === undefined) {
        context.addIssue({ code: 'custom', message: 'bbandEntryPointUrl or bcastEntryPackageUrl is required' });
    }
    if (entry.bcastEntryPointUrl !== undefined && entry.bcastEntryPackageUrl === undefined) {
        context.addIssue({ code: 'custom', message: 'bcastEntryPointUrl requires bcastEntryPackageUrl' });
    }
    if (entry.validFrom !== undefined && entry.validUntil !== undefined
        && Date.parse(entry.validUntil) <= Date.parse(entry.validFrom)) {
        context.addIssue({ code: 'custom', message: 'validUntil must be later than validFrom' });
    }
});

export const applicationDeclarationSchema = z.array(applicationEntrySchema).min(1);

// 3.6.
const carouselFileSchema = z.strictObject({
    contentLocation: relativeUriSchema,
    contentType: z.string().min(1),
    contentLength: z.int().nonnegative().optional(),
    appContextIdList: z.array(urnSchema).min(1).optional(),
    filterCodes: z.array(unsignedIntSchema).min(1).optional(),
    order: z.int().nonnegative().optional(),
    lastModified: dateTimeSchema.optional(),
});

const carouselFlowSchema = z.strictObject({
    tsi: unsignedIntSchema,
    cyclePeriod: z.int().positive(),
    maxExpiresDelta: unsignedIntSchema.optional(),
    appContextIdList: z.array(urnSchema).min(1).optional(),
    filterCodes: z.array(unsignedIntSchema).min(1).optional(),
    fileTemplate: fileTemplateSchema.optional(),
    files: z.array(carouselFileSchema).min(1),
}).superRefine((flow, context) => {
    // ATSC A/331, A.3.3.2.6: a flow of DASH segments describes only the
    // initialization segment.
    if (flow.fileTemplate !== undefined && flow.files.length !== 1) {
        context.addIssue({ code: 'custom', message: 'a flow with fileTemplate has exactly one file' });
    }
});

export const carouselDeclarationSchema = z.strictObject({
    signalingCyclePeriod: z.int().positive(),
    cycleEpoch: dateTimeSchema,
    flows: z.array(carouselFlowSchema).min(1),
});

// The privacy declaration: the PRRD itself, in JSON.
export const privacyDeclarationSchema = prrdSchema;

export type ChannelDeclaration = z.infer<typeof channelDeclarationSchema>;
export type ServiceDeclaration = z.infer<typeof serviceDeclarationSchema>;
export type ApplicationDeclaration = z.infer<typeof applicationDeclarationSchema>;
export type ApplicationEntry = ApplicationDeclaration[number];
export type CarouselDeclaration = z.infer<typeof carouselDeclarationSchema>;
export type CarouselFlow = CarouselDeclaration['flows'][number];
export type PrivacyDeclaration = z.infer<typeof privacyDeclarationSchema>;
