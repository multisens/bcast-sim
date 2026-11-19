import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';

// The entry package (3.8; ATSC A/331, A.3.3.4, Unsigned Package Mode): the
// files of a folder as one multipart/related document, a part per file,
// with Content-Location relative to the folder.

export type EntryPackage = {
    contentType: string;
    body: Buffer;
};

type PackagePart = {
    location: string;
    contentType: string;
    body: Buffer;
};

export const PACKAGE_TYPE = 'multipart/related';

const BOUNDARY_PREFIX = 'pkg-';
const BOUNDARY_HASH_LENGTH = 16;
const CRLF = '\r\n';

// The relative paths of the files under dir, sorted; an Error when dir has
// none, or a file has no media type by its extension.
export function packageLocations(dir: string): string[] {
    const locations = listFiles(dir, '');
    if (locations.length === 0) {
        throw new Error(`entry package folder ${dir} has no file`);
    }
    for (const location of locations) {
        if (mime.lookup(location) === false) {
            throw new Error(`entry package file '${location}' has no media type for its extension`);
        }
    }
    return locations;
}

// Read at each call, so that a file changed in the folder is in the next
// package. The type parameter is the media type of the first part.
export function buildEntryPackage(dir: string): EntryPackage {
    const parts: PackagePart[] = packageLocations(dir).map((location) => ({
        location,
        contentType: String(mime.lookup(location)),
        body: fs.readFileSync(path.join(dir, location)),
    }));
    const boundary = boundaryOf(parts);
    const chunks: Buffer[] = [];
    for (const part of parts) {
        const header = [
            `--${boundary}`,
            `Content-Type: ${part.contentType}`,
            `Content-Location: ${part.location}`,
            'Content-Transfer-Encoding: binary',
            '',
            '',
        ].join(CRLF);
        chunks.push(Buffer.from(header), part.body, Buffer.from(CRLF));
    }
    chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
    return {
        contentType: `${PACKAGE_TYPE}; type="${parts[0].contentType}"; boundary=${boundary}`,
        body: Buffer.concat(chunks),
    };
}

// Derived from the parts, so that it does not occur in them and the same
// package gives the same bytes.
function boundaryOf(parts: PackagePart[]): string {
    const digest = crypto.createHash('sha256');
    for (const part of parts) {
        digest.update(part.location);
        digest.update(part.body);
    }
    return `${BOUNDARY_PREFIX}${digest.digest('hex').slice(0, BOUNDARY_HASH_LENGTH)}`;
}

function listFiles(dir: string, prefix: string): string[] {
    const found: string[] = [];
    const entries = fs.readdirSync(path.join(dir, prefix), { withFileTypes: true });
    for (const entry of entries.sort((one, other) => one.name.localeCompare(other.name))) {
        if (entry.name.startsWith('.')) {
            continue;
        }
        const location = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
            found.push(...listFiles(dir, location));
        }
        else if (entry.isFile()) {
            found.push(location);
        }
    }
    return found;
}
