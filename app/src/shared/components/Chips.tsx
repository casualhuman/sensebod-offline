import type { ReactNode } from 'react';
import type { LanguageCode } from '../api/types';
import { IconBagTick } from '../icons';
import { Link } from '../router';
import { setLanguage, useSession } from '../session';
import { cx } from './cx';

export interface PersonChipProps {
  /** The first letter of the name is drawn when no icon is given. */
  name?: string;
  /** Icon for the round mark instead of a letter (e.g. the audience icon). */
  icon?: ReactNode;
  /** The sentence: <>Learning as <strong>Aminata</strong></>. */
  children: ReactNode;
  /** Where "Change" goes. Left out, there is no action. */
  changeTo?: string;
  changeLabel?: string;
  className?: string;
}

/** Pill row: "Learning as Aminata · Change", "You chose: I am a child · Change". */
export function PersonChip({ name, icon, children, changeTo, changeLabel = 'Change', className }: PersonChipProps) {
  return (
    <div className={cx('sb-chip-row', className)}>
      <span className="sb-chip-row__avatar" aria-hidden="true">
        {icon ?? (name ? name.charAt(0).toUpperCase() : '')}
      </span>
      <span className="sb-chip-row__text">{children}</span>
      {changeTo ? (
        <Link to={changeTo} className="sb-chip-row__action">
          {changeLabel}
        </Link>
      ) : null}
    </div>
  );
}

const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'kri', label: 'Krio' },
];

/**
 * Language · words, not flags. Stores the choice for this phone (see
 * shared/session). Screen text is English until translations are delivered;
 * the choice is already remembered and available through useSession().language.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { language } = useSession();
  return (
    <div role="group" aria-label="Language" className={cx('sb-lang', className)}>
      {LANGUAGES.map(({ code, label }) => (
        <button key={code} type="button" className="sb-lang__option" aria-pressed={language === code} lang={code} onClick={() => setLanguage(code)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Reassurance strip: "Everything here is in this bag. No internet needed." */
export function InfoStrip({ children, icon, className }: { children?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cx('sb-info-strip', className)}>
      {icon ?? <IconBagTick size={36} />}
      <p>
        {children ?? (
          <>
            Everything here is in this bag. <strong>No internet needed.</strong>
          </>
        )}
      </p>
    </div>
  );
}
