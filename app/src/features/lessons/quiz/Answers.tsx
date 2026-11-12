/*
 * Answer rows with the reason inside the chosen row, as on AGB-Agri-Quiz and
 * CPB-WatchAnswer. Built on the shared `.sb-choice` row; the shared
 * ChoiceGroup itself is not used because it has no place for the feedback
 * that these boards put inside the row.
 *
 * Right and wrong never rest on colour: the mark changes (tick / try-again
 * arrow), the row says "Yes, that is right" or "Let's think again", and the
 * reason is always written out.
 */
import type { ReactNode } from 'react';
import type { QuizAnswer, QuizQuestion } from '@shared/api';
import { Button, cx } from '@shared/components';
import { IconInfo, IconTick, IconTryAgain } from '@shared/icons';
import { outcome, type QuestionState } from './quizLogic';

export interface AnswersProps {
  question: QuizQuestion;
  state: QuestionState;
  onPick: (answerId: string) => void;
  /** Check quiz: shows the "Try again" button after a wrong answer. */
  onTryAgain?: () => void;
  /** letters: A, B, C in the mark (quiz) · rings: an empty ring (video question). */
  marks?: 'letters' | 'rings';
  /** What the status line says after the right answer, e.g. "Well done. You can keep watching." */
  rightWords: string;
}

function Feedback({ right, text }: { right: boolean; text: string }) {
  return (
    <span className={cx('les-answer__why', right ? 'les-answer__why--right' : 'les-answer__why--again')}>
      <span className="les-answer__verdict">
        {right ? <IconTick size={22} /> : <IconTryAgain size={22} />}
        {right ? 'Yes, that is right' : 'Let’s think again'}
      </span>
      <span className="les-answer__reason">{text}</span>
    </span>
  );
}

export function Answers({ question, state, onPick, onTryAgain, marks = 'letters', rightWords }: AnswersProps) {
  const result = outcome(state);

  function row(answer: QuizAnswer, index: number): ReactNode {
    const chosen = state.picked === answer.id;
    // Wrong on a question without retry: the right answer is pointed out too.
    const revealed = result === 'shown' && answer.correct;
    const right = (chosen && answer.correct) || revealed;
    const again = chosen && !answer.correct;
    let mark: ReactNode = marks === 'letters' ? String.fromCharCode(65 + index) : null;
    if (right) mark = <IconTick size={30} />;
    else if (again) mark = <IconTryAgain size={28} />;
    return (
      <button
        key={answer.id}
        type="button"
        role="radio"
        aria-checked={chosen}
        disabled={state.locked}
        className={cx('sb-choice', 'les-answer', right && 'les-answer--right', again && 'les-answer--again')}
        onClick={() => onPick(answer.id)}
      >
        <span className="les-answer__row">
          <span className={cx('sb-choice__mark', 'les-answer__mark', marks === 'rings' && !right && !again && 'les-answer__mark--ring')} aria-hidden="true">
            {mark}
          </span>
          <span className="sb-choice__text">
            {answer.text}
            {/* Under the words, not beside them: beside leaves no room for the answer on a 320px phone. */}
            {chosen ? <span className="sb-choice__note les-answer__note">Your answer</span> : null}
            {revealed ? <span className="sb-choice__note les-answer__note">Right answer</span> : null}
          </span>
        </span>
        {right || again ? <Feedback right={right} text={answer.feedback} /> : null}
      </button>
    );
  }

  return (
    <>
      <div role="radiogroup" aria-label="Answers" className="sb-choices les-answers">
        {question.answers.map(row)}
      </div>
      <div role="status" className="les-answers__status">
        {result === 'none' ? (
          <p className="les-answers__line">
            <IconInfo size={26} />
            Tap the answer you think is right.
          </p>
        ) : null}
        {result === 'right' ? (
          <p className="les-answers__line les-answers__line--right">
            <IconTick size={26} />
            {rightWords}
          </p>
        ) : null}
        {result === 'again' ? (
          <>
            <p className="les-answers__line les-answers__line--again">
              <IconTryAgain size={26} />
              It is OK to try again. Choose another answer.
            </p>
            {onTryAgain ? (
              <Button variant="secondary" fullWidth className="les-answers__retry" icon={<IconTryAgain size={28} />} onClick={onTryAgain}>
                Try again
              </Button>
            ) : null}
          </>
        ) : null}
        {result === 'shown' ? (
          <p className="les-answers__line les-answers__line--again">
            <IconInfo size={26} />
            The right answer is marked with a tick. You can go on.
          </p>
        ) : null}
      </div>
    </>
  );
}
