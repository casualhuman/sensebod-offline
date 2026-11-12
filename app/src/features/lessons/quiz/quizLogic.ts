/*
 * Rules of a question, shared by the Check quiz and the questions that stop
 * an interactive video. Pure functions: no timers, no stakes.
 *
 *   - tapping an answer shows at once whether it is right, and always why
 *   - a wrong answer is "let's think again": the learner may choose again
 *     (unless the question was authored with allowRetry: false, in which
 *     case the right answer is shown and they move on)
 *   - a question counts as correct when the learner ends on the right answer
 */
import type { QuizAnswer, QuizQuestion } from '@shared/api';
import type { QuizResult } from '../progress/progress';

export interface QuestionState {
  /** The answer showing now, or null (nothing chosen, or "Try again" tapped). */
  picked: string | null;
  /** The right answer has been chosen. */
  solved: boolean;
  /** No more choosing: solved, or wrong on a question without retry. */
  locked: boolean;
  attempts: number;
}

export const FRESH: QuestionState = { picked: null, solved: false, locked: false, attempts: 0 };

export function findAnswer(question: QuizQuestion, answerId: string | null): QuizAnswer | null {
  if (answerId === null) return null;
  for (const answer of question.answers) {
    if (answer.id === answerId) return answer;
  }
  return null;
}

export function pickAnswer(question: QuizQuestion, state: QuestionState, answerId: string): QuestionState {
  if (state.locked) return state;
  const answer = findAnswer(question, answerId);
  if (!answer) return state;
  if (answer.correct) return { picked: answerId, solved: true, locked: true, attempts: state.attempts + 1 };
  return { picked: answerId, solved: false, locked: !question.allowRetry, attempts: state.attempts + 1 };
}

/** "Try again": clear the wrong choice so all answers look fresh. */
export function clearPick(state: QuestionState): QuestionState {
  if (state.locked) return state;
  return { ...state, picked: null };
}

export type Outcome = 'none' | 'right' | 'again' | 'shown';

/** none: nothing chosen · right · again: wrong, may retry · shown: wrong, the right answer is revealed. */
export function outcome(state: QuestionState): Outcome {
  if (state.picked === null) return 'none';
  if (state.solved) return 'right';
  return state.locked ? 'shown' : 'again';
}

/** May the learner leave this question? Yes once they have answered at all. */
export function hasAnswered(state: QuestionState): boolean {
  return state.attempts > 0 && state.picked !== null;
}

/** An interactive video that waits for the answer continues once the question is settled. */
export function isSettled(state: QuestionState): boolean {
  return state.locked;
}

export function scoreQuiz(questions: readonly QuizQuestion[], states: readonly (QuestionState | undefined)[]): QuizResult {
  const answers = questions.map((_, index) => {
    const state = states[index];
    return !!state && state.solved;
  });
  return { correct: answers.filter(Boolean).length, total: questions.length, answers };
}

/**
 * Interactive video: the first question that must be asked once playback has
 * reached `to` (seconds), or -1. Questions are sorted by time. A question
 * already settled is never asked again, and because the earliest open one is
 * returned, seeking forward cannot jump over a question.
 */
export function questionDue(questions: readonly { atSeconds: number }[], settled: readonly boolean[], to: number): number {
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    if (!question || settled[index]) continue;
    if (to >= question.atSeconds) return index;
  }
  return -1;
}
