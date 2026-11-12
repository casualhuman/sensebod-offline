/*
 * Question editor model (ADM-Questions). The board edits "Feedback when
 * right" and "Feedback when wrong" once per question; the contract stores a
 * feedback sentence on every answer. These functions convert both ways and
 * check a set before it is sent, with the same rules the bag applies
 * (a prompt, at least two answers, exactly one correct).
 */
import type { QuestionSet, QuizAnswer } from '@shared/api';

export interface EditorAnswer {
  id: string;
  text: string;
}

export interface EditorQuestion {
  id: string;
  prompt: string;
  listenUrl: string | null;
  answers: EditorAnswer[];
  /** Id of the correct answer. */
  correctId: string | null;
  feedbackRight: string;
  feedbackWrong: string;
  allowRetry: boolean;
  /** Interactive video only: where the video stops, as typed ("1:42"). */
  time: string;
  pauseUntilAnswered: boolean;
}

export const MAX_ANSWERS = 4;
export const MIN_ANSWERS = 2;

let counter = 0;
function localId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** 102 → "1:42". */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const rest = whole % 60;
  return `${Math.floor(whole / 60)}:${rest < 10 ? '0' : ''}${rest}`;
}

/** "1:42" → 102, "45" → 45. null when it is not a time. */
export function parseTime(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + Number(part);
  if (parts.length > 1 && Number(parts[parts.length - 1]) > 59) return null;
  return seconds;
}

export function newQuestion(atSeconds: number | null): EditorQuestion {
  const first = localId('a');
  return {
    id: localId('q'),
    prompt: '',
    listenUrl: null,
    answers: [
      { id: first, text: '' },
      { id: localId('a'), text: '' },
    ],
    correctId: first,
    feedbackRight: '',
    feedbackWrong: '',
    allowRetry: true,
    time: atSeconds === null ? '' : formatTime(atSeconds),
    pauseUntilAnswered: true,
  };
}

export function addAnswer(question: EditorQuestion): EditorQuestion {
  if (question.answers.length >= MAX_ANSWERS) return question;
  return { ...question, answers: question.answers.concat({ id: localId('a'), text: '' }) };
}

export function removeAnswer(question: EditorQuestion, answerId: string): EditorQuestion {
  if (question.answers.length <= MIN_ANSWERS) return question;
  const answers = question.answers.filter((answer) => answer.id !== answerId);
  const correctId = question.correctId === answerId ? null : question.correctId;
  return { ...question, answers, correctId };
}

export function fromQuestionSet(set: QuestionSet): EditorQuestion[] {
  return set.questions.map((question) => {
    const correct = question.answers.find((answer) => answer.correct) ?? null;
    const wrong = question.answers.find((answer) => !answer.correct) ?? null;
    return {
      id: question.id,
      prompt: question.prompt,
      listenUrl: question.listenUrl,
      answers: question.answers.map((answer) => ({ id: answer.id, text: answer.text })),
      correctId: correct ? correct.id : null,
      feedbackRight: correct ? correct.feedback : '',
      feedbackWrong: wrong ? wrong.feedback : '',
      allowRetry: question.allowRetry,
      time: typeof question.atSeconds === 'number' ? formatTime(question.atSeconds) : '',
      pauseUntilAnswered: question.pauseUntilAnswered ?? true,
    };
  });
}

export function toQuestionSet(lessonId: string, kind: QuestionSet['kind'], questions: readonly EditorQuestion[]): QuestionSet {
  return {
    lessonId,
    kind,
    questions: questions.map((question) => {
      const answers: QuizAnswer[] = question.answers.map((answer) => {
        const correct = answer.id === question.correctId;
        return { id: answer.id, text: answer.text.trim(), correct, feedback: (correct ? question.feedbackRight : question.feedbackWrong).trim() };
      });
      const base = { id: question.id, prompt: question.prompt.trim(), listenUrl: question.listenUrl, answers, allowRetry: question.allowRetry };
      if (kind !== 'video') return base;
      return { ...base, atSeconds: parseTime(question.time) ?? 0, pauseUntilAnswered: question.pauseUntilAnswered };
    }),
  };
}

export type QuestionField = 'prompt' | 'answers' | 'correct' | 'feedbackRight' | 'feedbackWrong' | 'time';
export type QuestionProblems = Partial<Record<QuestionField, string>>;

/**
 * Problems with one question, in plain words. `lengthSeconds` is the video
 * length when known, so a stop after the end is caught.
 */
export function questionProblems(question: EditorQuestion, kind: QuestionSet['kind'], lengthSeconds: number | null = null): QuestionProblems {
  const problems: QuestionProblems = {};
  if (!question.prompt.trim()) problems.prompt = 'Type the question.';
  const filled = question.answers.filter((answer) => answer.text.trim().length > 0);
  if (filled.length < question.answers.length) problems.answers = 'Type every answer, or remove the empty one.';
  else if (question.answers.length < MIN_ANSWERS) problems.answers = 'Add at least two answers.';
  else {
    const texts = question.answers.map((answer) => answer.text.trim().toLowerCase());
    if (texts.some((text, index) => texts.indexOf(text) !== index)) problems.answers = 'Two answers are the same. Change one.';
  }
  if (!question.correctId || !question.answers.some((answer) => answer.id === question.correctId)) problems.correct = 'Choose the correct answer.';
  if (!question.feedbackRight.trim()) problems.feedbackRight = 'Say why it is right.';
  if (!question.feedbackWrong.trim()) problems.feedbackWrong = 'Say why it is wrong, kindly.';
  if (kind === 'video') {
    const at = parseTime(question.time);
    if (at === null) problems.time = 'Type the time like 1:42.';
    else if (lengthSeconds !== null && at > lengthSeconds) problems.time = `The video is only ${formatTime(lengthSeconds)} long.`;
  }
  return problems;
}

export function hasProblems(problems: QuestionProblems): boolean {
  return Object.keys(problems).length > 0;
}

/** Index of the first question with a problem, or -1 when the whole set can be saved. */
export function firstInvalid(questions: readonly EditorQuestion[], kind: QuestionSet['kind'], lengthSeconds: number | null = null): number {
  return questions.findIndex((question) => hasProblems(questionProblems(question, kind, lengthSeconds)));
}

/** Video questions in the order learners meet them. */
export function sortByTime(questions: readonly EditorQuestion[]): EditorQuestion[] {
  return questions
    .map((question, index) => ({ question, index, at: parseTime(question.time) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at))
    .map((entry) => entry.question);
}
