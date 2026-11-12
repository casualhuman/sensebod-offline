/*
 * "Where is your content from?" (ADM-Source on a laptop; on a phone the same
 * four sources as on ADM-M-Home, opened by the Add tab).
 */
import { useRef, useState, type DragEvent } from 'react';
import { adminApi, newRequestKey } from '@shared/api';
import { Button, ButtonLink, LESSON_TYPES, LessonTypeIcon, YouTakePart } from '@shared/components';
import { IconPlus, IconQuestion, IconUpload } from '@shared/icons';
import { navigate } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { BecomesRow, FilePicker, InputField, PageHead, TypeRule } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { titleProblem } from '../lib/files';
import { flowSteps, handOverFiles } from '../lib/flow';
import { useAction, useIsLaptop } from '../lib/hooks';
import { CONTENT_SOURCES, SourceCards } from './SourceCards';
import './home.css';

const TYPE_NOTES = [
  { type: 'watch', what: 'A video', detail: '.mp4 and other videos. Learners tap “Watch video”.' },
  { type: 'listen', what: 'Audio or a voice note', detail: 'Voice notes (.opus), .mp3. Converted so all phones can play it.' },
  { type: 'read', what: 'Something to read', detail: 'Typed text, notes, PDF, Word, photos of notes. Learners tap “Read”.' },
  { type: 'try', what: 'An animation package', detail: '.zip with index.html, made by EasySTEM. Learners tap “Start”.' },
  { type: 'check', what: 'Questions', detail: 'Built with “Questions and quiz”. Learners tap “Start the quiz”.' },
] as const;

/** "Build an interactive lesson": start a Check quiz; questions in a video start from the Library. */
function QuizStarter() {
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // One key for this form: a second try after a lost answer returns the same quiz, never a second one.
  const requestKey = useRef(newRequestKey());
  const create = useAction(async () => {
    const lesson = await adminApi.createLesson({ source: 'questions', title: title.trim() }, { idempotencyKey: requestKey.current });
    navigate(adminPaths.questions(lesson.id));
  });
  const start = () => {
    const found = titleProblem(title, 'a name for the quiz');
    setProblem(found);
    if (!found) void create.run();
  };
  return (
    <article className="adm-card adm-stack" aria-labelledby="adm-quiz-h">
      <div className="adm-row adm-row--top">
        <span className="adm-disc adm-disc--lg" aria-hidden="true">
          <IconQuestion size={30} />
        </span>
        <div className="adm-row__grow">
          <h2 id="adm-quiz-h" className="adm-h3">
            Build an interactive lesson
          </h2>
          <p className="adm-small">Learners take part: answer questions during a video (“Watch and answer”) or a quiz at the end of a series. Best done on this laptop.</p>
        </div>
      </div>
      <InputField
        label="Name of the quiz"
        hint="For questions inside a video, open the video in the Library and choose Questions."
        value={title}
        maxLength={120}
        error={problem ?? create.error}
        onChange={(event) => {
          setTitle(event.target.value);
          // A different name is a different quiz.
          requestKey.current = newRequestKey();
        }}
      />
      <Button size="sm" icon={<IconPlus size={24} />} working={create.working} workingLabel="Starting the quiz…" onClick={start}>
        Build questions and quiz
      </Button>
    </article>
  );
}

export default function AddSource() {
  const laptop = useIsLaptop();
  const [over, setOver] = useState(false);

  const sendFiles = (files: File[]) => {
    handOverFiles(files);
    navigate(adminPaths.addUpload());
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const list = event.dataTransfer.files;
    const files: File[] = [];
    for (let i = 0; i < list.length; i += 1) files.push(list[i] as File);
    if (files.length > 0) sendFiles(files);
  };

  if (!laptop) {
    return (
      <AdminFrame title="Add content" nav="add" back={{ to: adminPaths.home(), label: 'Back to Home' }}>
        <PageHead title="Add content" lead="Where is it coming from?" />
        <SourceCards />
      </AdminFrame>
    );
  }

  return (
    <AdminFrame title="Add content" nav="add" wide steps={flowSteps('source', true)}>
      <PageHead title="Where is your content from?" lead="Start with what you have. You choose the portal next." />

      <ul className="adm-grid adm-grid--4 adm-list">
        {CONTENT_SOURCES.map((source) => (
          <li key={source.key} style={{ marginTop: 0 }}>
            <article className="adm-card adm-source-card">
              <span className="adm-disc adm-disc--lg" aria-hidden="true">
                {source.icon(32)}
              </span>
              <h2 className="adm-h3">{source.title}</h2>
              <p className="adm-small">{source.long}</p>
              <span className="adm-chips">
                {source.accepts.map((word) => (
                  <span key={word} className="adm-chip">
                    {word}
                  </span>
                ))}
              </span>
              <span className="adm-source-card__becomes">
                <BecomesRow types={source.becomes} />
                {source.key === 'animation' ? <YouTakePart /> : null}
              </span>
              <span className="adm-source-card__action">
                <ButtonLink to={source.to} size="sm" fullWidth>
                  {source.action}
                </ButtonLink>
              </span>
            </article>
          </li>
        ))}
      </ul>

      <QuizStarter />

      <div
        className={over ? 'adm-drop adm-drop--over' : 'adm-drop'}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p className="adm-h3">Or drop files here</p>
        <p className="adm-small">Drag files from your laptop onto this box. Videos, audio, PDF, Word or photos. We set the lesson type for you.</p>
        <FilePicker accept="video/*,audio/*,.opus,.ogg,.amr,.pdf,.doc,.docx,image/*" multiple onFiles={sendFiles} className="adm-mini-btn">
          <IconUpload size={22} />
          Choose files
        </FilePicker>
      </div>

      <section aria-labelledby="adm-rule-h" className="adm-card adm-stack">
        <h2 id="adm-rule-h" className="adm-h2">
          We set the lesson type for you
        </h2>
        <p className="adm-small">It comes from what you add. You can change it before you publish.</p>
        <TypeRule />
        <ul className="adm-grid adm-grid--4 adm-list">
          {TYPE_NOTES.map((note) => (
            <li key={note.type} style={{ marginTop: 0 }}>
              <p className="adm-row adm-strong">
                <span className={note.type === 'listen' ? 'adm-disc adm-disc--sm adm-disc--listen' : 'adm-disc adm-disc--sm'} aria-hidden="true">
                  <LessonTypeIcon type={note.type} size={18} />
                </span>
                <span>{LESSON_TYPES[note.type].label}</span>
              </p>
              <p className="adm-strong">{note.what}</p>
              <p className="adm-small">{note.detail}</p>
            </li>
          ))}
        </ul>
        <p className="adm-small">
          <YouTakePart /> is added for you on Try it lessons and on videos with questions (“Watch and answer”).
        </p>
      </section>
    </AdminFrame>
  );
}
