import { z } from 'zod';

// Declared schemas of the signaling the emission side serves: the LLS tables
// SLT and BAMT, the SLS fragments BALD, USBD, S-TSID and PRRD, the metadata
// envelope and the emission descriptor (3.7, 3.8, 6.2). Each fragment is the
// content of its root element in JSON (DP9).

const URN = /^urn:[A-Za-z0-9][A-Za-z0-9-]{0,31}:\S+$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const RELATIVE_URI = /^(?![/.])(?!.*(^|\/)\.\.(\/|$))[^\s?#]+$/;
const SVG_ROOT = /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/;
const TOI_PATTERN = '$TOI$';
const MAX_ICON_BYTES = 16 * 1024;
const MAX_UNSIGNED_SHORT = 65535;
const MAX_UNSIGNED_BYTE = 255;
const MAX_UNSIGNED_INT = 4294967295;
const MAX_CHANNEL_NO = 999;
const MAX_RECEPTION_QUALITY = 100;

export const LLS_TABLE_ID_SLT = 1;
export const LLS_TABLE_ID_BAMT = 0x90;

export const unsignedShortSchema = z.int().min(0).max(MAX_UNSIGNED_SHORT);
export const unsignedByteSchema = z.int().min(0).max(MAX_UNSIGNED_BYTE);
export const unsignedIntSchema = z.int().min(0).max(MAX_UNSIGNED_INT);
export const urnSchema = z.string().regex(URN);
export const colorSchema = z.string().regex(COLOR);
export const relativeUriSchema = z.string().regex(RELATIVE_URI);
export const dateTimeSchema = z.iso.datetime({ offset: true });
export const bandwidthSchema = z.union([z.literal(6), z.literal(7), z.literal(8)]);
export const groupingTypeSchema = z.enum(['optionalGrouping', 'mandatoryGrouping', 'noGrouping']);
export const serviceCategorySchema = z.union([z.literal(30), z.literal(31), z.literal(32)]);
export const configurationSchema = z.enum(['Broadcast', 'Broadband']);
export const appTypeSchema = z.enum(['TV30-Ginga-HTML5', 'TV30-Ginga-NCL']);
export const controlCodeSchema = z.enum([
    'AUTOSTART', 'PRESENT', 'STORED_AUTOSTART', 'STORED_PRESENT', 'DESTROY', 'KILL', 'STORED_REMOVE',
]);
export const channelNoSchema = z.int().min(1).max(MAX_CHANNEL_NO);
export const receptionQualitySchema = z.int().min(0).max(MAX_RECEPTION_QUALITY);
export const fileTemplateSchema = z.string().regex(RELATIVE_URI).refine((value) => value.includes(TOI_PATTERN),
    { message: `fileTemplate must contain ${TOI_PATTERN}` });

// ABNT NBR 25608, 8.4.4 and 10.1.2: SVG document, up to 16 kB.
export const svgSchema = z.string()
    .regex(SVG_ROOT, { message: 'not an SVG document' })
    .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_ICON_BYTES,
        { message: `SVG larger than ${MAX_ICON_BYTES} bytes` });

// ATSC A/331, 6.3, Table 6.2, as amended by ABNT NBR 25602, 8.1; bandwidth,
// mainAvOverTheAir and receptionQuality are testbed additions (7.1).
export const sltSchema = z.strictObject({
    bsid: z.array(unsignedShortSchema).min(1),
    bandwidth: bandwidthSchema,
    Service: z.array(z.strictObject({
        serviceId: unsignedShortSchema,
        globalServiceId: urnSchema,
        sltSvcSeqNum: unsignedByteSchema,
        majorChannelNo: channelNoSchema.optional(),
        minorChannelNo: channelNoSchema.optional(),
        serviceCategory: serviceCategorySchema,
        shortServiceName: z.string().min(1).max(7).optional(),
        hidden: z.boolean().optional(),
        broadbandAccessRequired: z.boolean().optional(),
        configuration: configurationSchema,
        mainAvOverTheAir: z.boolean(),
        receptionQuality: receptionQualitySchema,
        SvcInetUrl: z.array(z.strictObject({
            urlType: unsignedByteSchema,
            value: z.url(),
        })).min(1).optional(),
    })).min(1),
});

// ABNT NBR 25602, 8.2.2, Table 3, and ABNT NBR 25608, 8.4.4, Table 6.
export const bamSchema = z.strictObject({
    globalServiceId: urnSchema,
    appVersion: unsignedByteSchema,
    appName: z.string().min(1).max(20),
    appDescription: z.string().min(1).max(40).optional(),
    backgroundColor: colorSchema,
    foregroundColor: colorSchema,
    additionalServices: z.array(unsignedShortSchema).min(1).optional(),
    appIcon: svgSchema,
    bannerIcon: svgSchema,
    fallbackMediaURLs: z.array(z.url()).min(1).optional(),
});

export const bamtSchema = z.strictObject({
    groupingType: groupingTypeSchema.optional(),
    BAM: z.array(bamSchema).min(1),
});

// ABNT NBR 25608, 10.1.2, Table 10.
export const entryPackageSchema = z.strictObject({
    appContextId: urnSchema,
    appType: appTypeSchema,
    clearAppContextCacheDate: dateTimeSchema.optional(),
    bcastEntryPackageUrl: relativeUriSchema.optional(),
    bcastEntryPointUrl: relativeUriSchema.optional(),
    bbandEntryPointUrl: z.url().optional(),
    validFrom: dateTimeSchema.optional(),
    validUntil: dateTimeSchema.optional(),
    lctTSIRef: z.array(unsignedIntSchema).min(1).optional(),
    appId: urnSchema,
    appName: z.string().min(1).max(20),
    controlCode: controlCodeSchema.optional(),
    appIcon: svgSchema.optional(),
}).superRefine((entry, context) => {
    if (entry.bcastEntryPackageUrl === undefined && entry.bbandEntryPointUrl === undefined) {
        context.addIssue({ code: 'custom', message: 'bcastEntryPackageUrl or bbandEntryPointUrl is required' });
    }
    if (entry.validFrom !== undefined && entry.validUntil !== undefined
        && Date.parse(entry.validUntil) <= Date.parse(entry.validFrom)) {
        context.addIssue({ code: 'custom', message: 'validUntil must be later than validFrom' });
    }
});

export const baldSchema = z.strictObject({
    EntryPackage: z.array(entryPackageSchema).min(1),
});

// ATSC A/331, 7.1.3, Table 7.3.
const appServiceSchema = z.strictObject({
    BasePattern: z.array(z.string().min(1)).min(1),
});

export const usbdSchema = z.strictObject({
    UserServiceDescription: z.strictObject({
        serviceId: unsignedShortSchema,
        DeliveryMethod: z.array(z.strictObject({
            BroadcastAppService: z.array(appServiceSchema).min(1).optional(),
            UnicastAppService: z.array(appServiceSchema).min(1).optional(),
        }).refine((method) => method.BroadcastAppService !== undefined || method.UnicastAppService !== undefined,
            { message: 'DeliveryMethod needs BroadcastAppService or UnicastAppService' })).min(1),
    }),
});

// ATSC A/331, 7.1.4 (Table 7.4), A.3.2 (Table A.3.1) and A.3.3.2.3
// (Tables A.3.3 and A.3.4). Only what the carousel declaration produces.
const fileSchema = z.strictObject({
    'Content-Location': relativeUriSchema,
    'Content-Type': z.string().min(1),
    'Content-Length': z.int().nonnegative().optional(),
    appContextIdList: z.array(urnSchema).min(1).optional(),
    filterCodes: z.array(unsignedIntSchema).min(1).optional(),
});

export const stsidSchema = z.strictObject({
    RS: z.array(z.strictObject({
        LS: z.array(z.strictObject({
            tsi: unsignedIntSchema,
            SrcFlow: z.strictObject({
                EFDT: z.strictObject({
                    'FDT-Instance': z.strictObject({
                        maxExpiresDelta: unsignedIntSchema.optional(),
                        appContextIdList: z.array(urnSchema).min(1).optional(),
                        fileTemplate: fileTemplateSchema.optional(),
                        filterCodes: z.array(unsignedIntSchema).min(1).optional(),
                        File: z.array(fileSchema).min(1),
                    }),
                }),
            }),
        })).min(1),
    })).length(1),
});

// ABNT NBR 25608, 8.8.2, Table 8.
const partyIdsSchema = z.strictObject({
    partyId: z.array(z.string().min(1)),
});

export const prrdSchema = z.strictObject({
    schemaVersion: z.string().regex(/^PRRD-1\.0-\S+-\S+$/),
    piiProcessing: z.array(z.strictObject({
        privacyNotice: z.url(),
        language: z.string().min(1),
        broadcastNotice: z.string().min(1),
        deliveryUrl: z.url({ protocol: /^https$/ }),
        initialDisclaimer: z.string().min(1),
        purposes: z.strictObject({
            purpose: z.array(z.strictObject({
                id: z.string().min(1),
                type: z.string().min(1),
                lawfulBasis: z.string().min(1),
                value: z.string().min(1),
                piiInformation: z.strictObject({
                    pii: z.array(z.strictObject({
                        type: z.string().min(1),
                        optional: z.boolean(),
                        value: z.string().min(1),
                    })).min(1),
                    piiControllers: partyIdsSchema.refine((ids) => ids.partyId.length > 0,
                        { message: 'piiControllers needs at least one partyId' }),
                    storageLocations: z.string().regex(/^[A-Z]{2}(,[A-Z]{2})*$/),
                    retentionPeriod: z.string().min(1),
                    jurisdiction: z.string().regex(/^[A-Z]{2}$/),
                    recipientThirdParties: partyIdsSchema,
                    withdrawalMethod: z.literal('TV30AoP-privacyManager'),
                    authorityParty: z.string().min(1),
                }),
            })).min(1),
        }),
    })).min(1),
    partyIdentification: z.strictObject({
        party: z.array(z.strictObject({
            id: z.string().min(1),
            type: z.string().min(1),
            partyName: z.string().min(1),
            partyAddress: z.string().min(1),
            partyContact: z.string().min(1),
        })).min(1),
    }),
}).superRefine((prrd, context) => {
    const parties = new Set(prrd.partyIdentification.party.map((party) => party.id));
    for (const processing of prrd.piiProcessing) {
        for (const purpose of processing.purposes.purpose) {
            const information = purpose.piiInformation;
            const referenced = [
                ...information.piiControllers.partyId,
                ...information.recipientThirdParties.partyId,
                information.authorityParty,
            ];
            for (const partyId of referenced) {
                if (!parties.has(partyId)) {
                    context.addIssue({ code: 'custom',
                        message: `party '${partyId}' of purpose '${purpose.id}' is not in partyIdentification` });
                }
            }
        }
    }
});

// 3.7.
export const emissionDescriptorSchema = z.strictObject({
    serviceId: unsignedShortSchema,
    emissionBaseUrl: z.url(),
    cycleEpoch: dateTimeSchema,
    signaling: z.strictObject({
        url: z.url(),
        cyclePeriod: z.int().positive(),
    }),
    flows: z.array(z.strictObject({
        tsi: unsignedIntSchema,
        cyclePeriod: z.int().positive(),
        objects: z.array(z.strictObject({
            contentLocation: relativeUriSchema,
            order: z.int().nonnegative(),
            lastModified: dateTimeSchema,
        })),
    })).min(1),
});

// 6.2, GET <sinal>/lls. llsCyclePeriod tells the acquisition the cadence of
// the scan (6.3).
export const llsResponseSchema = z.strictObject({
    rfChannels: z.array(z.strictObject({
        bsid: unsignedShortSchema,
        llsCyclePeriod: z.int().positive(),
        tables: z.array(z.union([
            z.strictObject({
                LLS_table_id: z.literal(LLS_TABLE_ID_SLT),
                LLS_group_id: z.literal(0),
                group_count_minus1: z.literal(0),
                LLS_table_version: unsignedByteSchema,
                SLT: sltSchema,
            }),
            z.strictObject({
                LLS_table_id: z.literal(LLS_TABLE_ID_BAMT),
                LLS_group_id: z.literal(0),
                group_count_minus1: z.literal(0),
                LLS_table_version: unsignedByteSchema,
                BAMT: bamtSchema,
            }),
        ])).min(1),
    })),
});

// 6.2, first part of GET <sinal>/sls/{serviceId}.
export const metadataUriSchema = z.enum(['usbd', 'stsid', 'mpd', 'bald', 'prrd']);

export const envelopeSchema = z.strictObject({
    item: z.array(z.strictObject({
        metadataURI: metadataUriSchema,
        version: z.int().nonnegative(),
        contentType: z.enum(['application/json', 'application/dash+xml']),
        validFrom: dateTimeSchema,
    })).min(1),
});

export type Slt = z.infer<typeof sltSchema>;
export type SltService = Slt['Service'][number];
export type Bam = z.infer<typeof bamSchema>;
export type Bamt = z.infer<typeof bamtSchema>;
export type Bald = z.infer<typeof baldSchema>;
export type EntryPackage = z.infer<typeof entryPackageSchema>;
export type Usbd = z.infer<typeof usbdSchema>;
export type Stsid = z.infer<typeof stsidSchema>;
export type StsidFile = z.infer<typeof fileSchema>;
export type Prrd = z.infer<typeof prrdSchema>;
export type EmissionDescriptor = z.infer<typeof emissionDescriptorSchema>;
export type LlsResponse = z.infer<typeof llsResponseSchema>;
export type MetadataUri = z.infer<typeof metadataUriSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;
