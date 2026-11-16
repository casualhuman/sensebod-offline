/*
 * Check · the quiz at the end of a series (AGB-Agri-Quiz; answer states from
 * V3-Components "Quiz question"). One question at a time, no timer, a wrong
 * answer is "let's think again" with the reason and another go. The quiz's
 * name is in the header bar and the card has no picture, so the question and
 * its answers are on screen without scrolling.
 *
 * The questions come from the lesson data. The Child protection "Check what
 * you learned" quiz has no board of its own (HANDOFF section 8) and uses
 * this same screen.
 */
import { useEffect, useRef, useState } from 'react';
import type { CheckContent, Lesson } from '@shared/api';
import { Button, cx, EmptyState, LessonHeaderPill } from '@shared/components';
import { IconArrowRight, IconCheckQuiz, IconClock } from '@shared/icons';
import { navigate, paths } from '@shared/router';
import { ListenBar, ListenButton } from '@shared/shell';
import { finishLesson } from '../progress/progress';
import { Answers } from '../quiz/Answers';
import { clearPick, FRESH, hasAnswered, pickAnswer, scoreQuiz, type QuestionState } from '../quiz/quizLogic';

/** For screen readers: "Question 1 done. Now on question 2. Question 3 to go." */
export function describeQuestions(index: number, count: number): string {
  const parts: string[] = [];
  for (let number = 1; number <= count; number += 1) {
    if (number < index + 1) parts.push(`Question ${number} done.`);
    else if (number === index + 1) parts.push(`Now on question ${number}.`);
    else parts.push(`Question ${number} to go.`);
  }
  return parts.join(' ');
}

export default function CheckQuiz({ lesson, content }: { lesson: Lesson; content: CheckContent }) {
  const questions = content.questions;
  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<QuestionState[]>(() => questions.map(() => FRESH));
  const promptRef = useRef<HTMLParagraphElement>(null);
  const moved = useRef(false);

  // A new question: move to it, so it is read out and in view.
  useEffect(() => {
    if (moved.current && promptRef.current) promptRef.current.focus();
  }, [index]);

  const question = questions[index];
  if (!question) {
    return <EmptyState title="The questions are not in this bag yet">Ask your facilitator.</EmptyState>;
  }
  const state = states[index] ?? FRESH;
  const last = index === questions.length - 1;
  const answered = hasAnswered(state);

  function update(next: QuestionState): void {
    setStates((list) => list.map((value, at) => (at === index ? next : value)));
  }

  function goOn(): void {
    if (!last) {
      moved.current = true;
      setIndex(index + 1);
      return;
    }
    finishLesson(lesson.id, scoreQuiz(questions, states));
    navigate(paths.lessonDone(lesson.id));
  }

  return (
    <div className="les-quiz">
      <header className="les-header">
        <div className="les-quiz__top">
          <LessonHeaderPill type="check" detail="Quiz" />
          <p className="les-quiz__place">
            Question {index + 1} of {questions.length}
          </p>
        </div>
        <div className="sb-steps" role="img" aria-label={describeQuestions(index, questions.length)}>
          {questions.map((item, at) => (
            <span key={item.id} className={cx('sb-steps__step', at < index && 'sb-steps__step--finished', at === index && 'les-step--now')} />
          ))}
        </div>
        <ListenBar src={lesson.listenUrl} className="les-header__listen" />
      </header>

      <section className="sb-card sb-card--lg sb-card--tappable les-quiz__card" aria-labelledby="les-quiz-prompt">
        <div className="les-quiz__body">
          <p id="les-quiz-prompt" ref={promptRef} tabIndex={-1} className="les-quiz__prompt">
            {question.prompt}
          </p>
          <ListenButton src={question.listenUrl} label="Listen to the question" fullWidth className="les-quiz__listen" />
        </div>
      </section>

      <p className="les-quiz__ask">Tap one answer.</p>
      <Answers
        question={question}
        state={state}
        rightWords={last ? 'Well done. You can see your result.' : 'Well done. Go to the next question.'}
        onPick={(answerId) => update(pickAnswer(question, state, answerId))}
        onTryAgain={() => update(clearPick(state))}
      />
      <Button
        fullWidth
        className="les-quiz__next"
        variant={state.solved ? 'primary' : 'secondary'}
        notReady={!answered}
        icon={last ? <IconCheckQuiz size={30} /> : undefined}
        iconAfter={last ? undefined : <IconArrowRight size={30} />}
        onClick={goOn}
      >
        {last ? 'See your result' : 'Next question'}
      </Button>

      <p className="les-note les-quiz__calm">
        <IconClock size={26} />
        No timer. Take your time.
      </p>
    </div>
  );
}
