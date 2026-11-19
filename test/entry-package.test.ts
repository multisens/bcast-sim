import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { test } from 'node:test';
import { buildEntryPackage, stsidSchema } from '../src/modules/emission';
import {
    APP_CONTEXT_ID, SERVICE_ID, applicationDeclaration, carouselDeclaration, load, serviceDirOf, writeEmission,
    writeJson,
} from './helpers/emission-fixtures';

const PACKAGE_LOCATION = 'app.pkg';
const OTHER_CONTEXT_ID = 'urn:sbtvd:app:1001:other';

test('an entry package is the files of its folder, a part per file with a relative Content-Location', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-')), PACKAGE_LOCATION);
    fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<p>ola</p>');
    fs.writeFileSync(path.join(dir, 'js', 'app.js'), 'run();');
    fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    fs.writeFileSync(path.join(dir, '.hidden'), 'x');

    const built = buildEntryPackage(dir);
    const boundary = /boundary=(\S+)$/.exec(built.contentType)?.[1];
    assert.ok(built.contentType.startsWith('multipart/related; type="text/html"'));
    assert.ok(boundary !== undefined);
    const text = built.body.toString('latin1');
    const locations = [...text.matchAll(/Content-Location: (\S+)/g)].map((match) => match[1]);
    assert.deepEqual(locations, ['index.html', 'js/app.js', 'logo.png']);
    assert.match(text, /Content-Type: text\/javascript\r\nContent-Location: js\/app\.js/);
    assert.ok(built.body.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])));
    assert.ok(text.endsWith(`--${boundary}--\r\n`));
    assert.deepEqual(buildEntryPackage(dir).body, built.body);
});

test('a carousel entry package must be a folder with files', () => {
    const emissionDir = writeEmission();
    const serviceDir = serviceDirOf(emissionDir);
    const carousel = carouselDeclaration();
    const flows = carousel.flows as Record<string, unknown>[];
    (flows[0].files as Record<string, unknown>[]).push({ contentLocation: PACKAGE_LOCATION,
        contentType: 'multipart/related' });
    writeJson(path.join(serviceDir, 'carrossel.json'), carousel, 1);
    assert.equal(load(emissionDir).load.services.has(SERVICE_ID), false);

    fs.mkdirSync(path.join(serviceDir, 'arquivos', PACKAGE_LOCATION));
    fs.writeFileSync(path.join(serviceDir, 'arquivos', PACKAGE_LOCATION, 'index.html'), '<p>ola</p>');
    const service = load(emissionDir).load.services.get(SERVICE_ID);
    assert.deepEqual([...(service?.entryPackages ?? [])], [PACKAGE_LOCATION]);
});

test('the S-TSID adds the appContextId of each entry to the flows of its lctTSIRef (ABNT NBR 25608, 10.1)', () => {
    const emissionDir = writeEmission();
    const serviceDir = serviceDirOf(emissionDir);
    const application = applicationDeclaration();
    application.push({ ...application[0], appContextId: OTHER_CONTEXT_ID, appId: OTHER_CONTEXT_ID,
        lctTSIRef: [10, 11] });
    writeJson(path.join(serviceDir, 'aplicacao.json'), application, 1);
    const service = load(emissionDir).load.services.get(SERVICE_ID);
    const stsid = stsidSchema.parse(service?.fragments.get('stsid')?.content);
    const lists = stsid.RS[0].LS.map((flow) => flow.SrcFlow.EFDT['FDT-Instance'].appContextIdList);
    assert.deepEqual(lists, [[APP_CONTEXT_ID, OTHER_CONTEXT_ID], [OTHER_CONTEXT_ID]]);
});
