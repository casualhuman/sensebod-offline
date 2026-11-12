/*
 * "Type it yourself": the editor's blocks, their conversion to the
 * contract's ReadBlock[], and the copy kept on this phone while typing.
 *
 * The copy on the phone is what makes a refresh, a dropped Wi-Fi connection
 * or an expired sign-in harmless: the words are written to localStorage as
 * they are typed and only removed once the bag has confirmed the lesson.
 * It holds lesson text only: nothing personal, no credentials.
 */
import { newRequestKey, type Picture, type ReadBlock } from '@shared/api';

export type EditorBlock =
  | { id: string; kind: 'paragraph' | 'heading'; text: string }
  /** One item per line. */
  | { id: string; kind: 'list'; text: string; ordered: boolean }
  | { id: string; kind: 'picture'; picture: Picture; caption: string };

export interface TypedDraft {
  title: string;
  blocks: EditorBlock[];
  /** Recorded voice already on the bag ("Record yourself reading it"). */
  voice: { uploadId: string; fileName: string } | null;
  /** Idempotency key for creating the lesson: the same draft can never become two lessons. */
  requestKey: string;
}

let blockCounter = 0;

export function newBlockId(): string {
  blockCounter += 1;
  return `b${Date.now().toString(36)}${blockCounter}`;
}

export function emptyDraft(): TypedDraft {
  return { title: '', blocks: [{ id: newBlockId(), kind: 'paragraph', text: '' }], voice: null, requestKey: newRequestKey() };
}

/** Editor blocks → what the bag stores. Empty blocks and empty list lines are dropped. */
export function toReadBlocks(blocks: readonly EditorBlock[]): ReadBlock[] {
  const out: ReadBlock[] = [];
  for (const block of blocks) {
    if (block.kind === 'picture') {
      out.push({ kind: 'picture', picture: block.picture, caption: block.caption.trim() || null });
    } else if (block.kind === 'list') {
      const items = block.text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (items.length > 0) out.push({ kind: 'list', ordered: block.ordered, items });
    } else {
      const text = block.text.trim();
      if (text) out.push({ kind: block.kind, text });
    }
  }
  return out;
}

export function countWords(blocks: readonly EditorBlock[]): number {
  let words = 0;
  for (const block of blocks) {
    const text = block.kind === 'picture' ? block.caption : block.text;
    const found = text.trim().match(/\S+/g);
    if (found) words += found.length;
  }
  return words;
}

/** True when there is something worth keeping. */
export function hasContent(draft: TypedDraft): boolean {
  return draft.title.trim().length > 0 || toReadBlocks(draft.blocks).length > 0 || draft.voice !== null;
}

/** What stops the lesson from being saved, or null. */
export function typedProblem(draft: TypedDraft): { field: 'title' | 'blocks'; message: string } | null {
  if (!draft.title.trim()) return { field: 'title', message: 'Type a title first.' };
  if (toReadBlocks(draft.blocks).length === 0) return { field: 'blocks', message: 'Write the lesson text first.' };
  return null;
}

/* ---- the copy on this phone ---- */

const STORAGE_KEY = 'sensebod.admin.typed-draft.v1';
/** Far more than a typed lesson needs; stops a runaway paste from filling the phone's storage. */
const MAX_CHARS = 200000;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isPicture(value: unknown): value is Picture {
  if (!value || typeof value !== 'object') return false;
  const picture = value as Partial<Picture>;
  // Only pictures served by the bag itself are accepted back from storage.
  return typeof picture.url === 'string' && picture.url.charAt(0) === '/' && picture.url.charAt(1) !== '/' && typeof picture.alt === 'string';
}

/** Stored data is treated as untrusted input: anything that does not fit the shape is dropped. */
function parseBlock(value: unknown): EditorBlock | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newBlockId();
  if (raw.kind === 'paragraph' || raw.kind === 'heading') {
    return typeof raw.text === 'string' ? { id, kind: raw.kind, text: raw.text } : null;
  }
  if (raw.kind === 'list') {
    return typeof raw.text === 'string' ? { id, kind: 'list', text: raw.text, ordered: raw.ordered === true } : null;
  }
  if (raw.kind === 'picture' && isPicture(raw.picture)) {
    return { id, kind: 'picture', picture: { url: raw.picture.url, alt: raw.picture.alt }, caption: typeof raw.caption === 'string' ? raw.caption : '' };
  }
  return null;
}

export function loadTypedDraft(): TypedDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const text = store.getItem(STORAGE_KEY);
    if (!text) return null;
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks)) return null;
    const blocks = raw.blocks.map(parseBlock).filter((block): block is EditorBlock => block !== null);
    const voiceRaw = raw.voice as Record<string, unknown> | null | undefined;
    const voice =
      voiceRaw && typeof voiceRaw.uploadId === 'string' && typeof voiceRaw.fileName === 'string'
        ? { uploadId: voiceRaw.uploadId, fileName: voiceRaw.fileName }
        : null;
    return {
      title: typeof raw.title === 'string' ? raw.title : '',
      blocks: blocks.length > 0 ? blocks : emptyDraft().blocks,
      voice,
      requestKey: typeof raw.requestKey === 'string' && raw.requestKey ? raw.requestKey : newRequestKey(),
    };
  } catch {
    return null;
  }
}

/** Returns false when the phone could not keep the copy (storage full, private mode, too long). */
export function saveTypedDraft(draft: TypedDraft): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const text = JSON.stringify(draft);
    if (text.length > MAX_CHARS) return false;
    store.setItem(STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function clearTypedDraft(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the copy simply stays until it is overwritten.
  }
}
