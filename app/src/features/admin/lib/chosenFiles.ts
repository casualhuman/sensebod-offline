/*
 * Checks files as they are chosen, before anything is sent: is this a kind
 * the screen accepts, is it empty, was it chosen already. A refused file
 * costs the facilitator nothing (no upload, no wait) and gets a plain reason.
 */
import type { UploadKind } from '@shared/api';
import { classifyFileName, fileIdentity } from './files';

export interface RejectedFile {
  name: string;
  reason: string;
}

export interface SortedFiles {
  accepted: File[];
  rejected: RejectedFile[];
}

export interface SortOptions {
  /** Kinds this screen takes. */
  accept: readonly UploadKind[];
  /** Identities (`fileIdentity`) already on the list. */
  already: readonly string[];
  /** How many more files the list can take. */
  room: number;
  /** Plain reason for a kind that belongs on another screen. */
  wrongKind?: (kind: UploadKind) => string | null;
}

/** Enough for a lesson series in one go; keeps the list and the Pi's queue manageable. */
export const MAX_FILES_AT_ONCE = 20;

export function sortChosenFiles(files: readonly File[], options: SortOptions): SortedFiles {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  const seen = options.already.slice();
  for (const file of files) {
    const { kind } = classifyFileName(file.name);
    const identity = fileIdentity(file);
    if (options.accept.indexOf(kind) === -1) {
      const special = options.wrongKind ? options.wrongKind(kind) : null;
      rejected.push({ name: file.name, reason: special ?? 'This kind of file cannot be added here.' });
    } else if (file.size === 0) {
      rejected.push({ name: file.name, reason: 'This file is empty. Choose it again, or use another copy.' });
    } else if (seen.indexOf(identity) !== -1) {
      rejected.push({ name: file.name, reason: 'Already on the list.' });
    } else if (accepted.length >= options.room) {
      rejected.push({ name: file.name, reason: `Add at most ${MAX_FILES_AT_ONCE} files at a time. Add this one after these are done.` });
    } else {
      accepted.push(file);
      seen.push(identity);
    }
  }
  return { accepted, rejected };
}

/** A Blob with a name, for the upload call. A File passes through untouched (no copy is made). */
export function asFile(blob: Blob, name: string): File {
  if (typeof File !== 'undefined' && blob instanceof File && blob.name === name) return blob;
  return new File([blob], name, { type: blob.type });
}
