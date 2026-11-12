/*
 * What the admin can say about a file before it is sent: its kind, the
 * lesson type it will become (the automatic rule), a readable size and a
 * first title. The server decides for real when the file arrives (`Upload`
 * in the contract); this is only so the list can say "Becomes Watch" at once
 * and refuse an unusable file without spending an upload on it.
 */
import type { LessonType, UploadKind } from '@shared/api';

export interface FileKindInfo {
  kind: UploadKind;
  becomes: LessonType | null;
  /** "Video", "Voice note", "PDF" … for the list rows. */
  label: string;
}

const KINDS: { kind: UploadKind; becomes: LessonType; label: string; extensions: string[] }[] = [
  { kind: 'video', becomes: 'watch', label: 'Video', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', '3gp', 'avi'] },
  { kind: 'voice-note', becomes: 'listen', label: 'Voice note', extensions: ['opus', 'ogg', 'amr'] },
  { kind: 'audio', becomes: 'listen', label: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav'] },
  { kind: 'pdf', becomes: 'read', label: 'PDF', extensions: ['pdf'] },
  { kind: 'word', becomes: 'read', label: 'Word', extensions: ['doc', 'docx'] },
  { kind: 'photo', becomes: 'read', label: 'Photo', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic'] },
  { kind: 'animation', becomes: 'try', label: 'Animation package', extensions: ['zip'] },
  { kind: 'h5p', becomes: 'try', label: 'H5P file', extensions: ['h5p'] },
];

export function fileExtension(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match && match[1] ? match[1].toLowerCase() : '';
}

/** The automatic type rule, by file extension (the same table the bag uses). */
export function classifyFileName(fileName: string): FileKindInfo {
  const ext = fileExtension(fileName);
  for (const entry of KINDS) {
    if (entry.extensions.indexOf(ext) !== -1) return { kind: entry.kind, becomes: entry.becomes, label: entry.label };
  }
  return { kind: 'unknown', becomes: null, label: 'Unknown file' };
}

export const UPLOAD_KIND_LABELS: Record<UploadKind, string> = {
  video: 'Video',
  audio: 'Audio',
  'voice-note': 'Voice note',
  pdf: 'PDF',
  word: 'Word',
  photo: 'Photo',
  animation: 'Animation package',
  h5p: 'H5P file',
  unknown: 'Unknown file',
};

/** Which kinds each add-content screen accepts. */
export const ACCEPT = {
  /** Upload files: everything except animation packages, which have their own checks. */
  uploadFiles: ['video', 'audio', 'voice-note', 'pdf', 'word', 'photo'] as UploadKind[],
  notesDocument: ['pdf', 'word'] as UploadKind[],
  photos: ['photo'] as UploadKind[],
  animation: ['animation', 'h5p'] as UploadKind[],
  audio: ['audio', 'voice-note'] as UploadKind[],
};

/** `accept` attribute values. Extensions are listed as well as MIME groups: old Android pickers honour one or the other. */
export const ACCEPT_ATTR = {
  uploadFiles: 'video/*,audio/*,.opus,.ogg,.amr,.pdf,.doc,.docx,image/*',
  notesDocument: '.pdf,.doc,.docx,application/pdf',
  photos: 'image/*',
  animation: '.zip,.h5p',
  audio: 'audio/*,.opus,.ogg,.amr',
};

/** 35651584 → "34 MB". Whole megabytes from 10 MB up, one decimal below, KB under 1 MB. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !isFinite(bytes) || bytes < 0) return '[size] MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = Math.max(1, Math.round(bytes / 1024));
  return `${kb} KB`;
}

/** "21 of 34 MB sent": both numbers in the unit of the total. */
export function formatProgress(sentBytes: number, totalBytes: number): string {
  if (totalBytes <= 0) return 'Sending…';
  const mb = 1024 * 1024;
  if (totalBytes >= mb) {
    const total = Math.max(1, Math.round(totalBytes / mb));
    const sent = Math.min(total, Math.floor(sentBytes / mb));
    return `${sent} of ${total} MB sent`;
  }
  const total = Math.max(1, Math.round(totalBytes / 1024));
  const sent = Math.min(total, Math.floor(sentBytes / 1024));
  return `${sent} of ${total} KB sent`;
}

export function percent(sent: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((sent / total) * 100)));
}

export const TITLE_MAX = 120;

/** "Quail housing.mp4" → "Quail housing". Underscores become spaces; never empty. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const title = base || 'Untitled lesson';
  return title.length > TITLE_MAX ? title.slice(0, TITLE_MAX) : title;
}

/** Problem with a lesson or series title, in plain words, or null when it is fine. */
export function titleProblem(title: string, what = 'a title'): string | null {
  const trimmed = title.trim();
  if (!trimmed) return `Type ${what} first.`;
  if (trimmed.length > TITLE_MAX) return `Make it shorter: ${TITLE_MAX} letters at most.`;
  return null;
}

/** A file is the same one if name, size and date all match (choosing it twice adds it once). */
export function fileIdentity(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}
