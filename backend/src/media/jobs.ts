/*
 * Media lane jobs (SYSTEM-ARCHITECTURE §5.4): inspect, smaller_copy,
 * voice_convert, pdf_pages, docx_text, package_check. One at a time, at low
 * priority, output to the job's scratch folder and moved into the store only
 * when complete, so every one of them can simply be run again.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Ctx, Tx } from '../core/context.ts';
import { Db } from '../core/db.ts';
import { fsyncDir } from '../core/fsx.ts';
import { newId } from '../core/ids.ts';
import { nowIso } from '../core/time.ts';
import { enqueueJob, payloadOf, type JobRow } from '../worker/queue.ts';
import { JobFailure, type AfterCommit, type Handler, type JobEnv } from '../worker/types.ts';
import { lessonsUsingUpload, rebuildLessonMedia, type UploadRow } from './attach.ts';
import { existingBlob, hashFile, headOf, insertBlob, storeFile, type StoredBlob } from './store.ts';
import { classify, followUps, sniffMatches, type FileClass } from './types.ts';
import { ZipError, extractZip, listZip, readEntry } from './zip.ts';

interface UploadPayload {
  uploadId: string;
  result?: Record<string, unknown>;
}

function partOf(env: JobEnv, uploadId: string): string {
  return join(env.paths.uploadsPartial, `${uploadId}.part`);
}

/** Read the upload row and where its bytes are now: still the .part file, or already in the store. */
function loadUpload(env: JobEnv): { upload: UploadRow; file: FileClass; input: string } {
  const uploadId = String(env.job.payload.uploadId ?? '');
  const db = new Db(env.paths.mainDb, { role: 'batch', readOnly: true });
  let upload: UploadRow | undefined;
  let blobPath: string | null = null;
  try {
    upload = db.get<UploadRow>('SELECT * FROM upload WHERE id = ?', uploadId);
    if (upload?.blob_sha256) {
      const rel = db.value<string>('SELECT rel_path FROM blob WHERE sha256 = ?', upload.blob_sha256);
      if (rel) blobPath = join(env.paths.media, rel);
    }
  } finally {
    db.close();
  }
  if (!upload || upload.state === 'abandoned') throw new JobFailure('gone', 'The upload was removed.');
  const file = classify(upload.file_name);
  if (!file) throw new JobFailure('unsupported', 'This kind of file cannot be added.');
  const part = partOf(env, uploadId);
  const input = existsSync(part) ? part : blobPath && existsSync(blobPath) ? blobPath : null;
  if (!input) throw new JobFailure('file_lost', 'The uploaded file is no longer on the bag. Upload it again.');
  return { upload, file, input };
}

interface ToolResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run an external tool without a shell, at the lowest CPU and I/O priority.
 * `onLine` sees its standard output line by line (ffmpeg -progress).
 */
function runTool(command: string, args: string[], options: { timeoutMs: number; onLine?: (line: string) => void }): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const useIonice = process.platform === 'linux' && existsSync('/usr/bin/ionice');
    const child = useIonice ? spawn('/usr/bin/ionice', ['-c3', 'nice', '-n', '19', command, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }) : spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stdout.length < 200_000) stdout += text;
      if (options.onLine) {
        pending += text;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) options.onLine(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      // Keep the tail only: tools can be very talkative.
      stderr = (stderr + chunk.toString('utf8')).slice(-4000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject((error as { code?: string }).code === 'ENOENT' ? new JobFailure('tool_missing', `${command} is not installed on this bag.`) : error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function probeDuration(env: JobEnv, input: string): Promise<number | null> {
  try {
    const out = await runTool(env.config.tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input], { timeoutMs: 60_000 });
    const seconds = Number(out.stdout.trim());
    return out.code === 0 && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
  } catch {
    // No ffprobe (a laptop): the length stays "not known", never invented.
    return null;
  }
}

async function probePages(env: JobEnv, input: string): Promise<number | null> {
  try {
    const out = await runTool(env.config.tools.pdfinfo, [input], { timeoutMs: 60_000 });
    const match = /^Pages:\s+(\d+)/m.exec(out.stdout);
    return out.code === 0 && match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* shared supervisor-side helpers                                      */
/* ------------------------------------------------------------------ */

function record(tx: Tx, blob: StoredBlob): string {
  // The same bytes may already be in the store under another path; the row that exists wins.
  if (!existingBlob(tx, blob.sha256)) insertBlob(tx, blob);
  else tx.run('UPDATE blob SET unreferenced_since = NULL WHERE sha256 = ?', blob.sha256);
  return blob.sha256;
}

function setResult(tx: Tx, job: JobRow, result: Record<string, unknown>): void {
  const payload = payloadOf<UploadPayload>(job);
  payload.result = result;
  tx.run('UPDATE job SET payload_json = ? WHERE id = ?', JSON.stringify(payload), job.id);
}

/** When no other job is waiting or running for the upload, it is ready; then its lessons pick the files up. */
function settle(ctx: Ctx, tx: Tx, job: JobRow, uploadId: string): AfterCommit {
  const pending = Number(tx.value("SELECT count(*) FROM job WHERE lane = 'media' AND state IN ('queued','running') AND id <> ? AND json_extract(payload_json, '$.uploadId') = ?", job.id, uploadId) ?? 0);
  if (pending === 0) tx.run("UPDATE upload SET state = 'ready', processing_note = NULL, updated_at = ? WHERE id = ? AND state = 'processing'", nowIso(), uploadId);
  for (const lessonId of lessonsUsingUpload(tx, uploadId)) rebuildLessonMedia(tx, lessonId);
  if (pending > 0) return undefined;
  // Nothing needs the raw upload any more.
  return () => rmSync(join(ctx.paths.uploadsPartial, `${uploadId}.part`), { force: true });
}

const NOTES: Record<string, string> = {
  tool_missing: 'This bag cannot convert this kind of file yet. Ask EasySTEM.',
  file_lost: 'The file is no longer on the bag. Upload it again.',
  not_a_package: 'This .zip is not an animation package. It needs an index.html at the top.',
  unsafe_package: 'This .zip cannot be opened safely. Ask EasySTEM for a new package.',
  bad_file: 'The bag could not read this file. Check it and upload it again.',
  stalled: 'Getting the file ready took too long. Try again.',
};

/** What a failed job means for its upload. A failed optional smaller copy leaves a usable upload. */
function uploadFailed(optional: (file: FileClass | null) => boolean) {
  return (ctx: Ctx, tx: Tx, job: JobRow, _state: 'failed' | 'interrupted', code: string, final: boolean): AfterCommit => {
    if (!final) return undefined;
    const uploadId = payloadOf<UploadPayload>(job).uploadId;
    const upload = tx.get<UploadRow>('SELECT * FROM upload WHERE id = ?', uploadId);
    if (!upload || upload.state !== 'processing') return undefined;
    if (optional(classify(upload.file_name))) {
      tx.run('UPDATE upload SET processing_note = ?, updated_at = ? WHERE id = ?', 'The smaller copy could not be made. The original is used.', nowIso(), uploadId);
      return settle(ctx, tx, job, uploadId);
    }
    tx.run("UPDATE upload SET state = 'failed', processing_note = ?, updated_at = ? WHERE id = ?", NOTES[code] ?? 'The bag could not get this file ready. Try again.', nowIso(), uploadId);
    tx.run("UPDATE job SET state = 'cancelled', finished_at = ? WHERE lane = 'media' AND state = 'queued' AND json_extract(payload_json, '$.uploadId') = ?", nowIso(), uploadId);
    for (const lessonId of lessonsUsingUpload(tx, uploadId)) rebuildLessonMedia(tx, lessonId);
    return () => rmSync(join(ctx.paths.uploadsPartial, `${uploadId}.part`), { force: true });
  };
}

const required = uploadFailed(() => false);

/* ------------------------------------------------------------------ */
/* inspect                                                             */
/* ------------------------------------------------------------------ */

interface InspectResult {
  sha256: string;
  blob: StoredBlob | null;
  durationSeconds: number | null;
  pages: number | null;
  next: string[];
}

export const inspect: Handler = {
  lane: 'media',
  async run(env): Promise<InspectResult> {
    const { upload, file, input } = loadUpload(env);
    if (!sniffMatches(file.family, await headOf(input))) throw new JobFailure('bad_file', 'The file is not what its name says.');
    env.progress(5);
    const { sha256, sizeBytes } = await hashFile(input);
    if (sizeBytes !== upload.size_bytes && input.endsWith('.part')) throw new JobFailure('file_lost', 'The uploaded file is not complete.');
    env.progress(60);
    const durationSeconds = file.kind === 'video' || file.kind === 'audio' || file.kind === 'voice-note' ? await probeDuration(env, input) : null;
    const pages = file.kind === 'pdf' ? await probePages(env, input) : file.kind === 'photo' ? 1 : null;
    env.progress(80);
    const next = followUps(file, upload.smaller_copy === 1);
    let blob: StoredBlob | null = null;
    if (file.blobExt !== null) {
      // The .part file is NOT moved: until the row is committed it is the only thing a retry can find (a power
      // cut or a failed commit here must not lose a 2 GiB upload). It is removed after the commit.
      blob = await storeFile(env.paths, input, sha256, sizeBytes, file.blobExt, 'upload', input.endsWith('.part') ? 'link' : false);
    }
    return { sha256, blob, durationSeconds, pages, next };
  },
  finalize(ctx, tx, job, raw) {
    const result = raw as InspectResult;
    const uploadId = payloadOf<UploadPayload>(job).uploadId;
    const upload = tx.get<UploadRow>('SELECT * FROM upload WHERE id = ?', uploadId);
    if (!upload || upload.state !== 'processing') return undefined;
    const sha = result.blob ? record(tx, result.blob) : null;
    tx.run(
      'UPDATE upload SET blob_sha256 = ?, duration_seconds = ?, pages = coalesce(?, pages), updated_at = ? WHERE id = ?',
      sha,
      result.durationSeconds,
      result.pages,
      nowIso(),
      uploadId,
    );
    for (const kind of result.next) enqueueJob(tx, kind, 'media', { uploadId });
    setResult(tx, job, {});
    return settle(ctx, tx, job, uploadId);
  },
  failed: required,
};

/* ------------------------------------------------------------------ */
/* ffmpeg conversions                                                  */
/* ------------------------------------------------------------------ */

async function ffmpeg(env: JobEnv, input: string, output: string, args: string[], durationSeconds: number | null): Promise<void> {
  const out = await runTool(env.config.tools.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input, ...args, '-progress', 'pipe:1', output], {
    // The supervisor's stall timeout is the real limit; this only bounds a tool that never ends.
    timeoutMs: 2 * 60 * 60_000,
    onLine(line) {
      const match = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (match && durationSeconds) env.progress(Math.min(95, Math.round((Number(match[1]) / 1_000_000 / durationSeconds) * 95)));
      else if (match) env.progress(50);
    },
  });
  if (out.code !== 0 || !existsSync(output) || statSync(output).size === 0) throw new JobFailure('bad_file', 'The file could not be converted.');
}

async function storeDerived(env: JobEnv, file: string, ext: string): Promise<StoredBlob> {
  const { sha256, sizeBytes } = await hashFile(file);
  return storeFile(env.paths, file, sha256, sizeBytes, ext, 'derived', true);
}

/** Smaller copy for old phones: H.264 Baseline, AAC, at most 480 lines, about 600 kbit/s (to be tuned on real phones). */
export const smallerCopy: Handler = {
  lane: 'media',
  async run(env): Promise<{ blob: StoredBlob }> {
    const { upload, input } = loadUpload(env);
    const output = join(env.workDir, 'smaller.mp4');
    await ffmpeg(
      env,
      input,
      output,
      ['-vf', "scale=-2:'min(480,ih)'", '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-pix_fmt', 'yuv420p', '-b:v', '600k', '-maxrate', '700k', '-bufsize', '1400k', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', '-threads', '2'],
      upload.duration_seconds,
    );
    return { blob: await storeDerived(env, output, 'mp4') };
  },
  finalize(ctx, tx, job, raw) {
    const { blob } = raw as { blob: StoredBlob };
    setResult(tx, job, { smaller: record(tx, blob) });
    return settle(ctx, tx, job, payloadOf<UploadPayload>(job).uploadId);
  },
  // A smaller copy is optional when the original itself can be stored and played.
  failed: uploadFailed((file) => file !== null && file.blobExt !== null),
};

/** Voice notes and other sound → AAC in .m4a, which every target phone plays. */
export const voiceConvert: Handler = {
  lane: 'media',
  async run(env): Promise<{ blob: StoredBlob }> {
    const { upload, input } = loadUpload(env);
    const output = join(env.workDir, 'voice.m4a');
    await ffmpeg(env, input, output, ['-vn', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart'], upload.duration_seconds);
    return { blob: await storeDerived(env, output, 'm4a') };
  },
  finalize(ctx, tx, job, raw) {
    const { blob } = raw as { blob: StoredBlob };
    setResult(tx, job, { audio: record(tx, blob) });
    return settle(ctx, tx, job, payloadOf<UploadPayload>(job).uploadId);
  },
  failed: required,
};

/* ------------------------------------------------------------------ */
/* PDF pages                                                           */
/* ------------------------------------------------------------------ */

const MAX_PDF_PAGES = 300;

export const pdfPages: Handler = {
  lane: 'media',
  async run(env): Promise<{ blobs: StoredBlob[] }> {
    const { input } = loadUpload(env);
    const prefix = join(env.workDir, 'page');
    // JPEG pages at most 1080 px wide: light enough for old phones, sharp enough to read.
    const out = await runTool(env.config.tools.pdftoppm, ['-jpeg', '-jpegopt', 'quality=80', '-scale-to-x', '1080', '-scale-to-y', '-1', '-l', String(MAX_PDF_PAGES), input, prefix], { timeoutMs: 10 * 60_000 });
    const pages = readdirSync(env.workDir)
      .filter((name) => /^page-\d+\.jpg$/.test(name))
      .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
    if (out.code !== 0 || pages.length === 0) throw new JobFailure('bad_file', 'The pages of this PDF could not be read.');
    const blobs: StoredBlob[] = [];
    for (const [index, name] of pages.entries()) {
      blobs.push(await storeDerived(env, join(env.workDir, name), 'jpg'));
      env.progress(Math.round(((index + 1) / pages.length) * 95));
    }
    return { blobs };
  },
  finalize(ctx, tx, job, raw) {
    const { blobs } = raw as { blobs: StoredBlob[] };
    const uploadId = payloadOf<UploadPayload>(job).uploadId;
    setResult(tx, job, { pages: blobs.map((blob) => record(tx, blob)) });
    tx.run('UPDATE upload SET pages = ?, updated_at = ? WHERE id = ?', blobs.length, nowIso(), uploadId);
    return settle(ctx, tx, job, uploadId);
  },
  failed: required,
};

/* ------------------------------------------------------------------ */
/* .docx → Read text blocks                                            */
/* ------------------------------------------------------------------ */

function xmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/** WordprocessingML paragraphs → heading / paragraph / list blocks. No office suite is involved. */
export function docxBlocks(documentXml: string): unknown[] {
  const blocks: unknown[] = [];
  let list: { kind: 'list'; ordered: boolean; items: string[] } | null = null;
  const paragraphs = documentXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  for (const paragraph of paragraphs.slice(0, 5000)) {
    const text = xmlText(
      (paragraph.match(/<w:t[ >][\s\S]*?<\/w:t>|<w:t\/>|<w:tab\/>|<w:br\/>|<w:cr\/>/g) ?? [])
        .map((piece) => (piece.startsWith('<w:tab') ? ' ' : piece.startsWith('<w:br') || piece.startsWith('<w:cr') ? '\n' : piece.replace(/<[^>]+>/g, '')))
        .join(''),
    )
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!text) continue;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(paragraph)?.[1] ?? '';
    if (/<w:numPr>/.test(paragraph) || /^List/i.test(style)) {
      if (!list) {
        list = { kind: 'list', ordered: /Number/i.test(style), items: [] };
        blocks.push(list);
      }
      if (list.items.length < 100) list.items.push(text.slice(0, 1000));
      continue;
    }
    list = null;
    if (/^(Heading|Title)/i.test(style)) blocks.push({ kind: 'heading', text: text.slice(0, 300) });
    else blocks.push({ kind: 'paragraph', text: text.slice(0, 5000) });
    if (blocks.length >= 500) break;
  }
  return blocks;
}

export const docxText: Handler = {
  lane: 'media',
  async run(env): Promise<{ blocks: unknown[] }> {
    const { input } = loadUpload(env);
    try {
      const entry = listZip(input).find((e) => e.name === 'word/document.xml');
      if (!entry) throw new JobFailure('bad_file', 'This is not a Word (.docx) file.');
      const blocks = docxBlocks((await readEntry(input, entry, 20 * 1024 * 1024)).toString('utf8'));
      if (blocks.length === 0) throw new JobFailure('bad_file', 'No text was found in this Word file.');
      return { blocks };
    } catch (error) {
      if (error instanceof ZipError) throw new JobFailure('bad_file', error.message);
      throw error;
    }
  },
  finalize(ctx, tx, job, raw) {
    setResult(tx, job, { blocks: (raw as { blocks: unknown[] }).blocks });
    return settle(ctx, tx, job, payloadOf<UploadPayload>(job).uploadId);
  },
  failed: required,
};

/* ------------------------------------------------------------------ */
/* animation package                                                   */
/* ------------------------------------------------------------------ */

interface PackageResult {
  ok: boolean;
  packageId: string | null;
  zipSha256: string;
  totalBytes: number;
  checks: { id: string; ok: boolean; title: string; detail: string }[];
}

/** Does the text refer to the internet? Comments are ignored; XML namespaces are not addresses anyone loads. */
export function refersToInternet(text: string): boolean {
  const stripped = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1');
  const urls = stripped.match(/https?:\/\/[A-Za-z0-9.-]+/g) ?? [];
  return urls.some((url) => !/^https?:\/\/(www\.w3\.org|purl\.org|ns\.adobe\.com|creativecommons\.org|schemas\.[a-z.]+)$/i.test(url));
}

export const packageCheck: Handler = {
  lane: 'media',
  async run(env): Promise<PackageResult> {
    const { input } = loadUpload(env);
    const { sha256 } = await hashFile(input);
    let entries;
    try {
      entries = listZip(input);
    } catch (error) {
      if (error instanceof ZipError) throw new JobFailure('unsafe_package', error.message);
      throw error;
    }
    const total = entries.reduce((sum, e) => sum + e.size, 0);
    const mb = Math.max(1, Math.round(total / (1024 * 1024)));
    const hasIndex = entries.some((e) => e.name === 'index.html');
    const checks: PackageResult['checks'] = [
      { id: 'index', ok: hasIndex, title: 'Starts with index.html', detail: hasIndex ? 'Found at the top of the .zip.' : 'There is no index.html at the top of the .zip.' },
      { id: 'size', ok: mb <= 50, title: `Size: ${mb} MB`, detail: mb <= 50 ? 'Fine for old phones.' : 'Large for old phones. Ask EasySTEM for a smaller version.' },
    ];
    if (!hasIndex) return { ok: false, packageId: null, zipSha256: sha256, totalBytes: total, checks };
    const packageId = newId('tp');
    const staging = join(env.workDir, 'unpacked');
    mkdirSync(staging, { recursive: true });
    try {
      await extractZip(input, entries, staging, { maxTotalBytes: env.config.limits.packageMaxBytes });
    } catch (error) {
      if (error instanceof ZipError) throw new JobFailure('unsafe_package', error.message);
      throw error;
    }
    env.progress(70);
    // "Opens without internet": no http(s) addresses in its pages, styles and scripts. A heuristic, reported, not blocking.
    let online = false;
    for (const entry of entries) {
      if (entry.directory || !/\.(html?|css|js|mjs|svg|json)$/i.test(entry.name) || entry.size > 5 * 1024 * 1024) continue;
      if (refersToInternet(readFileSync(join(staging, entry.name), 'utf8'))) {
        online = true;
        break;
      }
    }
    checks.unshift({
      id: 'offline',
      ok: !online,
      title: online ? 'May need the internet' : 'Opens without internet',
      detail: online ? 'It mentions an internet address. Parts of it may not work on the bag. Ask EasySTEM to check.' : 'Everything it needs is inside the file.',
    });
    // Packages run in a sandboxed frame that cannot fetch their own files at run time (B-05): said plainly.
    mkdirSync(env.paths.tryit, { recursive: true });
    const dest = join(env.paths.tryit, packageId);
    const flush = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) flush(full);
        else {
          const fd = openSync(full, 'r');
          try {
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        }
      }
      fsyncDir(dir);
    };
    flush(staging);
    renameSync(staging, dest);
    fsyncDir(env.paths.tryit);
    return { ok: true, packageId, zipSha256: sha256, totalBytes: total, checks };
  },
  finalize(ctx, tx, job, raw) {
    const result = raw as PackageResult;
    const uploadId = payloadOf<UploadPayload>(job).uploadId;
    tx.run('UPDATE upload SET checks_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(result.checks), nowIso(), uploadId);
    if (!result.ok || !result.packageId) {
      tx.run("UPDATE upload SET state = 'failed', processing_note = ?, updated_at = ? WHERE id = ?", NOTES.not_a_package as string, nowIso(), uploadId);
      for (const lessonId of lessonsUsingUpload(tx, uploadId)) rebuildLessonMedia(tx, lessonId);
      return () => rmSync(join(ctx.paths.uploadsPartial, `${uploadId}.part`), { force: true });
    }
    tx.run(
      "INSERT INTO tryit_package (id, zip_sha256, dir_name, index_path, total_bytes, checks_json, created_at) VALUES (?, ?, ?, 'index.html', ?, ?, ?)",
      result.packageId,
      result.zipSha256,
      result.packageId,
      result.totalBytes,
      JSON.stringify(result.checks),
      nowIso(),
    );
    setResult(tx, job, { package: { id: result.packageId, url: `/media/tryit/${result.packageId}/index.html` } });
    return settle(ctx, tx, job, uploadId);
  },
  failed: required,
};
