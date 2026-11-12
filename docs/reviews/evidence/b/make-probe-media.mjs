/*
 * Reviewer B: assembles a media folder for the server tests, outside the repo:
 *   <out>/               copy of app/mock/media
 *   <out>/tryit/probe/   docs/reviews/evidence/b/tryit-probe + generated binary files (gif, wav, woff2)
 *   <out>/types/         one empty file per extension, to read back the Content-Type the server gives it
 *   node make-probe-media.mjs <repo root> <out>
 */
import { cpSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const [repo, out] = process.argv.slice(2);
cpSync(path.join(repo, 'app/mock/media'), out, { recursive: true });
const probe = path.join(out, 'tryit/probe');
cpSync(path.join(repo, 'docs/reviews/evidence/b/tryit-probe'), probe, { recursive: true });
writeFileSync(path.join(probe, 'pic.gif'), Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'));
// 0.1 s of silence, 8 kHz 8-bit mono PCM
const samples = 800;
const wav = Buffer.alloc(44 + samples, 128);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(samples, 40);
writeFileSync(path.join(probe, 'beep.wav'), wav);
copyFileSync(path.join(repo, 'app/src/shared/fonts/poppins-latin-400.woff2'), path.join(probe, 'font.woff2'));
const types = path.join(out, 'types');
mkdirSync(types, { recursive: true });
for (const ext of ['mp4', 'm4v', 'm4a', 'mp3', 'webm', '3gp', 'ogg', 'oga', 'opus', 'wav', 'aac', 'mov', 'mkv', 'gif', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'ico', 'bmp', 'pdf', 'docx', 'doc', 'txt', 'xml', 'json', 'js', 'mjs', 'css', 'html', 'htm', 'vtt', 'srt', 'woff', 'woff2', 'ttf', 'otf', 'wasm', 'zip', 'h5p']) {
  writeFileSync(path.join(types, 'file.' + ext), 'x');
}
console.log('media folder ready: ' + out);
