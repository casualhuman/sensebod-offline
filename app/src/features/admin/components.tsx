/*
 * Building blocks used by several admin screens. They sit on the shared
 * tokens and components; what is here exists because the admin boards size
 * things differently from the learner screens (56px fields with a 2px edge,
 * radio rows, switches) or need something the learner side does not have
 * (file pickers, a non-link preview of the lesson card).
 */
import { useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { LessonSummary, LessonType, PublishStatus } from '@shared/api';
import {
  ButtonLook,
  Card,
  cx,
  FactsRow,
  LESSON_TYPES,
  lessonActionLabel,
  lessonPositionLabel,
  LessonTypeBadge,
  LessonTypeIcon,
  ScenePicture,
  StateChip,
  TagLine,
  takesPart,
  YouTakePart,
} from '@shared/components';
import { IconBack, IconError, IconLock, IconTick } from '@shared/icons';

/* ---- page heading ---- */

export function PageHead({ title, lead, eyebrow, children }: { title: string; lead?: ReactNode; eyebrow?: string; children?: ReactNode }) {
  return (
    <div className="adm-pagehead">
      {eyebrow ? <p className="adm-eyebrow">{eyebrow}</p> : null}
      <h1 className="adm-h1">{title}</h1>
      {lead ? <p className="adm-lead">{lead}</p> : null}
      {children}
    </div>
  );
}

/* ---- fields ---- */

interface FieldShell {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
}

function FieldFrame({ id, label, hint, error, className, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={cx('adm-field', className)}>
      <label className="adm-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <span className="adm-field__hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="adm-field__error" id={`${id}-error`} role="alert">
          <IconError size={20} />
          {error}
        </span>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  return cx(hint ? `${id}-hint` : false, error ? `${id}-error` : false) || undefined;
}

export function InputField({ label, hint, error, className, id, ...input }: FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} className={className}>
      <input type="text" {...input} id={fieldId} className="adm-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy(fieldId, hint, error)} />
    </FieldFrame>
  );
}

export function TextAreaField({ label, hint, error, className, id, ...input }: FieldShell & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} className={className}>
      <textarea {...input} id={fieldId} className="adm-textarea" aria-invalid={error ? true : undefined} aria-describedby={describedBy(fieldId, hint, error)} />
    </FieldFrame>
  );
}

export function SelectField({ label, hint, error, className, id, children, ...select }: FieldShell & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} className={className}>
      <select {...select} id={fieldId} className="adm-select" aria-invalid={error ? true : undefined} aria-describedby={describedBy(fieldId, hint, error)}>
        {children}
      </select>
    </FieldFrame>
  );
}

/* ---- big radio row ---- */

export interface OptionRowProps {
  name: string;
  value: string;
  checked: boolean;
  onChoose: (value: string) => void;
  label: string;
  detail?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/** A native radio inside a big tappable row: arrow keys, labels and forms all behave as radios do. */
export function OptionRow({ name, value, checked, onChoose, label, detail, icon, disabled }: OptionRowProps) {
  return (
    <label className={cx('adm-option', checked && 'adm-option--chosen', disabled && 'adm-option--disabled')}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChoose(value)} />
      {icon ? (
        <span className={cx('adm-disc', disabled && 'adm-disc--muted')} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="adm-option__text">
        {label}
        {detail ? <span className="adm-option__detail">{detail}</span> : null}
      </span>
      <span className="adm-option__chosen" aria-hidden="true">
        <IconTick size={20} />
        Chosen
      </span>
    </label>
  );
}

/* ---- switch ---- */

export function Switch({ label, detail, checked, onChange, disabled }: { label: string; detail?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className="adm-switch">
      <span className="adm-switch__text">
        {label}
        {detail ? <span className="adm-switch__detail">{detail}</span> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="adm-switch__state" aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
    </label>
  );
}

/* ---- lesson type words ---- */

/** "Watch" with its icon, as a small pill ("Becomes Watch"). */
export function TypeChip({ type }: { type: LessonType }) {
  return (
    <span className="adm-chip">
      <LessonTypeIcon type={type} size={18} />
      {LESSON_TYPES[type].label}
    </span>
  );
}

export function BecomesRow({ types }: { types: readonly LessonType[] }) {
  return (
    <span className="adm-chips">
      <span className="adm-chips__lead">Becomes</span>
      {types.map((type) => (
        <TypeChip key={type} type={type} />
      ))}
    </span>
  );
}

/** The automatic type rule, word for word from the boards. */
export function TypeRule() {
  return (
    <p className="adm-small">
      <strong className="adm-strong">The rule:</strong> Video → Watch · Audio or voice note → Listen · Typed text, notes, PDF, Word, photos of notes → Read · Animation package → Try it · Questions →
      Check
    </p>
  );
}

export function StatusChip({ status, placed = true }: { status: PublishStatus; placed?: boolean }) {
  if (status === 'published') {
    return (
      <span className="adm-chip adm-chip--published">
        <IconTick size={18} />
        Published
      </span>
    );
  }
  return (
    <span className="adm-chip adm-chip--draft">
      <IconLock size={18} />
      {placed ? 'Draft' : 'Draft · not on a portal yet'}
    </span>
  );
}

/* ---- the lesson card as learners see it ---- */

/**
 * The learner's lesson card, drawn from the same shared parts as the real
 * `LessonCard` and in the same order, but not a link: a draft cannot be
 * opened by learners, so a preview that navigates would lead to "not in this
 * bag". TODO(stream-1): a `preview` (non-link) mode on the shared LessonCard
 * would remove this composition (see docs/team/REQUESTS.md).
 */
export function LessonPreview({ lesson, seriesTitle }: { lesson: LessonSummary; seriesTitle?: string | null }) {
  return (
    <div className="adm-learner-view" role="group" aria-label="What learners will see">
      <p className="adm-learner-view__bar" aria-hidden="true">
        <IconBack size={20} />
        {seriesTitle || 'Lesson list'}
      </p>
      <Card className="sb-lesson-card">
        <ScenePicture picture={lesson.picture} />
        <span className="sb-card__body">
          <span className="sb-lesson-card__top">
            <LessonTypeBadge type={lesson.type} overlap />
            <span className="sb-lesson-card__tag">
              <TagLine type={lesson.type} detail={lesson.type === 'check' || lesson.position !== null ? lessonPositionLabel(lesson) : 'Lesson [n]'} />
            </span>
          </span>
          <span className="sb-lesson-card__chips">
            {takesPart(lesson) ? <YouTakePart /> : null}
            <StateChip state="not-started" />
          </span>
          <span className="sb-lesson-card__title">{lesson.title || 'Title'}</span>
          {lesson.summary ? <span className="sb-lesson-card__summary">{lesson.summary}</span> : null}
          <FactsRow tag={lesson} />
          <ButtonLook className="sb-lesson-card__action" fullWidth icon={<LessonTypeIcon type={lesson.type} size={28} />}>
            {lessonActionLabel(lesson)}
          </ButtonLook>
        </span>
      </Card>
    </div>
  );
}

/* ---- file picker ---- */

export interface FilePickerProps {
  /** What the big label says, e.g. "Choose files". */
  children: ReactNode;
  accept: string;
  multiple?: boolean;
  /** Opens the phone's camera or recorder instead of the file list (plain HTTP has no in-page camera). */
  capture?: 'environment' | 'user' | boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  disabled?: boolean;
  /** Accessible name when the label's words are not enough. */
  'aria-label'?: string;
}

/**
 * A real <input type="file"> shown as its label. The input stays in the page
 * and focusable; its value is cleared after each choice so the same file can
 * be chosen again (after "Remove", or after a failed upload).
 */
export function FilePicker({ children, accept, multiple, capture, onFiles, className, disabled, 'aria-label': ariaLabel }: FilePickerProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    const files: File[] = [];
    if (list) for (let i = 0; i < list.length; i += 1) files.push(list[i] as File);
    if (ref.current) ref.current.value = '';
    if (files.length > 0) onFiles(files);
  };
  return (
    <>
      <input ref={ref} id={id} className="adm-file" type="file" accept={accept} multiple={multiple} capture={capture} disabled={disabled} onChange={onChange} aria-label={ariaLabel} />
      <label htmlFor={id} className={cx('adm-file-label', className)} aria-disabled={disabled || undefined}>
        {children}
      </label>
    </>
  );
}

/* ---- progress ---- */

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const safe = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="adm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe} aria-label={label}>
      <span className="adm-progress__fill" style={{ width: `${safe}%` }} />
    </div>
  );
}

/* ---- confirm before something that cannot be undone ---- */

export interface ConfirmActionProps {
  /** The first button: "Delete question". */
  label: string;
  /** The question asked after the first tap. */
  question: string;
  /** The second button: "Yes, delete it". */
  confirmLabel: string;
  onConfirm: () => void;
  working?: boolean;
  icon?: ReactNode;
}

/** Two taps to delete: the first asks, the second does it. No browser dialog (they are easy to tap through). */
export function ConfirmAction({ label, question, confirmLabel, onConfirm, working, icon }: ConfirmActionProps) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="adm-mini-btn adm-mini-btn--danger" onClick={() => setAsking(true)}>
        {icon}
        {label}
      </button>
    );
  }
  return (
    <div className="adm-card adm-card--problem" role="alertdialog" aria-label={question}>
      <p className="adm-strong">{question}</p>
      <div className="adm-cluster" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="adm-mini-btn adm-mini-btn--danger"
          aria-busy={working || undefined}
          onClick={() => {
            if (!working) onConfirm();
          }}
        >
          {working ? 'Working…' : confirmLabel}
        </button>
        <button type="button" className="adm-mini-btn" onClick={() => setAsking(false)}>
          Keep it
        </button>
      </div>
    </div>
  );
}
