import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { LoadedStream } from '../streams';
import {
    EmissionBases, Icons, buildBald, buildBam, buildBamt, buildEmissionDescriptor, buildPrrd, buildSlt, buildStsid,
    buildUsbd,
} from './build';
import {
    ApplicationDeclaration, CarouselDeclaration, CarouselFlow, ChannelDeclaration, DEFAULT_LLS_CYCLE_PERIOD_MS, PrivacyDeclaration,
    ServiceDeclaration, applicationDeclarationSchema, carouselDeclarationSchema, channelDeclarationSchema,
    privacyDeclarationSchema, serviceDeclarationSchema,
} from './declarations';
import {
    Bam, Bamt, EmissionDescriptor, MetadataUri, Slt, baldSchema, bamtSchema, emissionDescriptorSchema, prrdSchema,
    sltSchema, stsidSchema, svgSchema, usbdSchema,
} from './fragments';
import { PACKAGE_TYPE, packageLocations } from './entry-package';

// Load of the emission declarations: reads canais/ and servicos/, checks each
// declaration and the rules that cross them, builds the fragments and gives
// each one its version. What fails a check is refused and logged; the rest is
// served.

export type Refusal = {
    source: string;
    reason: string;
};

export type VersionRecord = {
    content: string;
    version: number;
};

export type Versioned<T> = {
    content: T;
    version: number;
};

export type LoadedChannel = {
    bsid: number;
    llsCyclePeriod: number;
    slt: Versioned<Slt>;
    bamt: Versioned<Bamt> | null;
};

// The static SLS fragments of a service; the MPD is made per request.
export type StaticMetadataUri = Exclude<MetadataUri, 'mpd'>;

export type LoadedService = {
    serviceId: number;
    bsid: number;
    fragments: Map<StaticMetadataUri, Versioned<unknown>>;
    descriptor: EmissionDescriptor | null;
    // contentLocation of each entry package of the carousel.
    entryPackages: Set<string>;
    // The carousel has a flow with a fileTemplate under live/.
    carriesStreams: boolean;
};

export type EmissionContext = {
    emissionDir: string;
    bases: EmissionBases;
    // <aovivo>, the MPD.BaseURL of the generated MPDs.
    liveBaseUrl: string;
    // Values of the ${NAME} references in the declarations.
    variables: Map<string, string>;
    streamsOfService: (serviceId: string) => LoadedStream[];
};

export type EmissionLoad = {
    channels: Map<number, LoadedChannel>;
    services: Map<number, LoadedService>;
    versions: Map<string, VersionRecord>;
    refusals: Refusal[];
};

type ServiceFiles = {
    serviceId: number;
    dir: string;
    declaration: ServiceDeclaration;
    application: ApplicationDeclaration | null;
    carousel: CarouselDeclaration | null;
    privacy: PrivacyDeclaration | null;
    // Declaration files and icons, for the version of each fragment.
    sources: { service: string[]; bam: string[]; application: string[]; carousel: string[]; privacy: string[] };
    bam: Bam | null;
    appIcons: (string | undefined)[];
};

type ChannelFile = {
    source: string;
    declaration: ChannelDeclaration;
};

const CHANNELS_DIR = 'canais';
const SERVICES_DIR = 'servicos';
const SERVICE_FILE = 'servico.json';
const APPLICATION_FILE = 'aplicacao.json';
const CAROUSEL_FILE = 'carrossel.json';
const PRIVACY_FILE = 'privacidade.json';
const FILES_DIR = 'arquivos';
const LIVE_PATH = /^live\/([A-Za-z0-9._-]+)\//;
const SERVICE_DIR_NAME = /^\d+$/;
const MS_PER_SECOND = 1000;
const LLS_VERSION_MODULO = 256;
const VARIABLE_REFERENCE = /\$\{([A-Z][A-Z0-9_]*)\}/g;

export function servicesDirOf(emissionDir: string): string {
    return path.join(emissionDir, SERVICES_DIR);
}

export function filesDirOf(emissionDir: string, serviceId: number): string {
    return path.join(emissionDir, SERVICES_DIR, String(serviceId), FILES_DIR);
}

export function loadEmission(context: EmissionContext, previous: Map<string, VersionRecord>): EmissionLoad {
    const refusals: Refusal[] = [];
    const channelFiles = readChannels(context, refusals);
    const serviceFiles = readServices(context, refusals);

    const membership = channelMembership(channelFiles, refusals);
    const accepted = new Map<number, ServiceFiles>();
    for (const [serviceId, files] of serviceFiles) {
        const bsid = membership.get(serviceId);
        if (bsid === undefined) {
            refusals.push({ source: files.dir, reason: `service ${serviceId} is not listed in exactly one channel` });
            continue;
        }
        accepted.set(serviceId, files);
    }
    for (const reason of crossServiceProblems(channelFiles, accepted)) {
        refusals.push(reason.refusal);
        accepted.delete(reason.serviceId);
    }

    const versions = new Map<string, VersionRecord>();
    const version = (key: string, content: unknown, sources: string[], modulo: number | null): number => {
        const record = nextVersion(previous.get(key), JSON.stringify(content), modifiedSeconds(sources), modulo);
        versions.set(key, record);
        return record.version;
    };

    const channels = new Map<number, LoadedChannel>();
    for (const channel of channelFiles) {
        const declaration = channel.declaration;
        const members = declaration.services
            .map((serviceId) => accepted.get(serviceId))
            .filter((files): files is ServiceFiles => files !== undefined);
        if (members.length === 0) {
            refusals.push({ source: channel.source, reason: 'no service of the channel was accepted' });
            continue;
        }
        const sltSources = [channel.source, ...members.flatMap((files) => files.sources.service)];
        const bams = members.map((files) => files.bam).filter((bam): bam is Bam => bam !== null);
        const bamSources = [channel.source, ...members.flatMap((files) => files.sources.bam)];
        try {
            const slt = sltSchema.parse(buildSlt(declaration, members.map((files) => files.declaration)));
            const bamtContent = buildBamt(declaration, bams);
            const bamt = bamtContent === null ? null : bamtSchema.parse(bamtContent);
            channels.set(declaration.bsid, {
                bsid: declaration.bsid,
                llsCyclePeriod: declaration.llsCyclePeriod ?? DEFAULT_LLS_CYCLE_PERIOD_MS,
                slt: { content: slt, version: version(`lls/${declaration.bsid}/slt`, slt, sltSources,
                    LLS_VERSION_MODULO) },
                bamt: bamt === null ? null : { content: bamt, version: version(`lls/${declaration.bsid}/bamt`, bamt,
                    bamSources, LLS_VERSION_MODULO) },
            });
        }
        catch (error) {
            refusals.push({ source: channel.source, reason: `built tables fail their schema: ${errorMessage(error)}` });
        }
    }

    const services = new Map<number, LoadedService>();
    for (const [serviceId, files] of accepted) {
        const bsid = membership.get(serviceId);
        if (bsid === undefined || !channels.has(bsid)) {
            continue;
        }
        try {
            const built = staticFragments(files);
            const fragments = new Map<StaticMetadataUri, Versioned<unknown>>();
            for (const [uri, fragment] of built) {
                const key = `sls/${serviceId}/${uri}`;
                fragments.set(uri, { content: fragment.content,
                    version: version(key, fragment.content, fragment.sources, null) });
            }
            const descriptor = files.carousel === null ? null
                : emissionDescriptorSchema.parse(buildEmissionDescriptor(serviceId, files.carousel, context.bases));
            services.set(serviceId, { serviceId, bsid, fragments, descriptor,
                entryPackages: entryPackagesOf(files.carousel), carriesStreams: carriesStreams(files.carousel) });
        }
        catch (error) {
            refusals.push({ source: files.dir, reason: `built fragments fail their schema: ${errorMessage(error)}` });
        }
    }

    return { channels, services, versions, refusals };
}

// A version that changes only when the content changes, and grows: the
// modification time of the sources, in seconds, or the previous version plus
// one when that time does not grow. The LLS_table_version wraps at 256.
export function nextVersion(previous: VersionRecord | undefined, content: string, candidate: number,
    modulo: number | null): VersionRecord {
    if (previous !== undefined && previous.content === content) {
        return previous;
    }
    if (modulo === null) {
        const version = previous === undefined ? candidate : Math.max(candidate, previous.version + 1);
        return { content, version };
    }
    let version = candidate % modulo;
    if (previous !== undefined && version === previous.version) {
        version = (version + 1) % modulo;
    }
    return { content, version };
}

function entryPackagesOf(carousel: CarouselDeclaration | null): Set<string> {
    const locations = (carousel?.flows ?? []).flatMap((flow) => flow.files.filter(isEntryPackage)
        .map((file) => file.contentLocation));
    return new Set(locations);
}

function carriesStreams(carousel: CarouselDeclaration | null): boolean {
    return (carousel?.flows ?? []).some((flow) => flow.fileTemplate !== undefined
        && LIVE_PATH.test(flow.fileTemplate));
}

// A file of type multipart/related is an entry package, built from the
// folder of the same name.
function isEntryPackage(file: CarouselFlow['files'][number]): boolean {
    return file.contentType === PACKAGE_TYPE;
}

function staticFragments(files: ServiceFiles): Map<StaticMetadataUri, { content: unknown; sources: string[] }> {
    const fragments = new Map<StaticMetadataUri, { content: unknown; sources: string[] }>();
    const usbd = buildUsbd(files.declaration);
    if (usbd !== null) {
        fragments.set('usbd', { content: usbdSchema.parse(usbd), sources: files.sources.service });
    }
    if (files.carousel !== null) {
        fragments.set('stsid', { content: stsidSchema.parse(buildStsid(files.carousel, files.application)),
            sources: [...files.sources.carousel, ...files.sources.application] });
    }
    if (files.application !== null) {
        fragments.set('bald', { content: baldSchema.parse(buildBald(files.application, files.appIcons)),
            sources: files.sources.application });
    }
    if (files.privacy !== null) {
        fragments.set('prrd', { content: prrdSchema.parse(buildPrrd(files.privacy)), sources: files.sources.privacy });
    }
    return fragments;
}

function readChannels(context: EmissionContext, refusals: Refusal[]): ChannelFile[] {
    const dir = path.join(context.emissionDir, CHANNELS_DIR);
    if (!fs.existsSync(dir)) {
        return [];
    }
    const channels: ChannelFile[] = [];
    const names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
    for (const name of names) {
        const source = path.join(dir, name);
        try {
            const declaration = readDeclaration(source, channelDeclarationSchema, context.variables);
            if (name !== `${declaration.bsid}.json`) {
                throw new Error(`file name does not match bsid ${declaration.bsid}`);
            }
            if (new Set(declaration.services).size !== declaration.services.length) {
                throw new Error('a service is listed more than once');
            }
            channels.push({ source, declaration });
        }
        catch (error) {
            refusals.push({ source, reason: errorMessage(error) });
        }
    }
    return channels;
}

function readServices(context: EmissionContext, refusals: Refusal[]): Map<number, ServiceFiles> {
    const dir = servicesDirOf(context.emissionDir);
    const services = new Map<number, ServiceFiles>();
    if (!fs.existsSync(dir)) {
        return services;
    }
    const names = fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && SERVICE_DIR_NAME.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    for (const name of names) {
        const serviceDir = path.join(dir, name);
        try {
            services.set(Number(name), readService(context, serviceDir, Number(name)));
        }
        catch (error) {
            refusals.push({ source: serviceDir, reason: errorMessage(error) });
        }
    }
    return services;
}

function readService(context: EmissionContext, dir: string, serviceId: number): ServiceFiles {
    const serviceSource = path.join(dir, SERVICE_FILE);
    const declaration = readDeclaration(serviceSource, serviceDeclarationSchema, context.variables);
    if (declaration.slt.serviceId !== serviceId) {
        throw new Error(`directory name does not match serviceId ${declaration.slt.serviceId}`);
    }
    const isBootstrapService = declaration.slt.serviceCategory === 30;

    const applicationSource = path.join(dir, APPLICATION_FILE);
    const carouselSource = path.join(dir, CAROUSEL_FILE);
    const privacySource = path.join(dir, PRIVACY_FILE);
    const application = optionalDeclaration(applicationSource, applicationDeclarationSchema, context.variables);
    const carousel = optionalDeclaration(carouselSource, carouselDeclarationSchema, context.variables);
    const privacy = optionalDeclaration(privacySource, privacyDeclarationSchema, context.variables);

    // ABNT NBR 25602, Tables A.1 and A.2: BALD and PRRD only in type 30;
    // S-TSID mandatory in the Broadcast configuration.
    if (!isBootstrapService && application !== null) {
        throw new Error(`${APPLICATION_FILE} is only allowed in type 30`);
    }
    if (!isBootstrapService && privacy !== null) {
        throw new Error(`${PRIVACY_FILE} is only allowed in type 30`);
    }
    if (declaration.delivery.configuration === 'Broadcast' && carousel === null) {
        throw new Error(`Broadcast configuration requires ${CAROUSEL_FILE}`);
    }

    const streams = context.streamsOfService(String(serviceId));
    checkStreams(streams, declaration, context.liveBaseUrl);
    if (carousel !== null) {
        checkCarousel(carousel, dir, streams);
    }
    if (application !== null) {
        checkApplication(application, carousel);
    }

    const bamSources = [serviceSource];
    let bam: Bam | null = null;
    if (declaration.bam !== undefined) {
        const icons: Icons = {
            appIcon: readIcon(dir, declaration.bam.appIcon),
            bannerIcon: readIcon(dir, declaration.bam.bannerIcon),
        };
        bamSources.push(path.join(dir, declaration.bam.appIcon), path.join(dir, declaration.bam.bannerIcon));
        bam = buildBam(declaration, icons);
    }
    const applicationSources = application === null ? [] : [applicationSource];
    const appIcons = (application ?? []).map((entry) => {
        if (entry.appIcon === undefined) {
            return undefined;
        }
        applicationSources.push(path.join(dir, entry.appIcon));
        return readIcon(dir, entry.appIcon);
    });

    return {
        serviceId,
        dir,
        declaration,
        application,
        carousel,
        privacy,
        sources: {
            service: [serviceSource],
            bam: bamSources,
            application: applicationSources,
            carousel: carousel === null ? [] : [carouselSource],
            privacy: privacy === null ? [] : [privacySource],
        },
        bam,
        appIcons,
    };
}

// The MPD is mandatory in both configurations (ABNT NBR 25602, Tables A.1 and
// A.2), and one MPD joins all streams of the service.
function checkStreams(streams: LoadedStream[], declaration: ServiceDeclaration, liveBaseUrl: string): void {
    if (streams.length === 0) {
        throw new Error('the service has no loaded stream, and the MPD is mandatory');
    }
    const ready = streams.filter((stream) => stream.media === null);
    if (ready.length > 0) {
        if (streams.length !== 1 || ready[0].manifestPaths.mpd === null) {
            throw new Error('a ready-made MPD must be the only stream of its service');
        }
        return;
    }
    const epoch = streams[0].declaration.availabilityStartTime;
    if (streams.some((stream) => stream.declaration.availabilityStartTime !== epoch)) {
        throw new Error('the streams of a service must share availabilityStartTime');
    }
    // In the Broadband configuration, a unicast pattern equals MPD.BaseURL.
    const unicast = declaration.delivery.unicastBasePatterns ?? [];
    if (declaration.delivery.configuration === 'Broadband' && !unicast.includes(liveBaseUrl)) {
        throw new Error(`Broadband configuration requires '${liveBaseUrl}' (MPD.BaseURL) in unicastBasePatterns`);
    }
}

function checkCarousel(carousel: CarouselDeclaration, dir: string, streams: LoadedStream[]): void {
    const tsis = new Set<number>();
    const locations = new Set<string>();
    const streamIds = new Set(streams.map((stream) => stream.declaration.streamId));
    for (const flow of carousel.flows) {
        if (tsis.has(flow.tsi)) {
            throw new Error(`tsi ${flow.tsi} is declared more than once`);
        }
        tsis.add(flow.tsi);
        for (const file of flow.files) {
            const location = file.contentLocation;
            if (locations.has(location)) {
                throw new Error(`contentLocation '${location}' is declared more than once`);
            }
            locations.add(location);
            const live = LIVE_PATH.exec(location);
            if (live !== null) {
                if (!streamIds.has(live[1])) {
                    throw new Error(`contentLocation '${location}' names a stream the service does not have`);
                }
                continue;
            }
            const filePath = path.join(dir, FILES_DIR, location);
            if (isEntryPackage(file)) {
                if (!fs.existsSync(filePath) || !fs.statSync(filePath).isDirectory()) {
                    throw new Error(`entry package '${location}' is not a folder under ${FILES_DIR}/`);
                }
                packageLocations(filePath);
                continue;
            }
            if (!fs.existsSync(filePath)) {
                throw new Error(`contentLocation '${location}' does not exist under ${FILES_DIR}/`);
            }
        }
    }
}

// The broadcast entry, lctTSIRef and the STORED_* codes need the
// carousel; the entry package is one of its files.
function checkApplication(application: ApplicationDeclaration, carousel: CarouselDeclaration | null): void {
    for (const entry of application) {
        const stored = entry.controlCode?.startsWith('STORED_') ?? false;
        const usesCarousel = entry.bcastEntryPackageUrl !== undefined || entry.lctTSIRef !== undefined || stored;
        if (!usesCarousel) {
            continue;
        }
        if (carousel === null) {
            throw new Error(`entry '${entry.appId}' needs ${CAROUSEL_FILE}`);
        }
        const flows = carousel.flows.filter((flow) => entry.lctTSIRef === undefined
            || entry.lctTSIRef.includes(flow.tsi));
        for (const tsi of entry.lctTSIRef ?? []) {
            if (!carousel.flows.some((flow) => flow.tsi === tsi)) {
                throw new Error(`lctTSIRef ${tsi} of entry '${entry.appId}' is not a flow of the carousel`);
            }
        }
        const packageUrl = entry.bcastEntryPackageUrl;
        if (packageUrl !== undefined
            && !flows.some((flow) => flow.files.some((file) => file.contentLocation === packageUrl))) {
            throw new Error(`bcastEntryPackageUrl '${packageUrl}' of entry '${entry.appId}' is not in the carousel`);
        }
    }
}

// 3.2 and ABNT NBR 25602, 8.1: a service is in exactly one channel.
function channelMembership(channels: ChannelFile[], refusals: Refusal[]): Map<number, number> {
    const membership = new Map<number, number>();
    const repeated = new Set<number>();
    for (const channel of channels) {
        for (const serviceId of channel.declaration.services) {
            if (membership.has(serviceId)) {
                repeated.add(serviceId);
            }
            membership.set(serviceId, channel.declaration.bsid);
        }
    }
    for (const serviceId of repeated) {
        refusals.push({ source: CHANNELS_DIR, reason: `service ${serviceId} is listed in more than one channel` });
        membership.delete(serviceId);
    }
    return membership;
}

// ABNT NBR 25602, 8.1, and ABNT NBR 25608, 8.4.4: additionalServices names
// services of type 31 or 32 of the same channel, and a service of type 31 or
// 32 is associated with one of type 30.
function crossServiceProblems(channels: ChannelFile[], accepted: Map<number, ServiceFiles>):
    { serviceId: number; refusal: Refusal }[] {
    const problems: { serviceId: number; refusal: Refusal }[] = [];
    for (const channel of channels) {
        const members = channel.declaration.services
            .map((serviceId) => accepted.get(serviceId))
            .filter((files): files is ServiceFiles => files !== undefined);
        const associated = new Set<number>();
        for (const files of members) {
            for (const additional of files.declaration.bam?.additionalServices ?? []) {
                const target = members.find((other) => other.serviceId === additional);
                if (target === undefined || target.declaration.slt.serviceCategory === 30) {
                    problems.push({ serviceId: files.serviceId, refusal: { source: files.dir,
                        reason: `additionalServices ${additional} is not a type 31 or 32 service of the channel` } });
                    continue;
                }
                associated.add(additional);
            }
        }
        for (const files of members) {
            if (files.declaration.slt.serviceCategory !== 30 && !associated.has(files.serviceId)) {
                problems.push({ serviceId: files.serviceId, refusal: { source: files.dir,
                    reason: 'a type 31 or 32 service must be in the additionalServices of a type 30 service' } });
            }
        }
    }
    return problems;
}

function readIcon(dir: string, relative: string): string {
    const file = path.join(dir, relative);
    if (!fs.existsSync(file)) {
        throw new Error(`icon '${relative}' does not exist`);
    }
    const parsed = svgSchema.safeParse(fs.readFileSync(file, 'utf8'));
    if (!parsed.success) {
        throw new Error(`icon '${relative}': ${parsed.error.issues[0].message}`);
    }
    return parsed.data;
}

function readDeclaration<T extends z.ZodType>(source: string, schema: T, variables: Map<string, string>):
    z.infer<T> {
    const text = substitute(fs.readFileSync(source, 'utf8'), variables, path.basename(source));
    const raw: unknown = JSON.parse(text);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(`invalid ${path.basename(source)} at '${issue.path.join('.')}': ${issue.message}`);
    }
    return parsed.data;
}

function optionalDeclaration<T extends z.ZodType>(source: string, schema: T, variables: Map<string, string>):
    z.infer<T> | null {
    if (!fs.existsSync(source)) {
        return null;
    }
    return readDeclaration(source, schema, variables);
}

// Replaces each ${NAME} by its value; a name without value refuses the file.
function substitute(text: string, variables: Map<string, string>, name: string): string {
    return text.replace(VARIABLE_REFERENCE, (_match, variable: string) => {
        const value = variables.get(variable);
        if (value === undefined) {
            throw new Error(`${name} references unknown variable ${variable}`);
        }
        return value;
    });
}

function modifiedSeconds(sources: string[]): number {
    const times = sources.map((source) => fs.statSync(source).mtimeMs);
    return Math.floor(Math.max(...times) / MS_PER_SECOND);
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
