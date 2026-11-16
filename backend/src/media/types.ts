/*
 * The automatic type rule and the allow-list of uploads (SYSTEM-ARCHITECTURE
 * §5.4, D-2.8): the lesson type is set from what is uploaded. A file is
 * accepted only when its extension is on the list AND its first bytes say the
 * same thing. The original file name is never used as a path.
 *
 * `blobExt` is the extension the original may be stored under in the media
 * store (the store only holds formats phones can open, DATABASE §6 `blob.ext`).
 * Originals without one (.mov, .3gp, .wav, .aac, .docx, .zip) are converted or
 * unpacked by the worker and are not kept.
 */

export type UploadKind = 'video' | 'audio' | 'voice-note' | 'pdf' | 'word' | 'photo' | 'animation' | 'h5p' | 'unknown';
export type Becomes = 'watch' | 'listen' | 'read' | 'try' | null;
type Family = 'isobmff' | 'webm' | 'mp3' | 'ogg' | 'wav' | 'aac' | 'pdf' | 'zip' | 'jpeg' | 'png' | 'webp';

export interface FileClass {
  ext: string;
  kind: UploadKind;
  becomes: Becomes;
  blobExt: string | null;
  mimeType: string;
  family: Family;
}

const TABLE: Record<string, Omit<FileClass, 'ext'>> = {
  mp4: { kind: 'video', becomes: 'watch', blobExt: 'mp4', mimeType: 'video/mp4', family: 'isobmff' },
  m4v: { kind: 'video', becomes: 'watch', blobExt: 'mp4', mimeType: 'video/mp4', family: 'isobmff' },
  mov: { kind: 'video', becomes: 'watch', blobExt: null, mimeType: 'video/quicktime', family: 'isobmff' },
  '3gp': { kind: 'video', becomes: 'watch', blobExt: null, mimeType: 'video/3gpp', family: 'isobmff' },
  webm: { kind: 'video', becomes: 'watch', blobExt: 'webm', mimeType: 'video/webm', family: 'webm' },
  m4a: { kind: 'audio', becomes: 'listen', blobExt: 'm4a', mimeType: 'audio/mp4', family: 'isobmff' },
  mp3: { kind: 'audio', becomes: 'listen', blobExt: 'mp3', mimeType: 'audio/mpeg', family: 'mp3' },
  wav: { kind: 'audio', becomes: 'listen', blobExt: null, mimeType: 'audio/wav', family: 'wav' },
  aac: { kind: 'audio', becomes: 'listen', blobExt: null, mimeType: 'audio/aac', family: 'aac' },
  ogg: { kind: 'voice-note', becomes: 'listen', blobExt: 'ogg', mimeType: 'audio/ogg', family: 'ogg' },
  opus: { kind: 'voice-note', becomes: 'listen', blobExt: 'opus', mimeType: 'audio/ogg', family: 'ogg' },
  pdf: { kind: 'pdf', becomes: 'read', blobExt: 'pdf', mimeType: 'application/pdf', family: 'pdf' },
  docx: { kind: 'word', becomes: 'read', blobExt: null, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', family: 'zip' },
  jpg: { kind: 'photo', becomes: 'read', blobExt: 'jpg', mimeType: 'image/jpeg', family: 'jpeg' },
  jpeg: { kind: 'photo', becomes: 'read', blobExt: 'jpg', mimeType: 'image/jpeg', family: 'jpeg' },
  png: { kind: 'photo', becomes: 'read', blobExt: 'png', mimeType: 'image/png', family: 'png' },
  webp: { kind: 'photo', becomes: 'read', blobExt: 'webp', mimeType: 'image/webp', family: 'webp' },
  zip: { kind: 'animation', becomes: 'try', blobExt: null, mimeType: 'application/zip', family: 'zip' },
  h5p: { kind: 'h5p', becomes: 'try', blobExt: null, mimeType: 'application/zip', family: 'zip' },
};

export function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName);
  return match ? (match[1] as string).toLowerCase() : '';
}

/** The class of a file by its name, or null when the kind is not accepted. */
export function classify(fileName: string): FileClass | null {
  const ext = extensionOf(fileName);
  const found = TABLE[ext];
  return found ? { ext, ...found } : null;
}

/** Why a name is refused, in words for the admin. */
export function refusalFor(fileName: string, h5pPlayer: boolean): string | null {
  const ext = extensionOf(fileName);
  if (ext === 'doc') return 'Old Word files (.doc) cannot be added. Save it as PDF or .docx, then upload it again.';
  if (ext === 'svg' || ext === 'html' || ext === 'htm') return 'This kind of file cannot be added on its own. Put it in an animation package (.zip) from EasySTEM.';
  if (ext === 'h5p' && !h5pPlayer) return 'H5P needs the H5P player on this bag. Ask EasySTEM to add the H5P player.';
  if (!TABLE[ext]) return 'This kind of file cannot be added. Use video, audio, PDF, Word (.docx), photos or an animation package.';
  return null;
}

const ascii = (bytes: Buffer, from: number, text: string): boolean => bytes.length >= from + text.length && bytes.toString('latin1', from, from + text.length) === text;

/** Do the first bytes of the file agree with its extension? Needs at least 12 bytes. */
export function sniffMatches(family: Family, head: Buffer): boolean {
  if (head.length < 12) return false;
  switch (family) {
    case 'isobmff':
      return ascii(head, 4, 'ftyp') || ascii(head, 4, 'moov') || ascii(head, 4, 'mdat') || ascii(head, 4, 'wide') || ascii(head, 4, 'free');
    case 'webm':
      return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    case 'mp3':
      return ascii(head, 0, 'ID3') || (head[0] === 0xff && ((head[1] as number) & 0xe0) === 0xe0);
    case 'ogg':
      return ascii(head, 0, 'OggS');
    case 'wav':
      return ascii(head, 0, 'RIFF') && ascii(head, 8, 'WAVE');
    case 'aac':
      return head[0] === 0xff && ((head[1] as number) & 0xf6) === 0xf0;
    case 'pdf':
      return ascii(head, 0, '%PDF-');
    case 'zip':
      return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    case 'jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'png':
      return head[0] === 0x89 && ascii(head, 1, 'PNG');
    case 'webp':
      return ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP');
    default:
      return false;
  }
}

/** Which conversions an accepted upload needs after it is inspected. */
export function followUps(file: FileClass, smallerCopy: boolean): string[] {
  if (file.kind === 'video') return smallerCopy || file.blobExt === null ? ['smaller_copy'] : [];
  if (file.kind === 'voice-note') return ['voice_convert'];
  if (file.kind === 'audio') return file.blobExt === null ? ['voice_convert'] : [];
  if (file.kind === 'pdf') return ['pdf_pages'];
  if (file.kind === 'word') return ['docx_text'];
  if (file.kind === 'animation') return ['package_check'];
  return [];
}

export function workingNote(kind: string, smallerCopy: boolean): string {
  if (kind === 'voice-note' || kind === 'audio') return 'Converting so every phone can play it.';
  if (kind === 'video') return smallerCopy ? 'Making a smaller copy for old phones.' : 'Checking the video.';
  if (kind === 'pdf' || kind === 'word') return 'Getting the pages ready to read on any phone.';
  if (kind === 'animation') return 'Checking the animation.';
  return 'Checking the file.';
}
