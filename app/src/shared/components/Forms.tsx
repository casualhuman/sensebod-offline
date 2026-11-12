import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { IconError, IconTick } from '../icons';
import { Link } from '../router';
import { cx } from './cx';

interface FieldBase {
  /** Always visible above the input. Placeholders are not labels. */
  label: string;
  /** Extra help under the label. */
  hint?: string;
  /** Problem with what was typed, in plain words. Shown with an icon and announced. */
  error?: string;
  className?: string;
}

export interface TextFieldProps extends FieldBase, Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {}

/** Labelled 64px text input. */
export function TextField({ label, hint, error, className, id, ...input }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cx('sb-field', error && 'sb-field--error', className)}>
      <label className="sb-field__label" htmlFor={inputId}>
        {label}
      </label>
      {hint ? (
        <span className="sb-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      <input
        type="text"
        {...input}
        id={inputId}
        className="sb-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={cx(hintId, errorId) || undefined}
      />
      {error ? (
        <span className="sb-field__error" id={errorId} role="alert">
          <IconError size={22} />
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface TextAreaProps extends FieldBase, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {}

/** Labelled multi-line input (admin "Type it yourself", question text). */
export function TextArea({ label, hint, error, className, id, ...input }: TextAreaProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cx('sb-field', error && 'sb-field--error', className)}>
      <label className="sb-field__label" htmlFor={inputId}>
        {label}
      </label>
      {hint ? (
        <span className="sb-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      <textarea
        {...input}
        id={inputId}
        className="sb-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={cx(hintId, errorId) || undefined}
      />
      {error ? (
        <span className="sb-field__error" id={errorId} role="alert">
          <IconError size={22} />
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
  /** Second line in regular weight. */
  detail?: string;
  /** Shown in the round mark when not chosen: a letter ("A") or a 28px icon. */
  mark?: ReactNode;
}

export interface ChoiceGroupProps<V extends string> {
  /** Accessible name of the group ("Who are you?", "Answers"). */
  label: string;
  options: readonly ChoiceOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  /** Words shown on the chosen row, e.g. "Your answer", "Chosen". */
  chosenNote?: string;
  /** 64px rows instead of 80px. */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * One-of-many choice as big rows: quiz answers, "Who are you?", admin
 * pickers. Default 2px edge on white; chosen = 4px accent edge on the tint
 * plus a tick and words, so it never depends on colour alone.
 * Every row is its own tab stop (touch, TalkBack and Tab all reach each
 * one); on a keyboard the arrow keys also move to and choose the next or
 * previous row, as radio buttons do.
 */
export function ChoiceGroup<V extends string>({ label, options, value, onChange, chosenNote, compact, disabled, className }: ChoiceGroupProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('sb-choices', className)}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0 || disabled || options.length === 0) return;
        const rows = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
        let from = -1;
        for (let i = 0; i < rows.length; i += 1) {
          if (rows[i] === document.activeElement) from = i;
        }
        if (from < 0) return;
        event.preventDefault();
        const to = (from + step + options.length) % options.length;
        const row = rows[to];
        const option = options[to];
        if (row) row.focus();
        if (option) onChange(option.value);
      }}
    >
      {options.map((option, index) => {
        const chosen = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={disabled}
            className={cx('sb-choice', compact && 'sb-choice--compact')}
            onClick={() => onChange(option.value)}
          >
            <span className="sb-choice__mark" aria-hidden="true">
              {chosen ? <IconTick size={28} /> : (option.mark ?? String.fromCharCode(65 + index))}
            </span>
            <span className="sb-choice__text">
              {option.label}
              {option.detail ? <span className="sb-choice__detail">{option.detail}</span> : null}
            </span>
            {chosen && chosenNote ? <span className="sb-choice__note">{chosenNote}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface ChoiceLinkProps {
  to: string;
  label: string;
  detail?: string;
  mark: ReactNode;
  onClick?: () => void;
}

/** A row that looks like a choice and goes somewhere (the name rows on Save my progress). */
export function ChoiceLink({ to, label, detail, mark, onClick }: ChoiceLinkProps) {
  return (
    <Link to={to} className="sb-choice" onClick={onClick}>
      <span className="sb-choice__mark" aria-hidden="true">
        {mark}
      </span>
      <span className="sb-choice__text">
        {label}
        {detail ? <span className="sb-choice__detail">{detail}</span> : null}
      </span>
    </Link>
  );
}
