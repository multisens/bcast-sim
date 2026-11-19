import {
    ApplicationDeclaration, CarouselDeclaration, CarouselFlow, ChannelDeclaration, PrivacyDeclaration,
    ServiceDeclaration,
} from './declarations';
import { Bald, Bam, Bamt, EmissionDescriptor, Prrd, Slt, SltService, Stsid, StsidFile, Usbd } from './fragments';

// Declarations to fragments (3.8). The icons are read by the caller and
// passed as SVG text.

export type Icons = {
    appIcon: string;
    bannerIcon: string;
};

export type EmissionBases = {
    // <emissao>, ending with '/'.
    servicesBaseUrl: string;
    // <sinal>, ending with '/'.
    signalingBaseUrl: string;
};

// 7.1: the Service element of the SLT.
export function buildSltService(service: ServiceDeclaration): SltService {
    const slt = service.slt;
    const svcInetUrl = slt.svcInetUrl?.map((entry) => ({ urlType: entry.urlType, value: entry.url }));
    return {
        serviceId: slt.serviceId,
        globalServiceId: slt.globalServiceId,
        sltSvcSeqNum: slt.sltSvcSeqNum,
        majorChannelNo: slt.majorChannelNo,
        minorChannelNo: slt.minorChannelNo,
        serviceCategory: slt.serviceCategory,
        shortServiceName: slt.shortServiceName,
        hidden: slt.hidden,
        broadbandAccessRequired: slt.broadbandAccessRequired,
        configuration: service.delivery.configuration,
        mainAvOverTheAir: service.delivery.mainAvOverTheAir,
        receptionQuality: service.delivery.receptionQuality,
        SvcInetUrl: svcInetUrl,
    };
}

export function buildSlt(channel: ChannelDeclaration, services: ServiceDeclaration[]): Slt {
    return {
        bsid: [channel.bsid],
        bandwidth: channel.bandwidth,
        Service: services.map(buildSltService),
    };
}

// ecgAppDeepLink is accepted and ignored (3.3).
export function buildBam(service: ServiceDeclaration, icons: Icons): Bam | null {
    const bam = service.bam;
    if (bam === undefined) {
        return null;
    }
    return {
        globalServiceId: service.slt.globalServiceId,
        appVersion: bam.appVersion,
        appName: bam.appName,
        appDescription: bam.appDescription,
        backgroundColor: bam.backgroundColor,
        foregroundColor: bam.foregroundColor,
        additionalServices: bam.additionalServices,
        appIcon: icons.appIcon,
        bannerIcon: icons.bannerIcon,
        fallbackMediaURLs: bam.fallbackMediaURLs,
    };
}

// Null when no service of the channel has a BAM: the BAMT needs one.
export function buildBamt(channel: ChannelDeclaration, bams: Bam[]): Bamt | null {
    if (bams.length === 0) {
        return null;
    }
    return {
        groupingType: channel.bamtGroupingType,
        BAM: bams,
    };
}

// targetApplication is accepted and ignored (3.4). appIcons holds the SVG
// text of each entry's icon, in the order of the declaration.
export function buildBald(application: ApplicationDeclaration, appIcons: (string | undefined)[]): Bald {
    return {
        EntryPackage: application.map((entry, index) => ({
            appContextId: entry.appContextId,
            appType: entry.appType,
            clearAppContextCacheDate: entry.clearAppContextCacheDate,
            bcastEntryPackageUrl: entry.bcastEntryPackageUrl,
            bcastEntryPointUrl: entry.bcastEntryPointUrl,
            bbandEntryPointUrl: entry.bbandEntryPointUrl,
            validFrom: entry.validFrom,
            validUntil: entry.validUntil,
            lctTSIRef: entry.lctTSIRef,
            appId: entry.appId,
            appName: entry.appName,
            controlCode: entry.controlCode,
            appIcon: appIcons[index],
        })),
    };
}

// Null when there is no broadcastBasePatterns (3.8).
export function buildUsbd(service: ServiceDeclaration): Usbd | null {
    const broadcast = service.delivery.broadcastBasePatterns;
    if (broadcast === undefined) {
        return null;
    }
    const unicast = service.delivery.unicastBasePatterns;
    return {
        UserServiceDescription: {
            serviceId: service.slt.serviceId,
            DeliveryMethod: [{
                BroadcastAppService: [{ BasePattern: broadcast }],
                UnicastAppService: unicast === undefined ? undefined : [{ BasePattern: unicast }],
            }],
        },
    };
}

// Only what ATSC A/331, A.3.3.2, defines: cyclePeriod, order and
// lastModified go to the emission descriptor (3.6). The appContextIdList of
// a flow also has the appContextId of each entry whose lctTSIRef lists it
// (ABNT NBR 25608, 10.1).
export function buildStsid(carousel: CarouselDeclaration, application: ApplicationDeclaration | null): Stsid {
    return {
        RS: [{
            LS: carousel.flows.map((flow) => ({
                tsi: flow.tsi,
                SrcFlow: {
                    EFDT: {
                        'FDT-Instance': {
                            maxExpiresDelta: flow.maxExpiresDelta,
                            appContextIdList: flowAppContextIds(flow, application),
                            fileTemplate: flow.fileTemplate,
                            filterCodes: flow.filterCodes,
                            File: flow.files.map(stsidFile),
                        },
                    },
                },
            })),
        }],
    };
}

export function buildPrrd(privacy: PrivacyDeclaration): Prrd {
    return privacy;
}

// 3.7.
export function buildEmissionDescriptor(serviceId: number, carousel: CarouselDeclaration, bases: EmissionBases):
    EmissionDescriptor {
    return {
        serviceId,
        emissionBaseUrl: `${bases.servicesBaseUrl}${serviceId}/`,
        cycleEpoch: carousel.cycleEpoch,
        signaling: {
            url: `${bases.signalingBaseUrl}sls/${serviceId}`,
            cyclePeriod: carousel.signalingCyclePeriod,
        },
        flows: carousel.flows.map((flow) => ({
            tsi: flow.tsi,
            cyclePeriod: flow.cyclePeriod,
            objects: descriptorObjects(flow, carousel.cycleEpoch),
        })),
    };
}

// The appContextIdList of the flow, then the appContextId of each entry
// whose lctTSIRef lists the flow, without repetition; undefined when empty.
function flowAppContextIds(flow: CarouselFlow, application: ApplicationDeclaration | null): string[] | undefined {
    const ids = [...(flow.appContextIdList ?? [])];
    for (const entry of application ?? []) {
        const listed = entry.lctTSIRef?.includes(flow.tsi) ?? false;
        if (listed && !ids.includes(entry.appContextId)) {
            ids.push(entry.appContextId);
        }
    }
    return ids.length === 0 ? undefined : ids;
}

function stsidFile(file: CarouselFlow['files'][number]): StsidFile {
    return {
        'Content-Location': file.contentLocation,
        'Content-Type': file.contentType,
        'Content-Length': file.contentLength,
        appContextIdList: file.appContextIdList,
        filterCodes: file.filterCodes,
    };
}

function descriptorObjects(flow: CarouselFlow, cycleEpoch: string): EmissionDescriptor['flows'][number]['objects'] {
    return flow.files.map((file, index) => ({
        contentLocation: file.contentLocation,
        order: file.order ?? index,
        lastModified: file.lastModified ?? cycleEpoch,
    }));
}
