/* Validators for the whole-set JSON parts of a lesson (DATABASE §6.1). They return clean copies and never trust shapes. */
import { invalid } from '../core/errors.ts';
import { random128 } from '../core/ids.ts';

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length <= max ? value : null);

/** Only pictures served by the bag itself may be referenced. */
function localUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  return /^\/(media|illustrations|pictures)\/[A-Za-z0-9._\/-]+$/.test(value) && value.indexOf('..') === -1 ? value : null;
}

function pictureIn(value: unknown): { url: string; alt: string } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const url = localUrl(v.url);
  if (!url) return null;
  return { url, alt: text(v.alt, 300) ?? '' };
}

export function cleanBlocks(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 500) throw invalid('The lesson text is not readable.', { blocks: 'Write the lesson again.' });
  const out: unknown[] = [];
  for (const raw of value) {
    const block = (raw ?? {}) as Record<string, unknown>;
    if (block.kind === 'heading' || block.kind === 'paragraph') {
      const words = text(block.text, 5000);
      if (words === null) throw invalid('A part of the text is too long.', { blocks: 'Make the text shorter.' });
      if (words.trim()) out.push({ kind: block.kind, text: words });
    } else if (block.kind === 'list') {
      const items = Array.isArray(block.items) ? block.items.filter((i): i is string => typeof i === 'string' && i.trim() !== '' && i.length <= 1000).slice(0, 100) : [];
      if (items.length > 0) out.push({ kind: 'list', ordered: block.ordered === true, items });
    } else if (block.kind === 'picture') {
      const picture = pictureIn(block.picture);
      if (!picture) throw invalid('A picture in the text is not on this bag.', { blocks: 'Choose the picture again.' });
      out.push({ kind: 'picture', picture, caption: text(block.caption, 300) });
    } else {
      throw invalid('The lesson text has a part the bag does not know.', { blocks: 'Write the lesson again.' });
    }
  }
  return out;
}

export function cleanTranscript(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 2000) throw invalid('The read along text is not readable.', { transcript: 'Type the words again.' });
  const out: unknown[] = [];
  for (const raw of value) {
    const line = (raw ?? {}) as Record<string, unknown>;
    const words = text(line.text, 2000);
    if (words === null) throw invalid('A line of the read along text is too long.', { transcript: 'Make the line shorter.' });
    if (!words.trim()) continue;
    const start = typeof line.start === 'number' && Number.isFinite(line.start) && line.start >= 0 ? line.start : null;
    out.push({ start, text: words });
  }
  return out;
}

export interface CleanQuestion {
  id: string;
  prompt: string;
  listenUrl: string | null;
  answers: { id: string; text: string; correct: boolean; feedback: string }[];
  allowRetry: boolean;
  atSeconds?: number;
  pauseUntilAnswered?: boolean;
}

/** Every question needs its words, at least two answers and exactly one correct answer (422 otherwise). */
export function cleanQuestions(value: unknown, forVideo: boolean): CleanQuestion[] {
  if (!Array.isArray(value) || value.length > 100) throw invalid('The questions are not readable.', { questions: 'Add the questions again.' });
  const seen = new Set<string>();
  const out = value.map((raw): CleanQuestion => {
    const q = (raw ?? {}) as Record<string, unknown>;
    const prompt = text(q.prompt, 500);
    if (!prompt || !prompt.trim()) throw invalid('Every question needs its words.', { prompt: 'Type the question.' });
    const answersIn = Array.isArray(q.answers) ? q.answers : [];
    if (answersIn.length < 2) throw invalid('Every question needs at least two answers.', { answers: 'Add an answer.' });
    if (answersIn.length > 8) throw invalid('A question can have up to 8 answers.', { answers: 'Remove an answer.' });
    let id = typeof q.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(q.id) ? q.id : `q-${random128().slice(0, 10)}`;
    if (seen.has(id)) id = `q-${random128().slice(0, 10)}`;
    seen.add(id);
    const answers = answersIn.map((rawAnswer, index) => {
      const a = (rawAnswer ?? {}) as Record<string, unknown>;
      const words = text(a.text, 300);
      if (!words || !words.trim()) throw invalid('Every answer needs its words.', { answers: 'Type the answer.' });
      return {
        id: typeof a.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(a.id) ? a.id : `${id}-a${index + 1}`,
        text: words,
        correct: a.correct === true,
        feedback: text(a.feedback, 500) ?? '',
      };
    });
    if (answers.filter((a) => a.correct).length !== 1) throw invalid('Choose one correct answer for every question.', { answers: 'Mark the correct answer.' });
    const question: CleanQuestion = { id, prompt, listenUrl: localUrl(q.listenUrl), answers, allowRetry: q.allowRetry !== false };
    if (forVideo) {
      question.atSeconds = typeof q.atSeconds === 'number' && Number.isFinite(q.atSeconds) && q.atSeconds >= 0 ? q.atSeconds : 0;
      question.pauseUntilAnswered = q.pauseUntilAnswered !== false;
    }
    return question;
  });
  if (forVideo) out.sort((a, b) => (a.atSeconds ?? 0) - (b.atSeconds ?? 0));
  return out;
}

export interface CleanSpot {
  id: string;
  label: string;
  role: string;
  says: string;
  audioUrl: string | null;
  audioUploadId: string | null;
  portrait: { url: string; alt: string } | null;
  x: number;
  y: number;
  r: number;
}

const percent = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null);

export function cleanSpots(value: unknown): CleanSpot[] {
  if (!Array.isArray(value) || value.length === 0) throw invalid('Add at least one spot for learners to tap.', { spots: 'Add a spot.' });
  if (value.length > 30) throw invalid('A picture can have up to 30 spots.', { spots: 'Remove a spot.' });
  return value.map((raw, index): CleanSpot => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const x = percent(s.x);
    const y = percent(s.y);
    const r = percent(s.r);
    if (x === null || y === null || r === null) throw invalid('A spot is outside the picture.', { spots: 'Place the spot again.' });
    return {
      id: typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.id) ? s.id : `spot-${index + 1}`,
      label: text(s.label, 120) ?? '',
      role: text(s.role, 120) ?? '',
      says: text(s.says, 1000) ?? '',
      audioUrl: localUrl(s.audioUrl),
      audioUploadId: typeof s.audioUploadId === 'string' ? s.audioUploadId : null,
      portrait: pictureIn(s.portrait),
      x,
      y,
      r,
    };
  });
}

export { pictureIn, localUrl };
