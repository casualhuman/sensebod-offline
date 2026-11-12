import { useEffect, useRef, type ReactNode } from 'react';
import type { ThemeName } from '../api/types';
import { ButtonLink } from '../components/Button';
import { LanguageSwitch } from '../components/Chips';
import { cx } from '../components/cx';
import { IconBack, IconHome, IconLeave } from '../icons';
import { Link, paths, useLocation } from '../router';
import { clearSensitiveChoices } from '../session';
import { stopListening } from './listen';
import { ListenButton } from './ListenButton';

export interface PageShellProps {
  /** Browser tab title; " · Sensebod" is added. Also announced to screen readers after navigation. */
  title: string;
  /** 'agriculture' turns the accent green and the page #F3F8F4 for this screen. */
  theme?: ThemeName;
  /**
   * 'home': logo + language only (the gateway).
   * 'inner' (default): Back + Home on every inner screen.
   */
  variant?: 'home' | 'inner';
  /** Where Back goes: the parent screen, as a path. Required on inner screens. */
  backTo?: string;
  /**
   * Child protection screens: adds "Leave this page" (quick exit to Home),
   * keeps the header on screen while scrolling.
   */
  quickExit?: boolean;
  /**
   * Narration for the Listen button. From tablet width up the shell shows
   * Listen (and the language switch) in the header; on phones the page
   * places <ListenBar src=… /> under its title. Leave undefined to show no
   * Listen button in the header (for example admin screens).
   */
  listenSrc?: string | null;
  /** Hide the EasySTEM footer (full-height players, admin). */
  noFooter?: boolean;
  /** Let the content run edge to edge; the page then adds its own .sb-container. */
  flush?: boolean;
  children: ReactNode;
}

let firstScreen = true;

function quickExit(): void {
  // Stop any sound, forget the audience choice, and replace this history
  // entry so one press of Back does not return to the page just left.
  stopListening();
  clearSensitiveChoices();
}

/**
 * The frame around every learner screen: header with Back, Home and Listen,
 * the Child protection quick exit, the main area and the footer. Responsive
 * for phone (390), tablet (800) and laptop (1440) widths.
 */
export function PageShell({ title, theme = 'blue', variant = 'inner', backTo, quickExit: hasQuickExit = false, listenSrc, noFooter = false, flush = false, children }: PageShellProps) {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const showListen = listenSrc !== undefined;

  useEffect(() => {
    document.title = `${title} · Sensebod`;
  }, [title]);

  // After in-app navigation move focus to the main area so keyboard and
  // screen-reader users start at the new screen, not at the old link.
  useEffect(() => {
    if (firstScreen) {
      firstScreen = false;
      return;
    }
    const main = mainRef.current;
    if (main) main.focus();
  }, [pathname]);

  const logo = <img className="sb-shell__logo" src="/brand/sensebod-logo.png" alt="Sensebod" width="113" height="34" />;
  const backHome = (
    <>
      <ButtonLink to={backTo ?? paths.home()} variant="secondary" className="sb-shell__nav-btn" icon={<IconBack size={28} />}>
        Back
      </ButtonLink>
      <ButtonLink to={paths.home()} variant="secondary" className="sb-shell__nav-btn" icon={<IconHome size={28} />}>
        Home
      </ButtonLink>
    </>
  );
  const headerListen = showListen ? <ListenButton src={listenSrc} size="sm" className="sb-shell__listen sb-from-tablet" /> : null;

  const spacer = <span className="sb-shell__spacer" />;

  let header: ReactNode;
  if (variant === 'home') {
    header = (
      <div className="sb-shell__bar">
        {logo}
        {spacer}
        {headerListen}
        <LanguageSwitch />
      </div>
    );
  } else if (hasQuickExit) {
    header = (
      <>
        <div className="sb-shell__bar">
          {logo}
          {spacer}
          <LanguageSwitch className="sb-from-tablet" />
          <ButtonLink to={paths.home()} replace variant="exit" className="sb-shell__exit" icon={<IconLeave size={28} />} onClick={quickExit}>
            Leave this page
          </ButtonLink>
        </div>
        <nav className="sb-shell__bar sb-shell__bar--nav" aria-label="Go back">
          {backHome}
          {spacer}
          {headerListen}
        </nav>
      </>
    );
  } else {
    header = (
      <nav className="sb-shell__bar sb-shell__bar--nav" aria-label="Go back">
        {backHome}
        {spacer}
        {showListen ? <LanguageSwitch className="sb-from-tablet" /> : null}
        {headerListen}
        <Link to={paths.home()} className="sb-shell__logo-link" aria-label="Sensebod home">
          {logo}
        </Link>
      </nav>
    );
  }

  return (
    <div className="sb-shell" data-theme={theme === 'agriculture' ? 'agriculture' : undefined}>
      <a className="sb-skip-link" href="#sb-main">
        Skip to the main part
      </a>
      <header className={cx('sb-shell__header', hasQuickExit && 'sb-shell__header--sticky', variant === 'inner' && !hasQuickExit && 'sb-shell__header--single')}>
        {header}
      </header>
      <main id="sb-main" ref={mainRef} tabIndex={-1} className={cx('sb-shell__main', flush && 'sb-shell__main--flush')}>
        {children}
      </main>
      {noFooter ? null : (
        <footer className="sb-shell__footer">
          <img src="/brand/easystem-logo.png" alt="EasySTEM" width="74" height="32" loading="lazy" />
          <p className="sb-shell__motto" lang="kri">
            Wi dae make u sensebod
          </p>
        </footer>
      )}
    </div>
  );
}
