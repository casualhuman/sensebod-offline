/*
 * BE-7…BE-10 end to end: uploads (single and resumable, R-1), the real worker
 * supervisor with real child processes, exports with the one-time password,
 * download tickets, the checks, and recovery after a worker restart and an
 * unclean boot. External tools: ffmpeg is used when it is installed; `age` is
 * replaced by a stand-in that passes bytes through (the real tool is a Pi test).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { paths as buildPaths } from '../src/config.ts';
import { Ctx, loadKeys } from '../src/core/context.ts';
import { sha256Hex } from '../src/core/ids.ts';
import { ZipWriter, csvCell, winzipCtr } from '../src/exports/archive.ts';
import { privacyHits, stickRetention, learnerCodes } from '../src/exports/jobs.ts';
import { listSnapshots } from '../src/exports/snapshots.ts';
import { WORDS, generatePassword, passwordBits } from '../src/exports/words.ts';
import { docxBlocks, refersToInternet } from '../src/media/jobs.ts';
import { ZipError, listZip, safeEntryName } from '../src/media/zip.ts';
import { bootRecover } from '../src/system/bootstrap.ts';
import { runMaintenance } from '../src/system/maint.ts';
import { VERSION } from '../src/version.ts';
import { Supervisor } from '../src/worker/supervisor.ts';
import { ADMIN, Client, HUB, makeBag, signedIn, sleep, waitFor, type Bag } from './harness.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Read a WinZip AE-2 zip made by the bag (the reference reader of docs/system/poc/poc_ae2.mjs). */
function readZip(file: Buffer, password: string | null): Record<string, Buffer> {
  const eocd = file.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = file.readUInt16LE(eocd + 10);
  let p = file.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i += 1) {
    const method = file.readUInt16LE(p + 10);
    const size = file.readUInt32LE(p + 20);
    const nameLength = file.readUInt16LE(p + 28);
    const extraLength = file.readUInt16LE(p + 30);
    const local = file.readUInt32LE(p + 42);
    const name = file.toString('utf8', p + 46, p + 46 + nameLength);
    const data = local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
    const body = file.subarray(data, data + size);
    if (method === 99) {
      if (password === null) throw new Error('encrypted');
      const keys = pbkdf2Sync(Buffer.from(password, 'utf8'), body.subarray(0, 16), 1000, 66, 'sha1');
      if (!keys.subarray(64, 66).equals(body.subarray(16, 18))) throw new Error('wrong password');
      const cipher = body.subarray(18, body.length - 10);
      if (!createHmac('sha1', keys.subarray(32, 64)).update(cipher).digest().subarray(0, 10).equals(body.subarray(body.length - 10))) throw new Error('authentication failed');
      out[name] = inflateRawSync(winzipCtr(keys.subarray(0, 32), cipher));
    } else {
      out[name] = inflateRawSync(body);
    }
    p += 46 + nameLength + extraLength + file.readUInt16LE(p + 32);
  }
  return out;
}

function makeZip(file: string, members: [string, string][]): Buffer {
  rmSync(file, { force: true });
  const zip = new ZipWriter(file, null);
  for (const [name, text] of members) zip.add(name, Buffer.from(text, 'utf8'));
  zip.finish();
  return readFileSync(file);
}

describe('pieces', () => {
  test('one-time passwords: plain words, at least 50 bits, different every time', () => {
    assert.ok(WORDS.length >= 411, `${WORDS.length} words`);
    assert.ok(passwordBits() >= 50, `${passwordBits().toFixed(1)} bits`);
    const made = new Set(Array.from({ length: 200 }, generatePassword));
    assert.equal(made.size, 200);
    for (const password of made) assert.match(password, /^([a-z]{2,7}-){4,6}\d{2}$/);
  });
  test('CSV cells: formula injection guard and RFC 4180 quoting (EX-2)', () => {
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    for (const start of ['+1', '-1', '@x', '\tx']) assert.ok(csvCell(start).replace(/^"/, '').startsWith("'"), start);
    assert.equal(csvCell('Kamara, Fatmata'), '"Kamara, Fatmata"');
    assert.equal(csvCell(-5), '-5', 'numbers are not text typed by a person');
    assert.equal(csvCell(null), '');
  });
  test('learner codes are 6 characters, longer for everyone when two would be the same', () => {
    const a = `lr-abcdef${'a'.repeat(20)}`;
    const b = `lr-abcdef${'b'.repeat(20)}`;
    assert.equal(learnerCodes([a]).get(a), 'L-ABCDEF');
    const both = learnerCodes([a, b]);
    assert.notEqual(both.get(a), both.get(b));
    assert.equal(both.get(a)?.length, both.get(b)?.length);
  });
  test('the zip writer: AES members open only with the password and detect tampering; libarchive agrees when present', () => {
    const dir = join(os.tmpdir(), `sb-zip-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'a.zip');
    const zip = new ZipWriter(file, 'river-mango-seven-chalk-stone-42');
    const big = 'learner_code,role\r\n' + Array.from({ length: 20000 }, (_, i) => `L-${i},learner\r\n`).join('');
    zip.add('learners.csv', Buffer.from(big));
    zip.add('README.txt', Buffer.from('hello \u025b \u0254 \u014b'));
    zip.finish();
    const bytes = readFileSync(file);
    assert.ok(!bytes.includes('learner_code'), 'nothing readable without the password');
    assert.equal(readZip(bytes, 'river-mango-seven-chalk-stone-42')['learners.csv']?.toString(), big);
    assert.throws(() => readZip(bytes, 'wrong'), /wrong password/);
    const tampered = Buffer.from(bytes);
    tampered[60] = (tampered[60] as number) ^ 1;
    assert.throws(() => readZip(tampered, 'river-mango-seven-chalk-stone-42'), /authentication failed|wrong password/);
    if (existsSync('/usr/bin/bsdtar')) {
      // Cross-check with an independent implementation. (argv is fine in a test; the bag never does this.)
      mkdirSync(join(dir, 'x'), { recursive: true });
      execFileSync('/usr/bin/bsdtar', ['-x', '--passphrase', 'river-mango-seven-chalk-stone-42', '-f', file, '-C', join(dir, 'x')]);
      assert.equal(readFileSync(join(dir, 'x', 'learners.csv'), 'utf8'), big);
      assert.throws(() => execFileSync('/usr/bin/bsdtar', ['-x', '--passphrase', 'wrong', '-f', file, '-C', join(dir, 'x')], { stdio: 'pipe' }));
    }
    rmSync(dir, { recursive: true, force: true });
  });
  test('the zip reader refuses unsafe archives (zip-slip, absolute names, links)', () => {
    for (const name of ['../evil.txt', 'a/../../evil', '/etc/passwd', 'C:\\x', 'a\\b', '']) assert.equal(safeEntryName(name), false, name);
    for (const name of ['index.html', 'js/app.js', 'img/']) assert.equal(safeEntryName(name), true, name);
    const file = join(os.tmpdir(), `sb-evil-${process.pid}.zip`);
    makeZip(file, [['index.html', '<p>ok</p>'], ['../../evil.txt', 'x']]);
    assert.throws(() => listZip(file), ZipError);
    writeFileSync(file, 'not a zip at all, just text that is long enough');
    assert.throws(() => listZip(file), ZipError);
    rmSync(file, { force: true });
  });
  test('Word text becomes headings, paragraphs and lists', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Clean water</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Boil water </w:t></w:r><w:r><w:t>&amp; let it cool.</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Wash hands</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Cover the pot</w:t></w:r></w:p>' +
      '<w:p></w:p></w:body></w:document>';
    assert.deepEqual(docxBlocks(xml), [
      { kind: 'heading', text: 'Clean water' },
      { kind: 'paragraph', text: 'Boil water & let it cool.' },
      { kind: 'list', ordered: false, items: ['Wash hands', 'Cover the pot'] },
    ]);
  });
  test('"opens without internet" looks for addresses outside comments', () => {
    assert.equal(refersToInternet('<script src="https://cdn.example.com/x.js"></script>'), true);
    assert.equal(refersToInternet('<!-- from https://example.com --><svg xmlns="http://www.w3.org/2000/svg"></svg>'), false);
    assert.equal(refersToInternet('/* https://example.com */ body { color: red }'), false);
  });
  test('the diagnostics privacy scan finds learner ids, names, Wi-Fi addresses and Child protection lesson ids (SEC-E2)', () => {
    assert.deepEqual(privacyHits('job jb-abc done', ['Fatmata'], ['cp-1']), []);
    assert.deepEqual(privacyHits('x lr-abcdefghijklmnopqrstuvwxyz', [], []), ['learner id']);
    assert.deepEqual(privacyHits('seen Fatmata today', ['Fatmata'], []), ['learner name']);
    assert.deepEqual(privacyHits('a sample of things', ['Sam'], []), [], 'a name inside another word is not a hit');
    assert.deepEqual(privacyHits('from 10.10.0.57', [], []), ['wifi address']);
    assert.deepEqual(privacyHits('opened cp-child-1', [], ['cp-child-1']), ['child protection lesson id']);
  });
  test('stick retention: 3 backups per bag, learner-data zips 7 days, .partial files removed, nothing outside SENSEBOD-OFFLINE/ (USB-4)', () => {
    const stick = join(os.tmpdir(), `sb-stick-${process.pid}`);
    const root = join(stick, 'SENSEBOD-OFFLINE');
    const records = join(root, 'bag-1', 'records');
    mkdirSync(records, { recursive: true });
    mkdirSync(join(root, 'bag-1', 'media', 'aa'), { recursive: true });
    mkdirSync(join(root, 'learner-data'), { recursive: true });
    const names = ['20261101-0900', '20261102-0900', '20261103-0900', '20261104-0900', '20261105-0900'].map((t) => `sensebod-offline-backup_bag_${t}_abcdef.sbk`);
    names.forEach((name, i) => {
      writeFileSync(join(records, name), 'x');
      writeFileSync(join(records, `${name}.media.json`), JSON.stringify([`${String(i).repeat(64)}.mp4`]));
      writeFileSync(join(root, 'bag-1', 'media', 'aa', `${String(i).repeat(64)}.mp4`), 'v');
    });
    writeFileSync(join(root, 'bag-1', 'LATEST.json'), JSON.stringify({ file: names[4] }));
    writeFileSync(join(records, 'half.sbk.partial'), 'x');
    writeFileSync(join(root, 'learner-data', 'sensebod-offline-learner-data_bag_20261101-0900_abcdef.zip'), 'old');
    writeFileSync(join(root, 'learner-data', 'sensebod-offline-learner-data_bag_20261101-0900_abcdef.zip.sha256'), 'old');
    writeFileSync(join(root, 'learner-data', 'sensebod-offline-learner-data_bag_20261112-0900_abcdef.zip'), 'new');
    writeFileSync(join(stick, 'family-photo.jpg'), 'mine');
    const result = stickRetention(root, 'bag-1', Date.parse('2026-11-13T12:00:00Z'));
    assert.deepEqual(result, { backupsRemoved: 2, mediaRemoved: 2, learnerDataRemoved: 1, partialsRemoved: 1 });
    assert.deepEqual(readdirSync(records).filter((n) => n.endsWith('.sbk')).sort(), names.slice(2));
    assert.deepEqual(readdirSync(join(root, 'learner-data')), ['sensebod-offline-learner-data_bag_20261112-0900_abcdef.zip']);
    assert.ok(existsSync(join(stick, 'family-photo.jpg')));
    rmSync(stick, { recursive: true, force: true });
  });
});

describe('uploads, worker and exports', () => {
  let bag: Bag;
  let worker: Supervisor;
  let workerCtx: Ctx;
  let admin: Client;
  let hub: Client;
  const upload = (id: string) => bag.ctx.db.get<{ state: string; received_bytes: number; blob_sha256: string | null; processing_note: string | null }>('SELECT state, received_bytes, blob_sha256, processing_note FROM upload WHERE id = ?', id);
  const ready = (id: string) => waitFor(() => (upload(id)?.state === 'ready' || upload(id)?.state === 'failed' ? upload(id) : null), 30_000);
  const startWorker = (): void => {
    workerCtx = new Ctx({ config: bag.config, role: 'batch', version: VERSION, boot: bag.ctx.boot, keys: loadKeys(buildPaths(bag.config)) });
    worker = new Supervisor(workerCtx, { childArgv: ['--config', bag.configPath], pollMs: 100 });
    worker.start();
  };
  const stopWorker = async (): Promise<void> => {
    await worker.stop();
    workerCtx.close();
  };

  before(async () => {
    const dir = join(os.tmpdir(), `sb-tools-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    // A stand-in for `age`: same arguments, passes the bytes through. The real tool is checked on the Pi (BK-1).
    const fakeAge = join(dir, 'age');
    writeFileSync(fakeAge, '#!/bin/sh\nout=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; shift; done\ncat > "$out"\n');
    chmodSync(fakeAge, 0o755);
    bag = await makeBag({ toml: `[tools]\nage = "${fakeAge}"\n` });
    writeFileSync(bag.config.paths.recipientsFile, 'age1testrecipient\n');
    startWorker();
    admin = await signedIn(bag, ADMIN, '10.10.0.40');
    hub = await signedIn(bag, HUB, '10.10.0.41');
  });
  after(async () => {
    await stopWorker();
    await bag.close();
  });

  test('a photo: one request, streamed to disk, hashed and stored by the worker, served from a content-addressed name', async () => {
    const sent = await admin.post('/admin/uploads', PNG, { 'X-File-Name': encodeURIComponent('../../etc/Fatmata notes.PNG'), ...admin.key() });
    assert.equal(sent.status, 201, sent.text);
    assert.equal(sent.body.kind, 'photo');
    assert.equal(sent.body.becomes, 'read');
    assert.equal(sent.body.receivedBytes, PNG.length);
    assert.equal(sent.body.processing.state, 'working');
    assert.ok(!sent.body.fileName.includes('/'), 'the name is for display only and holds no path');
    const row = await ready(sent.body.id);
    assert.equal(row?.state, 'ready');
    assert.equal(row?.blob_sha256, sha256Hex(PNG));
    const lesson = await admin.post('/admin/lessons', { source: 'notes-photos', title: 'Notes', uploadIds: [sent.body.id] }, admin.key());
    assert.equal(lesson.status, 201, lesson.text);
    assert.equal(lesson.body.pages, 1);
    await admin.patch(`/admin/lessons/${lesson.body.id}`, { placement: { portalId: 'primary', groupId: 'primary-class-1', seriesId: 'primary-class-1-english-language', position: 1 } });
    assert.equal((await admin.post(`/admin/lessons/${lesson.body.id}/publish`)).status, 200);
    const seen = await new Client(bag).get(`/lessons/${lesson.body.id}`);
    const url = seen.body.content.pageImages[0].url as string;
    assert.match(url, /^\/media\/c\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
    const file = await fetch(new URL(bag.base).origin + url);
    assert.equal(file.status, 200);
    assert.match(String(file.headers.get('content-security-policy')), /sandbox/);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    assert.ok(!existsSync(join(bag.ctx.paths.uploadsPartial, `${sent.body.id}.part`)), 'the raw upload is gone once stored');
  });

  test('refused kinds and lies: .exe, .doc, .svg, a text file named .png, no session', async () => {
    for (const name of ['virus.exe', 'old.doc', 'drawing.svg', 'page.html', 'noext']) {
      const r = await admin.post('/admin/uploads', PNG, { 'X-File-Name': name });
      assert.equal(r.status, 415, name);
    }
    assert.match((await admin.post('/admin/uploads', PNG, { 'X-File-Name': 'old.doc' })).body.error.message, /PDF or \.docx/);
    const liar = await admin.post('/admin/uploads', Buffer.from('<script>alert(1)</script> padding padding'), { 'X-File-Name': 'photo.png' });
    assert.equal(liar.status, 415);
    assert.equal((await new Client(bag).post('/admin/uploads', PNG, { 'X-File-Name': 'a.png' })).status, 401);
    assert.deepEqual(readdirSync(bag.ctx.paths.uploadsPartial), [], 'nothing of a refused upload is kept');
  });

  test('resumable: wrong offsets are answered with where to continue, a broken connection loses nothing confirmed, one upload id to the end (PL-2, BR-2)', async () => {
    const docx = makeZip(join(bag.dir, 'lesson.docx'), [
      ['[Content_Types].xml', '<Types/>'],
      ['word/document.xml', `<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Farming</w:t></w:r></w:p>${'<w:p><w:r><w:t>Plant in rows and water early. </w:t></w:r></w:p>'.repeat(4000)}</w:body></w:document>`],
      // Bytes that do not compress, so the file spans several chunks.
      ['padding.bin', randomBytes(300_000).toString('base64')],
    ]);
    const total = docx.length;
    assert.ok(total > 3 * 65536, `the test file must span several chunks (${total} bytes)`);
    const key = admin.key();
    const started = await admin.post('/admin/uploads/resumable', { fileName: 'lesson.docx', sizeBytes: total, mimeType: 'application/zip' }, key);
    assert.equal(started.status, 201, started.text);
    assert.equal(started.body.chunkBytes, 65536);
    assert.equal((await admin.post('/admin/uploads/resumable', { fileName: 'lesson.docx', sizeBytes: total, mimeType: 'application/zip' }, key)).body.id, started.body.id, 'a retry of the start returns the first upload');
    const id = started.body.id as string;
    const chunk = (from: number, to: number) => admin.put(`/admin/uploads/${id}/bytes`, docx.subarray(from, to), { 'Content-Range': `bytes ${from}-${to - 1}/${total}` });

    assert.equal((await chunk(0, 65536)).body.receivedBytes, 65536);
    const skipped = await chunk(131072, 196608);
    assert.equal(skipped.status, 409);
    assert.equal(skipped.body.error.code, 'offset_mismatch');
    assert.equal(skipped.body.error.details.receivedBytes, 65536);
    assert.equal((await chunk(0, 65536)).status, 409, 'resending a received range is answered like a mismatch');
    assert.equal((await admin.put(`/admin/uploads/${id}/bytes`, docx.subarray(65536, 65636), { 'Content-Range': `bytes 65536-131071/${total}` })).status, 422, 'a chunk shorter than it says');

    // Three forced disconnects in the middle of a chunk: the bag keeps only what it confirmed.
    for (let cut = 0; cut < 3; cut += 1) {
      await new Promise<void>((resolve) => {
        const target = new URL(`${bag.base}/admin/uploads/${id}/bytes`);
        const req = httpRequest({
          host: target.hostname,
          port: target.port,
          path: target.pathname,
          method: 'PUT',
          headers: { 'X-Sensebod-Offline-Client': '1', 'X-Forwarded-For': admin.ip, Cookie: `sb_admin=${admin.cookies.get('sb_admin')}`, 'Content-Range': `bytes 65536-131071/${total}`, 'Content-Length': '65536' },
        });
        req.on('error', () => resolve());
        req.write(docx.subarray(65536, 65536 + 20000), () => {
          req.destroy();
          setTimeout(resolve, 150);
        });
      });
      const state = await admin.get(`/admin/uploads/${id}`);
      assert.equal(state.body.receivedBytes, 65536, `after disconnect ${cut + 1}`);
      assert.equal(state.body.state, 'receiving');
    }
    for (let from = 65536; from < total; from += 65536) {
      // Like the real client: "409 in_progress, Retry-After" means the bag is still letting go of the broken connection.
      let r = await chunk(from, Math.min(total, from + 65536));
      for (let tries = 0; r.status === 409 && r.body.error.code === 'in_progress' && tries < 40; tries += 1) {
        await sleep(50);
        r = await chunk(from, Math.min(total, from + 65536));
      }
      assert.equal(r.status, 200, r.text);
    }
    const row = await ready(id);
    assert.equal(row?.state, 'ready', row?.processing_note ?? '');
    assert.equal(Number(bag.ctx.db.value("SELECT count(*) FROM upload WHERE file_name = 'lesson.docx'")), 1, 'one upload id');
    // The Word text became a Read lesson.
    const lesson = await admin.post('/admin/lessons', { source: 'upload', title: 'Farming', uploadIds: [id] }, admin.key());
    assert.equal(lesson.body.type, 'read');
    await admin.patch(`/admin/lessons/${lesson.body.id}`, { placement: { portalId: 'primary', groupId: 'primary-class-1', seriesId: 'primary-class-1-english-language', position: 1 } });
    await admin.post(`/admin/lessons/${lesson.body.id}/publish`);
    const blocks = (await new Client(bag).get(`/lessons/${lesson.body.id}`)).body.content.blocks;
    assert.deepEqual(blocks[0], { kind: 'heading', text: 'Farming' });
    assert.equal(blocks[1].kind, 'paragraph');
  });

  test('an animation package is checked and unpacked; one with an unsafe name is refused whole', async () => {
    const good = makeZip(join(bag.dir, 'anim.zip'), [['index.html', '<!doctype html><script src="app.js"></script>'], ['app.js', 'document.title = "hi"; // see https://example.com/docs'], ['img/dot.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>']]);
    const sent = await admin.post('/admin/uploads', good, { 'X-File-Name': 'anim.zip' });
    assert.equal(sent.body.becomes, 'try');
    assert.equal((await ready(sent.body.id))?.state, 'ready');
    const state = await admin.get(`/admin/uploads/${sent.body.id}`);
    assert.deepEqual(state.body.checks.map((c: { id: string; ok: boolean }) => [c.id, c.ok]), [['offline', true], ['index', true], ['size', true]]);
    const lesson = await admin.post('/admin/lessons', { source: 'animation', title: 'Try it', uploadIds: [sent.body.id] }, admin.key());
    const setup = await admin.get(`/admin/lessons/${lesson.body.id}/try-it`);
    assert.match(setup.body.packageUrl, /^\/media\/tryit\/tp-[a-z2-7]{26}\/index\.html$/);
    assert.equal((await fetch(new URL(bag.base).origin + setup.body.packageUrl)).status, 200);

    const noIndex = await admin.post('/admin/uploads', makeZip(join(bag.dir, 'bad.zip'), [['readme.txt', 'no index here']]), { 'X-File-Name': 'bad.zip' });
    const failed = await ready(noIndex.body.id);
    assert.equal(failed?.state, 'failed');
    assert.match(String(failed?.processing_note), /index\.html/);

    const before = readdirSync(bag.ctx.paths.tryit).length;
    const evil = await admin.post('/admin/uploads', makeZip(join(bag.dir, 'evil.zip'), [['index.html', 'x'], ['../../../evil.txt', 'x']]), { 'X-File-Name': 'evil.zip' });
    assert.equal((await ready(evil.body.id))?.state, 'failed');
    assert.equal(readdirSync(bag.ctx.paths.tryit).length, before, 'nothing was unpacked');
    assert.ok(!existsSync(join(bag.dir, 'evil.txt')) && !existsSync(join(bag.ctx.paths.data, 'evil.txt')));
  });

  test('a voice note is converted so every phone can play it (needs ffmpeg)', { skip: !hasFfmpeg }, async () => {
    const wav = join(bag.dir, 'note.wav');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', wav]);
    const sent = await admin.post('/admin/uploads', readFileSync(wav), { 'X-File-Name': 'note.wav' });
    assert.equal(sent.body.kind, 'audio');
    assert.equal((await ready(sent.body.id))?.state, 'ready');
    const info = await admin.get(`/admin/uploads/${sent.body.id}`);
    assert.equal(info.body.durationSeconds, 2);
    const lesson = await admin.post('/admin/lessons', { source: 'upload', title: 'Listen', uploadIds: [sent.body.id] }, admin.key());
    assert.equal(lesson.body.type, 'listen');
    assert.equal(lesson.body.length, 2);
    await admin.patch(`/admin/lessons/${lesson.body.id}`, { placement: { portalId: 'primary', groupId: 'primary-class-1', seriesId: 'primary-class-1-english-language', position: 1 } });
    assert.equal((await admin.post(`/admin/lessons/${lesson.body.id}/publish`)).status, 200);
    const source = (await new Client(bag).get(`/lessons/${lesson.body.id}`)).body.content.sources[0];
    assert.equal(source.mimeType, 'audio/mp4');
    assert.match(source.url, /^\/media\/d\/[0-9a-f]{2}\/[0-9a-f]{64}\.m4a$/, 'a derived, content-addressed file; the .wav itself is not kept');
  });

  test('learner-data export: password once, never stored; ticket download with Range; checks; contents obey the rules (EX-2…EX-5, EX-7)', async () => {
    const anon = new Client(bag, '10.10.0.45');
    const evil = (await anon.post('/learners', { name: '=HYPERLINK("x")', role: 'learner', pin: '1234' }, anon.key())).body.id as string;
    const named = (await anon.post('/learners', { name: 'Zainab Sesay', role: 'teacher', pin: '1234' }, anon.key())).body.id as string;
    await anon.put(`/learners/${named}/progress/primary-class-1-english-language-1`, { state: 'finished', correct: 2, total: 4 });
    await anon.put(`/learners/${evil}/progress/primary-class-1-english-language-2`, { state: 'started' });
    // Child protection counts of an earlier month (3 views: shown as "<5") and of this month (left out).
    bag.ctx.counts.tx(() => {
      bag.ctx.counts.run("INSERT INTO sensitive_activity_count VALUES ('cp-child-staying-safe-1', '2026-01-15', 3, 7)");
      bag.ctx.counts.run("INSERT INTO sensitive_activity_count VALUES ('cp-child-staying-safe-1', ?, 50, 50)", new Date().toISOString().slice(0, 10));
    });

    // Names: a fresh password entry, and a stick unless the warning was accepted.
    const needsAuth = await admin.post('/admin/exports', { kind: 'learner-data', destination: 'download', includeNames: true }, admin.key());
    assert.equal(needsAuth.body.error.code, 'reauth_required');
    await admin.confirm({ password: ADMIN.password });
    const needsUsb = await admin.post('/admin/exports', { kind: 'learner-data', destination: 'download', includeNames: true }, admin.key());
    assert.equal(needsUsb.status, 422);
    assert.equal(needsUsb.body.error.code, 'names_need_usb');
    assert.equal((await admin.post('/admin/exports', { kind: 'backup-full', destination: 'download' }, admin.key())).status, 422);
    assert.equal((await admin.post('/admin/exports', { kind: 'learner-data', destination: 'download', encrypted: false }, admin.key())).status, 422);

    const key = admin.key();
    const made = await admin.post('/admin/exports', { kind: 'learner-data', destination: 'download' }, key);
    assert.equal(made.status, 202, made.text);
    const password = made.body.password as string;
    assert.match(password, /^([a-z]+-)+\d{2}$/);
    const replay = await admin.post('/admin/exports', { kind: 'learner-data', destination: 'download' }, key);
    assert.equal(replay.body.id, made.body.id);
    assert.equal(replay.body.password, null);
    assert.equal(replay.body.passwordShown, true);

    const done = await waitFor(async () => {
      const r = await admin.get(`/admin/exports/${made.body.id}`);
      return r.body.state !== 'preparing' ? r.body : null;
    }, 30_000);
    assert.equal(done.state, 'ready', JSON.stringify(done));
    assert.match(done.fileName, /^sensebod-offline-learner-data_test-bag_\d{8}-\d{4}_[a-z2-7]{6}\.zip$/);
    assert.match(done.checkCode, /^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
    assert.ok(done.expiresAt);

    // V-004 / EX-5: the password is nowhere on the card, and the tmpfs file and the scratch folder are gone.
    assert.deepEqual(readdirSync(bag.ctx.paths.exportSecrets), []);
    assert.deepEqual(readdirSync(bag.ctx.paths.exportsTmp), []);
    for (const file of [bag.ctx.paths.mainDb, `${bag.ctx.paths.mainDb}-wal`, join(bag.ctx.paths.exports, done.fileName)]) {
      // Read with another process: opening a live SQLite file in this one would drop the locks of its own connection.
      assert.ok(!execFileSync('cat', [file], { maxBuffer: 256 * 1024 * 1024 }).includes(password), `the password must not be in ${file}`);
    }
    assert.ok(!JSON.stringify(bag.ctx.db.all('SELECT * FROM idempotency_record')).includes(password));

    // Download by ticket, without the cookie, in ranges.
    assert.equal((await new Client(bag).get(`/admin/exports/${made.body.id}/file`)).status, 401);
    const link = await admin.post(`/admin/exports/${made.body.id}/download-link`);
    assert.match(link.body.url, new RegExp(`^/api/v1/admin/exports/${made.body.id}/file\\?ticket=`));
    const origin = new URL(bag.base).origin;
    const first = await fetch(origin + link.body.url, { headers: { Range: 'bytes=0-99' } });
    assert.equal(first.status, 206);
    assert.equal(first.headers.get('content-range'), `bytes 0-99/${done.sizeBytes}`);
    assert.equal(first.headers.get('x-sensebod-offline-sha256'), done.sha256);
    assert.match(String(first.headers.get('content-disposition')), /attachment; filename="sensebod-offline-learner-data_/);
    const rest = await fetch(origin + link.body.url, { headers: { Range: `bytes=100-`, 'If-Range': String(first.headers.get('etag')) } });
    assert.equal(rest.status, 206);
    const whole = Buffer.concat([Buffer.from(await first.arrayBuffer()), Buffer.from(await rest.arrayBuffer())]);
    assert.equal(whole.length, done.sizeBytes);
    assert.equal(sha256Hex(whole), done.sha256);
    assert.equal((await fetch(origin + link.body.url.replace(/ticket=.{6}/, 'ticket=AAAAAA'))).status, 403);
    assert.equal((await fetch(origin + link.body.url.replace(made.body.id, 'ex-aaaaaaaaaaaaaaaaaaaaaaaaaa'))).status, 403, 'a ticket is for one export');

    // The two checks; a wrong hash is refused.
    assert.equal((await admin.post(`/admin/exports/${made.body.id}/checks`, { stage: 'saved', sha256: 'a'.repeat(64) })).status, 422);
    assert.ok((await admin.post(`/admin/exports/${made.body.id}/checks`, { stage: 'received', sha256: done.sha256 })).body.receivedCheckedAt);
    const saved = await admin.post(`/admin/exports/${made.body.id}/checks`, { stage: 'saved', sha256: done.sha256 });
    assert.ok(saved.body.savedCheckedAt);
    assert.equal(saved.body.downloadCount, 1, 'the request from byte 0 was one download');
    for (const action of ['export.create', 'export.ready', 'export.download_link', 'export.download', 'export.received_checked', 'export.saved_checked']) {
      assert.ok(bag.ctx.db.get('SELECT 1 FROM audit_event WHERE action = ? AND target_id = ?', action, made.body.id), action);
    }

    // Contents.
    assert.throws(() => readZip(whole, null), /encrypted/);
    const files = readZip(whole, password);
    assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'child_protection_counts.csv', 'learners.csv', 'manifest.json', 'progress.csv', 'summary_by_portal.csv']);
    const text = (name: string): string => (files[name] as Buffer).toString('utf8');
    const everything = Object.keys(files).map(text).join('\n');
    assert.ok(text('learners.csv').startsWith('\ufefflearner_code,role,first_seen_date,last_active_date\r\n'), 'BOM, header, CRLF');
    assert.ok(!everything.includes('Zainab') && !everything.includes('HYPERLINK'), 'names off: no name anywhere (EX-3)');
    assert.ok(!everything.includes(named) && !everything.includes(evil), 'no full learner id');
    assert.ok(text('learners.csv').includes(`L-${named.slice(3, 9).toUpperCase()},teacher,`));
    assert.match(text('progress.csv'), /,Primary school,Class 1,English Language,\d+,.*,watch,finished,2,4,\d{4}-\d{2}-\d{2}\r\n/);
    assert.ok(!text('progress.csv').includes('Child protection'), 'no row of a sensitive portal (EX-4)');
    assert.match(text('child_protection_counts.csv'), /2026-01,.*,1,My body belongs to me,<5,7\r\n/);
    assert.ok(!text('child_protection_counts.csv').includes(',50,'), 'the current, unfinished month is left out');
    const manifest = JSON.parse(text('manifest.json'));
    assert.equal(manifest.format, 'sensebod-offline-learner-data/1');
    for (const member of manifest.files) assert.equal(sha256Hex(files[member.name] as Buffer), member.sha256);

    // With names, over the Wi-Fi only after the warning was accepted; the choice is audited; the guard protects the cell.
    const withNames = await admin.post('/admin/exports', { kind: 'learner-data', destination: 'download', includeNames: true, namesOverWifi: true }, admin.key());
    assert.equal(withNames.status, 202, withNames.text);
    const namesDone = await waitFor(async () => {
      const r = await admin.get(`/admin/exports/${withNames.body.id}`);
      return r.body.state !== 'preparing' ? r.body : null;
    }, 30_000);
    const namesZip = readZip(readFileSync(join(bag.ctx.paths.exports, namesDone.fileName)), withNames.body.password);
    const learners = (namesZip['learners.csv'] as Buffer).toString('utf8');
    assert.ok(learners.includes('Zainab Sesay'));
    assert.ok(learners.includes('"\'=HYPERLINK(""x"")"'), 'EX-2');
    const audit = bag.ctx.db.get<{ detail_json: string }>("SELECT detail_json FROM audit_event WHERE action = 'export.create' AND target_id = ?", withNames.body.id);
    assert.equal(JSON.parse(audit?.detail_json ?? '{}').namesOverWifi, true);

    // "Delete from the bag" removes the file at once and keeps the row.
    assert.equal((await admin.delete(`/admin/exports/${withNames.body.id}`)).status, 204);
    assert.ok(!existsSync(join(bag.ctx.paths.exports, namesDone.fileName)));
    assert.equal((await admin.get(`/admin/exports/${withNames.body.id}`)).body.state, 'deleted');
    assert.equal((await admin.post(`/admin/exports/${withNames.body.id}/download-link`)).status, 410);
  });

  test('an encrypted export whose password file is gone fails; no zip is ever written without it (EX-6)', async () => {
    await stopWorker();
    const made = await admin.post('/admin/exports', { kind: 'learner-data', destination: 'download' }, admin.key());
    assert.equal(made.status, 202);
    const busy = await admin.post('/admin/exports', { kind: 'learner-data', destination: 'download' }, admin.key());
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error.code, 'export_in_progress');
    assert.deepEqual(readdirSync(bag.ctx.paths.exportSecrets), [made.body.id], 'the refused request left no password file behind (V-021)');
    rmSync(join(bag.ctx.paths.exportSecrets, made.body.id));
    const before = readdirSync(bag.ctx.paths.exports).filter((n) => n.endsWith('.zip')).length;
    startWorker();
    const done = await waitFor(async () => {
      const r = await admin.get(`/admin/exports/${made.body.id}`);
      return r.body.state !== 'preparing' ? r.body : null;
    }, 30_000);
    assert.equal(done.state, 'failed');
    assert.equal(done.errorCode, 'password_missing');
    assert.equal(readdirSync(bag.ctx.paths.exports).filter((n) => n.endsWith('.zip')).length, before);
  });

  test('"Export for EasySTEM": a records backup holds both databases and a manifest with epoch and sequence; diagnostics hold no personal data', async () => {
    const made = await admin.post('/admin/exports', { kind: 'backup-records', destination: 'download' }, admin.key());
    assert.equal(made.status, 202, made.text);
    assert.equal(made.body.password, undefined, 'backups have no password: only EasySTEM can open them');
    const done = await waitFor(async () => {
      const r = await admin.get(`/admin/exports/${made.body.id}`);
      return r.body.state !== 'preparing' ? r.body : null;
    }, 30_000);
    assert.equal(done.state, 'ready', JSON.stringify(done));
    assert.match(done.fileName, /\.sbk$/);
    // The stand-in for age passes the tar through, so its members can be listed here.
    const listing = execFileSync('tar', ['-tf', join(bag.ctx.paths.exports, done.fileName)], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(listing, ['BACKUP-MANIFEST.json', 'db/sensebod-offline.sqlite3', 'db/counts.sqlite3']);
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', join(bag.ctx.paths.exports, done.fileName), 'BACKUP-MANIFEST.json'], { encoding: 'utf8' }));
    assert.equal(manifest.format, 'sensebod-offline-backup/1');
    assert.equal(manifest.epoch, 1);
    assert.equal(manifest.bagId, bag.ctx.meta('bag_id'));
    assert.ok(manifest.epochNonce && manifest.changeSeq > 0);
    assert.ok(!JSON.stringify(manifest).includes('ticket') && !listing.some((n) => n.startsWith('keys')), 'bag secrets are not in a backup');
    // It counts as "exported" only once the saved file was checked.
    assert.ok((await admin.get('/admin/learner-data/summary')).body.unexportedLearners > 0);
    await admin.post(`/admin/exports/${made.body.id}/checks`, { stage: 'saved', sha256: done.sha256 });
    const summary = (await admin.get('/admin/learner-data/summary')).body;
    assert.equal(summary.unexportedLearners, 0);
    assert.equal(summary.lastExportKind, 'backup-records');

    const report = await admin.post('/admin/exports', { kind: 'diagnostics', destination: 'download' }, admin.key());
    const reportDone = await waitFor(async () => {
      const r = await admin.get(`/admin/exports/${report.body.id}`);
      return r.body.state !== 'preparing' ? r.body : null;
    }, 30_000);
    assert.equal(reportDone.state, 'ready', JSON.stringify(reportDone));
    const files = readZip(readFileSync(join(bag.ctx.paths.exports, reportDone.fileName)), null);
    assert.deepEqual(Object.keys(files).sort(), ['boots.csv', 'events.txt', 'exports.csv', 'health.csv', 'jobs.csv', 'status.json']);
    const all = Object.values(files).map((b) => b.toString('utf8')).join('\n');
    assert.ok(!/lr-[a-z2-7]{26}/.test(all) && !all.includes('Zainab') && !all.includes('10.10.0.') && !all.includes('cp-child-staying-safe'));
  });

  test('worker restart: a running export becomes interrupted/worker_restart, its scratch and password are removed, a new one can start (PL-6)', async () => {
    await stopWorker();
    const made = await admin.post('/admin/exports', { kind: 'learner-data', destination: 'download' }, admin.key());
    // As if the worker had been killed in the middle of the job.
    bag.ctx.writeSync((tx) => tx.run("UPDATE job SET state = 'running', attempts = 1 WHERE id = (SELECT job_id FROM export WHERE id = ?)", made.body.id));
    mkdirSync(join(bag.ctx.paths.exportsTmp, made.body.id), { recursive: true });
    writeFileSync(join(bag.ctx.paths.exportsTmp, made.body.id, 'snapshot.sqlite3'), 'half');
    startWorker();
    const state = (await admin.get(`/admin/exports/${made.body.id}`)).body;
    assert.equal(state.state, 'interrupted');
    assert.equal(state.errorCode, 'worker_restart');
    assert.ok(!existsSync(join(bag.ctx.paths.exportsTmp, made.body.id)));
    assert.ok(!existsSync(join(bag.ctx.paths.exportSecrets, made.body.id)));
    const next = await admin.post('/admin/exports', { kind: 'diagnostics', destination: 'download' }, admin.key());
    assert.equal(next.status, 202);
    await waitFor(async () => (await admin.get(`/admin/exports/${next.body.id}`)).body.state === 'ready', 30_000);
  });

  test('after an unclean boot: sessions end, ready exports are re-checked before anyone may download, damaged ones are dropped, uploads resume (PL-3, DL-6)', async () => {
    await stopWorker();
    // This process stands for the API of the boot BEFORE the power cut: give that boot its own id.
    const realBootId = bag.ctx.boot.bootId;
    bag.ctx.boot.bootId = 'the-boot-before';
    bag.ctx.writeSync((tx) => tx.run("UPDATE boot SET boot_id = 'the-boot-before' WHERE boot_id = ?", realBootId));
    admin = await signedIn(bag, ADMIN, '10.10.0.40');
    const exportsReady = bag.ctx.db.all<{ id: string; file_name: string }>("SELECT id, file_name FROM export WHERE state = 'ready' ORDER BY created_at");
    assert.ok(exportsReady.length >= 2);
    const [good, bad] = [exportsReady[0] as { id: string; file_name: string }, exportsReady[1] as { id: string; file_name: string }];
    // Same size, different bytes: only a re-hash can tell.
    const damaged = readFileSync(join(bag.ctx.paths.exports, bad.file_name));
    damaged[damaged.length - 5] = (damaged[damaged.length - 5] as number) ^ 0xff;
    writeFileSync(join(bag.ctx.paths.exports, bad.file_name), damaged);
    writeFileSync(join(bag.ctx.paths.exports, 'stray-file.zip'), 'no row');
    const link = (await admin.post(`/admin/exports/${good.id}/download-link`)).body.url as string;
    // A resumable upload half way, with unconfirmed bytes after the last confirmed chunk.
    const started = await admin.post('/admin/uploads/resumable', { fileName: 'big.png', sizeBytes: 200000, mimeType: 'image/png' }, admin.key());
    const bytes = Buffer.concat([PNG, Buffer.alloc(200000 - PNG.length, 1)]);
    await admin.put(`/admin/uploads/${started.body.id}/bytes`, bytes.subarray(0, 65536), { 'Content-Range': 'bytes 0-65535/200000' });
    const part = join(bag.ctx.paths.uploadsPartial, `${started.body.id}.part`);
    writeFileSync(part, Buffer.concat([readFileSync(part), Buffer.alloc(5000, 9)]));
    bag.ctx.writeSync((tx) => tx.run("UPDATE job SET state = 'queued' WHERE id IN (SELECT id FROM job WHERE lane = 'data' LIMIT 1)"));

    // "Power cut": a new boot id, no clean-shutdown marker.
    const boot = JSON.parse(readFileSync(bag.ctx.paths.bootJson, 'utf8'));
    writeFileSync(bag.ctx.paths.bootJson, JSON.stringify({ ...boot, bootId: 'the-boot-before' }));
    const result = bootRecover(bag.config);
    assert.equal(result.boot.previousClean, false);
    assert.equal(result.boot.bootSeq, boot.bootSeq + 1, 'boot_seq is monotonic');
    const db = bag.ctx.db;
    assert.equal(Number(db.value('SELECT count(*) FROM admin_session')), 0, 'every session ended (V-012)');
    assert.equal(Number(db.value("SELECT count(*) FROM job WHERE lane IN ('data','usb') AND state IN ('queued','running')")), 0, 'queued data jobs lost their password with tmpfs');
    assert.equal(db.value('SELECT state FROM export WHERE id = ?', good.id), 'checking');
    assert.ok(!existsSync(join(bag.ctx.paths.exports, 'stray-file.zip')), 'a file without a row is never served');
    assert.equal(statSync(part).size, 65536, 'the .part file is cut back to what the database confirmed');
    assert.ok(db.get('SELECT 1 FROM boot WHERE boot_id = ? AND previous_clean = 0', result.boot.bootId));

    // The API of the new boot (same process here, so the old boot id is still in memory): tickets of the earlier boot are refused.
    const origin = new URL(bag.base).origin;
    bag.ctx.boot.bootId = result.boot.bootId;
    assert.equal((await fetch(origin + link)).status, 403);
    assert.equal((await admin.get('/admin/exports')).status, 401);
    admin = await signedIn(bag, ADMIN, '10.10.0.40');
    const checking = await admin.post(`/admin/exports/${good.id}/download-link`);
    assert.equal(checking.status, 409);
    assert.equal(checking.body.error.code, 'checking');

    // Maintenance (1 minute after boot on a bag) re-hashes them.
    const maintCtx = new Ctx({ config: bag.config, role: 'batch', version: VERSION, boot: result.boot, keys: loadKeys(buildPaths(bag.config)) });
    const report = await runMaintenance(maintCtx);
    maintCtx.close();
    assert.ok(Object.values(report).every((value) => value !== 'failed'), JSON.stringify(report));
    assert.equal(db.value('SELECT state FROM export WHERE id = ?', good.id), 'ready');
    assert.equal(db.value('SELECT state FROM export WHERE id = ?', bad.id), 'interrupted');
    assert.equal(db.value('SELECT error_code FROM export WHERE id = ?', bad.id), 'file_lost');
    assert.ok(!existsSync(join(bag.ctx.paths.exports, bad.file_name)));
    assert.equal((await admin.post(`/admin/exports/${good.id}/download-link`)).status, 200);
    assert.equal(listSnapshots(bag.ctx.paths).filter((s) => s.kind === 'auto' && s.countsPath !== null).length, 1, 'a snapshot pair was taken after the unclean boot');

    // The phone asks where to continue and finishes the same upload.
    bag.ctx.boot.bootSeq = result.boot.bootSeq;
    startWorker();
    assert.equal((await admin.get(`/admin/uploads/${started.body.id}`)).body.receivedBytes, 65536);
    for (let from = 65536; from < 200000; from += 65536) {
      const to = Math.min(200000, from + 65536);
      assert.equal((await admin.put(`/admin/uploads/${started.body.id}/bytes`, bytes.subarray(from, to), { 'Content-Range': `bytes ${from}-${to - 1}/200000` })).status, 200);
    }
    assert.equal((await ready(started.body.id))?.blob_sha256, sha256Hex(bytes));
  });

  test('maintenance: old exports expire by uptime even when the clock went backwards; orphan secrets and old rows go', async () => {
    const ctx = workerCtx;
    const made = await (async () => {
      admin = await signedIn(bag, ADMIN, '10.10.0.47');
      const r = await admin.post('/admin/exports', { kind: 'diagnostics', destination: 'download' }, admin.key());
      return waitFor(async () => {
        const s = await admin.get(`/admin/exports/${r.body.id}`);
        return s.body.state === 'ready' ? s.body : null;
      }, 30_000);
    })();
    // Ready "8 days of uptime ago" in this boot, with a wall-clock expiry far in the future (a clock set back).
    ctx.writeSync((tx) => tx.run("UPDATE export SET ready_uptime_s = ready_uptime_s - ?, expires_at = '2099-01-01T00:00:00.000Z' WHERE id = ?", 8 * 86400, made.id));
    writeFileSync(join(ctx.paths.exportSecrets, 'ex-orphanorphanorphanorphanor'), 'left-by-a-crash');
    utimesSync(join(ctx.paths.exportSecrets, 'ex-orphanorphanorphanorphanor'), new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
    ctx.writeSync((tx) => tx.run("INSERT INTO idempotency_record (scope, key, method, path, request_sha256, state, created_at) VALUES ('anon', 'old-key-1', 'POST', '/x', 'h', 'done', '2020-01-01T00:00:00.000Z')"));
    const report = await runMaintenance(ctx);
    assert.ok(Object.values(report).every((value) => value !== 'failed'), JSON.stringify(report));
    assert.equal(ctx.db.value('SELECT state FROM export WHERE id = ?', made.id), 'expired');
    assert.ok(!existsSync(join(ctx.paths.exports, made.fileName)));
    assert.deepEqual(readdirSync(ctx.paths.exportSecrets), []);
    assert.equal(ctx.db.get("SELECT 1 FROM idempotency_record WHERE key = 'old-key-1'"), undefined);
    assert.ok(ctx.db.get('SELECT 1 FROM health_sample'));
  });

  test('a learner-data file never survives two boots; a corrupt database goes back to the newest sound snapshot with a new epoch (DB-5)', async () => {
    await stopWorker();
    const db = bag.ctx.db;
    const made = db.get<{ id: string; file_name: string }>("SELECT id, file_name FROM export WHERE kind = 'learner-data' AND state = 'ready' LIMIT 1");
    const learnersInSnapshot = Number(db.value('SELECT count(*) FROM learner'));
    const anon = new Client(bag, '10.10.0.46');
    await anon.post('/learners', { name: 'After the snapshot', role: 'learner', pin: '1234' }, anon.key());
    const epoch = bag.ctx.metaInt('epoch');
    const nextBoot = (id: string): ReturnType<typeof bootRecover> => {
      writeFileSync(bag.ctx.paths.bootJson, JSON.stringify({ ...JSON.parse(readFileSync(bag.ctx.paths.bootJson, 'utf8')), bootId: id }));
      return bootRecover(bag.config);
    };
    nextBoot('boot-minus-2');
    nextBoot('boot-minus-1');
    if (made) {
      assert.equal(db.value('SELECT state FROM export WHERE id = ?', made.id), 'expired');
      assert.ok(!existsSync(join(bag.ctx.paths.exports, made.file_name)));
    }
    // Damage the live file badly enough that SQLite refuses it.
    bag.ctx.close();
    const file = bag.ctx.paths.mainDb;
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
    const bytes = readFileSync(file);
    bytes.fill(0x5a, 0, 4096 * 3);
    writeFileSync(file, bytes);
    const recovered = nextBoot('boot-with-damage');
    assert.equal(recovered.maintenance, false);
    assert.match(recovered.notes.join(' '), /went back to its saved copy/);
    assert.ok(readdirSync(bag.ctx.paths.dbDir).some((name) => name.startsWith('corrupt-')), 'the damaged file is kept aside for salvage');
    const again = new Ctx({ config: bag.config, role: 'batch', version: VERSION, boot: recovered.boot, keys: loadKeys(buildPaths(bag.config)) });
    assert.equal(again.metaInt('epoch'), epoch + 1);
    assert.ok(again.metaInt('change_seq') >= (epoch + 1) * 2 ** 40);
    assert.equal(Number(again.db.value('SELECT count(*) FROM learner')), learnersInSnapshot, 'changes after the snapshot were lost, and only those');
    assert.ok(again.meta('restored_from'));
    again.close();
    // The harness closes its own context in `after`; give it a live one again.
    (bag as { ctx: Ctx }).ctx = new Ctx({ config: bag.config, role: 'api', version: VERSION, boot: recovered.boot, keys: loadKeys(buildPaths(bag.config)) });
    startWorker();
  });

  test('a database that cannot be opened for another reason is NOT rolled back', async () => {
    const other = await makeBag({ listen: false, role: 'batch' });
    try {
      const file = other.ctx.paths.mainDb;
      const learners = () => {
        other.ctx.writeSync((tx) => tx.run("INSERT INTO learner (id, name, role, created_at, seq) VALUES (?, 'Kept', 'learner', 'x', ?)", `lr-${'k'.repeat(26)}`, tx.seq()));
      };
      learners();
      other.ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      other.ctx.close();
      writeFileSync(other.ctx.paths.bootJson, JSON.stringify({ bootId: 'earlier' }));
      chmodSync(file, 0o000);
      try {
        assert.throws(() => bootRecover(other.config), /EACCES|permission/i);
      } finally {
        chmodSync(file, 0o600);
      }
      assert.ok(!readdirSync(other.ctx.paths.dbDir).some((name) => name.startsWith('corrupt-')));
      const result = bootRecover(other.config);
      assert.equal(result.maintenance, false);
      (other as { ctx: Ctx }).ctx = new Ctx({ config: other.config, role: 'batch', version: VERSION, boot: result.boot, keys: loadKeys(buildPaths(other.config)) });
      assert.equal(Number(other.ctx.db.value("SELECT count(*) FROM learner WHERE name = 'Kept'")), 1);
      assert.equal(other.ctx.metaInt('epoch'), 1);
    } finally {
      await other.close();
    }
  });

});
