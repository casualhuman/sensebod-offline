/*
 * Questions (ADM-Questions): the questions an interactive video stops for
 * ("Watch and answer"), or the questions of a Check quiz. The whole set is
 * saved with one request, so add, edit, delete and reorder are a single save.
 */
import { useRef, useState } from 'react';
import { adminApi, learnerApi, type AdminLesson, type QuestionSet } from '@shared/api';
import { Button, ErrorState, LESSON_TYPES, LessonTypeIcon, LoadingState, Message, YouTakePart } from '@shared/components';
import { IconInfoMark, IconPlus, IconSave, IconTick, IconTrash } from '@shared/icons';
import { Link, paths, useParams } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { ConfirmAction, InputField, PageHead, StatusChip, Switch, TextAreaField } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { IconDiamond, IconEye, IconPhone } from '../icons';
import { useAction, useLeaveWarning } from '../lib/hooks';
import {
  addAnswer,
  firstInvalid,
  formatTime,
  fromQuestionSet,
  MAX_ANSWERS,
  MIN_ANSWERS,
  newQuestion,
  questionProblems,
  removeAnswer,
  sortByTime,
  toQuestionSet,
  type EditorQuestion,
  type QuestionProblems,
} from '../lib/questions';
import { useAdminApi } from '../session';
import './questions.css';

const PROMPT_MAX = 300;
const ANSWER_MAX = 160;
const FEEDBACK_MAX = 300;
const MAX_QUESTIONS = 20;

function Editor({ lesson, set, videoUrl }: { lesson: AdminLesson; set: QuestionSet; videoUrl: string | null }) {
  const isVideo = set.kind === 'video';
  const [questions, setQuestions] = useState<EditorQuestion[]>(() => fromQuestionSet(set));
  const [selectedId, setSelectedId] = useState<string | null>(() => set.questions[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [checked, setChecked] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  useLeaveWarning(dirty);

  const length = lesson.length;
  const selectedIndex = questions.findIndex((question) => question.id === selectedId);
  const selected = selectedIndex === -1 ? null : (questions[selectedIndex] as EditorQuestion);
  const problems: QuestionProblems = selected && checked ? questionProblems(selected, set.kind, length) : {};

  const update = (next: EditorQuestion[]) => {
    setQuestions(next);
    setDirty(true);
    setSavedOk(false);
  };
  const patch = (change: (question: EditorQuestion) => EditorQuestion) => {
    if (!selected) return;
    update(questions.map((question) => (question.id === selected.id ? change(question) : question)));
  };
  const playhead = (): number | null => {
    const video = videoRef.current;
    return video && isFinite(video.currentTime) ? Math.floor(video.currentTime) : null;
  };
  const add = () => {
    if (questions.length >= MAX_QUESTIONS) return;
    const question = newQuestion(isVideo ? (playhead() ?? 0) : null);
    update(questions.concat(question));
    setSelectedId(question.id);
    setChecked(false);
  };
  const remove = () => {
    if (!selected) return;
    const next = questions.filter((question) => question.id !== selected.id);
    update(next);
    setSelectedId(next[Math.max(0, selectedIndex - 1)]?.id ?? null);
  };

  const save = useAction(async () => {
    const ordered = isVideo ? sortByTime(questions) : questions;
    const saved = await adminApi.saveQuestions(lesson.id, toQuestionSet(lesson.id, set.kind, ordered));
    const fresh = fromQuestionSet(saved);
    setQuestions(fresh);
    // Ids may be replaced by the bag: keep the same question open by its place.
    const keep = ordered.findIndex((question) => question.id === selectedId);
    setSelectedId(fresh[keep === -1 ? 0 : keep]?.id ?? null);
    setDirty(false);
    setChecked(false);
    setSavedOk(true);
  });
  const trySave = () => {
    const bad = firstInvalid(questions, set.kind, length);
    if (bad !== -1) {
      setChecked(true);
      setSelectedId((questions[bad] as EditorQuestion).id);
      setSavedOk(false);
      return;
    }
    void save.run();
  };

  const invalidCount = checked ? questions.filter((question) => Object.keys(questionProblems(question, set.kind, length)).length > 0).length : 0;
  const correct = selected ? selected.answers.find((answer) => answer.id === selected.correctId) : undefined;
  const marks = isVideo ? sortByTime(questions) : questions;

  return (
    <>
      {isVideo ? (
        <section className="adm-card adm-stack" aria-labelledby="adm-tl-h">
          {videoUrl ? (
            // No autoplay and nothing fetched until the admin presses play.
            <video ref={videoRef} className="adm-q__video" controls preload="none" playsInline src={videoUrl}>
              <track kind="captions" />
            </video>
          ) : (
            <p className="adm-note">
              <IconInfoMark size={20} />
              <span>The video can be played here once the lesson is published. Until then, type the time each question should stop at.</span>
            </p>
          )}
          <h2 id="adm-tl-h" className="adm-h2">
            Timeline
          </h2>
          <p className="adm-small">{videoUrl ? 'Move the playhead to where the video should stop, then add a question.' : 'Each question has a stop time. Learners meet them in time order.'}</p>
        </section>
      ) : null}

      <section className="adm-card adm-stack" aria-labelledby="adm-ql-h">
        <div className="adm-row adm-row--between">
          <h2 id="adm-ql-h" className="adm-h2">
            {questions.length === 1 ? '1 question' : `${questions.length} questions`}
          </h2>
          <button type="button" className="adm-mini-btn adm-mini-btn--solid" disabled={questions.length >= MAX_QUESTIONS} onClick={add}>
            <IconPlus size={22} />
            {isVideo && videoUrl ? 'Add question here' : 'Add a question'}
          </button>
        </div>
        {questions.length === 0 ? (
          <p className="adm-small">{isVideo ? 'No questions yet. Without questions this is a plain Watch lesson.' : 'No questions yet. Add the first one.'}</p>
        ) : (
          <div className="adm-groupbar" role="group" aria-label="Questions">
            {marks.map((question) => {
              const number = questions.indexOf(question) + 1;
              return (
                <button key={question.id} type="button" aria-pressed={question.id === selectedId} onClick={() => setSelectedId(question.id)}>
                  {isVideo ? <IconDiamond size={16} /> : null} Q{number}
                  {isVideo ? ` · ${question.time || 'no time'}` : ''}
                </button>
              );
            })}
          </div>
        )}
        {isVideo ? <p className="adm-small">◆ = the video stops here for a question.</p> : null}
      </section>

      {selected ? (
        <div className="adm-split">
          <section className="adm-card adm-stack" aria-labelledby="adm-qe-h">
            <h2 id="adm-qe-h" className="adm-h2">
              Question {selectedIndex + 1} of {questions.length}
            </h2>
            {isVideo ? (
              <div className="adm-q__time">
                <InputField label="Video stops at" hint="Minutes and seconds, like 1:42." inputMode="numeric" value={selected.time} maxLength={8} error={problems.time} onChange={(event) => patch((q) => ({ ...q, time: event.target.value }))} />
                {videoUrl ? (
                  <button
                    type="button"
                    className="adm-mini-btn"
                    onClick={() => {
                      const at = playhead();
                      if (at !== null) patch((q) => ({ ...q, time: formatTime(at) }));
                    }}
                  >
                    Use playhead time
                  </button>
                ) : null}
              </div>
            ) : null}
            <TextAreaField label="Question" rows={2} maxLength={PROMPT_MAX} value={selected.prompt} error={problems.prompt} onChange={(event) => patch((q) => ({ ...q, prompt: event.target.value }))} />

            <fieldset className="adm-fieldset">
              <legend>
                <span className="adm-label">Answers</span>
                <span className="adm-small">Choose the round button next to the correct answer.</span>
              </legend>
              <div className="adm-stack">
                {selected.answers.map((answer, index) => (
                  <div key={answer.id} className="adm-q__answer">
                    <label className="adm-q__correct">
                      <input type="radio" name={`adm-correct-${selected.id}`} checked={selected.correctId === answer.id} onChange={() => patch((q) => ({ ...q, correctId: answer.id }))} />
                      <span className="sb-visually-hidden">Answer {index + 1} is the correct answer</span>
                    </label>
                    <div className="adm-row__grow">
                      <InputField
                        label={
                          <>
                            Answer {index + 1}
                            {selected.correctId === answer.id ? (
                              <span className="adm-chip adm-chip--published adm-q__tag">
                                <IconTick size={16} />
                                Correct answer
                              </span>
                            ) : null}
                          </>
                        }
                        value={answer.text}
                        maxLength={ANSWER_MAX}
                        onChange={(event) => patch((q) => ({ ...q, answers: q.answers.map((a) => (a.id === answer.id ? { ...a, text: event.target.value } : a)) }))}
                      />
                    </div>
                    <button type="button" className="adm-mini-btn adm-mini-btn--danger" disabled={selected.answers.length <= MIN_ANSWERS} aria-label={`Remove answer ${index + 1}`} onClick={() => patch((q) => removeAnswer(q, answer.id))}>
                      <IconTrash size={20} />
                    </button>
                  </div>
                ))}
              </div>
              {problems.answers || problems.correct ? (
                <p className="adm-inline-error" role="alert">
                  {problems.answers ?? problems.correct}
                </p>
              ) : null}
              <button type="button" className="adm-mini-btn" style={{ marginTop: 10 }} disabled={selected.answers.length >= MAX_ANSWERS} onClick={() => patch(addAnswer)}>
                <IconPlus size={22} />
                Add an answer
              </button>
            </fieldset>

            <TextAreaField label="Feedback when right" rows={2} maxLength={FEEDBACK_MAX} value={selected.feedbackRight} error={problems.feedbackRight} onChange={(event) => patch((q) => ({ ...q, feedbackRight: event.target.value }))} />
            <TextAreaField label="Feedback when wrong" rows={2} maxLength={FEEDBACK_MAX} value={selected.feedbackWrong} error={problems.feedbackWrong} onChange={(event) => patch((q) => ({ ...q, feedbackWrong: event.target.value }))} />
            {isVideo ? <Switch label="Pause the video until answered" detail="Learners must answer before the video goes on." checked={selected.pauseUntilAnswered} onChange={(value) => patch((q) => ({ ...q, pauseUntilAnswered: value }))} /> : null}
            <Switch label="Let learners try again" detail="After a wrong answer they can choose again." checked={selected.allowRetry} onChange={(value) => patch((q) => ({ ...q, allowRetry: value }))} />
            <ConfirmAction label="Delete question" question="Delete this question? The video itself is not changed." confirmLabel="Yes, delete it" onConfirm={remove} icon={<IconTrash size={20} />} />
            <p className="adm-small">A deleted question is gone for learners after you tap Save.</p>
          </section>

          <aside className="adm-split__aside adm-card adm-stack" aria-labelledby="adm-hl-h">
            <h2 id="adm-hl-h" className="adm-h2 adm-row">
              <IconPhone size={26} />
              <span>How learners see it</span>
            </h2>
            <p className="adm-small">{isVideo ? 'The card appears over the paused video. Here the right answer has been chosen.' : 'Here the right answer has been chosen.'}</p>
            <div className="adm-q__preview">
              <p className="adm-small adm-strong">
                Question {selectedIndex + 1} of {questions.length}
              </p>
              <p className="adm-h3">{selected.prompt || 'Your question'}</p>
              <ul className="adm-list">
                {selected.answers.map((answer) => (
                  <li key={answer.id} className={answer.id === selected.correctId ? 'adm-q__choice adm-q__choice--right' : 'adm-q__choice'}>
                    {answer.id === selected.correctId ? <IconTick size={22} /> : null}
                    <span>
                      <strong>{answer.text || 'Answer'}</strong>
                      {answer.id === selected.correctId && selected.feedbackRight ? <span className="adm-q__why">Yes, that is right. {selected.feedbackRight}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              {!correct ? <p className="adm-small">No correct answer chosen yet.</p> : null}
            </div>
          </aside>
        </div>
      ) : null}

      {invalidCount > 0 ? (
        <Message tone="error" title={invalidCount === 1 ? '1 question is not finished' : `${invalidCount} questions are not finished`}>
          The first one is open above. Fix what is marked in red, then save.
        </Message>
      ) : null}
      {save.error ? (
        <Message tone="error" title="The questions were not saved">
          {save.error} Your changes are still on this page.
        </Message>
      ) : null}
      {savedOk ? (
        <Message tone="success" title="Saved in this bag">
          Learners see the change next time they open the lesson.
        </Message>
      ) : null}
      <div className="adm-cluster">
        {dirty ? (
          <Button working={save.working} workingLabel="Saving…" icon={<IconSave size={26} />} onClick={trySave}>
            Save
          </Button>
        ) : (
          <Button notReady icon={<IconSave size={26} />}>
            Nothing to save
          </Button>
        )}
        {lesson.status === 'published' ? (
          <Link to={paths.lesson(lesson.id)} className="adm-mini-btn">
            <IconEye size={22} />
            Test as learner
          </Link>
        ) : null}
      </div>
    </>
  );
}

export default function Questions() {
  const { lessonId } = useParams<'lessonId'>();
  const loaded = useAdminApi(
    async (signal) => {
      const [lesson, set] = await Promise.all([adminApi.getAdminLesson(lessonId, { signal }), adminApi.getQuestions(lessonId, { signal })]);
      // TODO(stream-1): the admin API has no media URL for a lesson (docs/team/REQUESTS.md).
      // The learner endpoint has it, but only once the lesson is published; a draft simply has no player here.
      let videoUrl: string | null = null;
      if (set.kind === 'video' && lesson.status === 'published') {
        try {
          const full = await learnerApi.getLesson(lessonId, { signal });
          const source = full.content.type === 'watch' ? full.content.sources[0] : undefined;
          if (source && source.url.charAt(0) === '/' && source.url.charAt(1) !== '/') videoUrl = source.url;
        } catch {
          videoUrl = null;
        }
      }
      return { lesson, set, videoUrl };
    },
    [lessonId],
  );
  const data = loaded.data && loaded.data.lesson.id === lessonId ? loaded.data : null;
  const back = { to: adminPaths.library(data && data.lesson.placement ? { portalId: data.lesson.placement.portalId, groupId: data.lesson.placement.groupId, seriesId: data.lesson.placement.seriesId } : {}), label: 'Back to Library' };

  if (!data) {
    return (
      <AdminFrame title="Questions" nav="library" back={back}>
        {loaded.error ? (
          <ErrorState title={loaded.error.status === 409 ? 'This lesson has no questions' : 'The questions did not open'} error={loaded.error} onRetry={loaded.error.status === 409 ? undefined : loaded.reload} />
        ) : (
          <LoadingState label="Opening the questions…" />
        )}
      </AdminFrame>
    );
  }
  const { lesson, set, videoUrl } = data;
  return (
    <AdminFrame title={`${lesson.title} · Questions`} nav="library" wide back={back}>
      <div className="adm-chips">
        <span className="adm-chip">
          <LessonTypeIcon type={lesson.type} size={18} />
          {LESSON_TYPES[lesson.type].label}
        </span>
        {lesson.position ? <span className="adm-chip">Lesson {lesson.position}</span> : null}
        {lesson.interactive && lesson.type !== 'check' ? <YouTakePart /> : null}
        <StatusChip status={lesson.status} placed={lesson.placement !== null} />
      </div>
      <PageHead title={`${lesson.title} · Questions`} lead={set.kind === 'video' ? 'The video stops at each ◆ and asks the learner a question.' : 'A short quiz at the end of the series. No timer, and every answer says why.'} />
      <Editor key={lesson.id} lesson={lesson} set={set} videoUrl={videoUrl} />
    </AdminFrame>
  );
}
