/*
 * The frame around every signed-in admin screen.
 *
 * Phone and tablet (below 1100px), from the ADM-M-* boards: top bar with the
 * logo, the "Admin" pill and a labelled Menu button; the "Saved on this bag"
 * line; Back and the step bar; the screen; then a bar that stays at the
 * bottom with the screen's main action above four labelled tabs
 * (Home · Add · Library · Menu).
 *
 * Laptop (from 1100px), from the ADM-* boards: side menu with the same
 * destinations, the bag status, who is signed in and Sign out; the screen
 * beside it.
 *
 * The shared PageShell is the learner frame (Back, Home, Listen, footer);
 * the admin chrome is this file, as the foundation report says.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '@shared/components';
import { IconBack, IconClose, IconHome, IconPerson } from '@shared/icons';
import { Link, useLocation } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { IconAddCircle, IconLearners, IconLibrary, IconMenuGrid, IconSaved, IconSeriesOrder, IconSettings, IconSignOut, IconStorage } from '../icons';
import { useAction, useIsLaptop } from '../lib/hooks';
import { signOutAdmin, useAdminSession } from '../session';
import '../admin.css';

export type AdminNavKey = 'home' | 'add' | 'library' | 'series' | 'learners' | 'storage' | 'settings' | 'menu';

export interface AdminSteps {
  /** 1-based. */
  current: number;
  /** One short label per step: ["Add it", "Where it goes", "Check and publish"]. */
  labels: readonly string[];
}

export interface AdminFrameProps {
  /** Browser title; " · Sensebod admin" is added. */
  title: string;
  /** Which destination is marked "you are here" in the tabs and the side menu. */
  nav?: AdminNavKey;
  /** Where Back goes: always the parent screen, stated by the screen. */
  back?: { to: string; label?: string };
  steps?: AdminSteps;
  /** The screen's main action. Stays at the bottom of the screen, above the tabs. */
  action?: ReactNode;
  /** Wider content column on laptops (tables, editors with a preview beside them). */
  wide?: boolean;
  /** The jumbo menu itself: the top-right button reads "Close" and goes here. */
  closeTo?: string;
  children: ReactNode;
}

let firstScreen = true;

const SIDE_ITEMS: { key: AdminNavKey; label: string; to: () => string; Icon: typeof IconLibrary }[] = [
  { key: 'library', label: 'Library', to: () => adminPaths.library(), Icon: IconLibrary },
  { key: 'add', label: 'Add content', to: adminPaths.add, Icon: IconAddCircle },
  { key: 'series', label: 'Series and order', to: () => adminPaths.series(), Icon: IconSeriesOrder },
  { key: 'learners', label: 'Learners and progress', to: adminPaths.learners, Icon: IconLearners },
  { key: 'storage', label: 'Storage and backup', to: adminPaths.storage, Icon: IconStorage },
  { key: 'settings', label: 'Settings', to: adminPaths.settings, Icon: IconSettings },
];

const TABS: { key: AdminNavKey; label: string; to: () => string; Icon: typeof IconLibrary }[] = [
  { key: 'home', label: 'Home', to: adminPaths.home, Icon: IconHome },
  { key: 'add', label: 'Add', to: adminPaths.add, Icon: IconAddCircle },
  { key: 'library', label: 'Library', to: () => adminPaths.library(), Icon: IconLibrary },
  { key: 'menu', label: 'Menu', to: () => adminPaths.menu(), Icon: IconMenuGrid },
];

/** The three-part bar with its labels (ADM-M-Place). The words "Step 2 of 3" sit beside Back. */
export function StepBar({ steps }: { steps: AdminSteps }) {
  return (
    <ol className="adm-steps" aria-label="Steps">
      {steps.labels.map((label, index) => {
        const number = index + 1;
        const state = number < steps.current ? 'done' : number === steps.current ? 'current' : 'next';
        return (
          <li key={label} className={cx('adm-steps__step', `adm-steps__step--${state}`)} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="adm-steps__bar" aria-hidden="true" />
            <span className="adm-steps__label">
              {label}
              <span className="sb-visually-hidden">{state === 'done' ? ' (done)' : state === 'current' ? ' (you are here)' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** "Saved on this bag". */
export function SavedLine({ children }: { children?: ReactNode }) {
  return (
    <p className="adm-saved">
      <IconSaved size={20} />
      <span>{children ?? 'Saved on this bag'}</span>
    </p>
  );
}

function SignOutButton({ className }: { className?: string }) {
  const signOut = useAction(signOutAdmin);
  return (
    <>
      <button type="button" className={className ?? 'adm-link-btn'} aria-busy={signOut.working || undefined} onClick={() => void signOut.run()}>
        <IconSignOut size={20} />
        {signOut.working ? 'Signing out…' : 'Sign out'}
      </button>
      {signOut.error ? (
        <p className="adm-inline-error" role="alert">
          You are still signed in. {signOut.error}
        </p>
      ) : null}
    </>
  );
}

export { SignOutButton };

export function AdminFrame({ title, nav, back, steps, action, wide, closeTo, children }: AdminFrameProps) {
  const laptop = useIsLaptop();
  const { session } = useAdminSession();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = `${title} · Sensebod Offline admin`;
  }, [title]);

  // After in-app navigation, keyboard and screen-reader users start at the new screen.
  useEffect(() => {
    if (firstScreen) {
      firstScreen = false;
      return;
    }
    if (mainRef.current) mainRef.current.focus();
  }, [pathname]);

  const logo = (
    <span className="adm-brand">
      <img className="adm-logo" src="/brand/sensebod-logo.png" alt="Sensebod" width="107" height="32" />
      <span className="adm-brand__tag">Offline</span>
    </span>
  );
  const pill = <span className="adm-pill">Admin</span>;
  const backLink = back ? (
    <Link to={back.to} className="adm-back">
      <IconBack size={24} />
      {back.label ?? 'Back'}
    </Link>
  ) : null;

  const content = (
    <>
      {backLink || steps ? (
        <div className="adm-context">
          <div className="adm-context__row">
            {backLink}
            {steps ? (
              <p className="adm-context__count">
                Step {steps.current} of {steps.labels.length}
              </p>
            ) : null}
          </div>
          {steps ? <StepBar steps={steps} /> : null}
        </div>
      ) : null}
      {children}
    </>
  );

  if (laptop) {
    return (
      <div className="adm-frame adm-frame--laptop">
        <a className="sb-skip-link" href="#adm-main">
          Skip to the main part
        </a>
        <aside className="adm-side">
          <Link to={adminPaths.home()} className="adm-side__brand" aria-label="Sensebod Offline admin home">
            {logo}
            {pill}
          </Link>
          <nav aria-label="Admin menu">
            <ul className="adm-side__list">
              {SIDE_ITEMS.map(({ key, label, to, Icon }) => (
                <li key={key}>
                  <Link to={to()} className="adm-side__link" aria-current={nav === key ? 'page' : undefined}>
                    <Icon size={24} />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="adm-side__status">
            <p className="adm-side__status-main">
              <IconSaved size={22} />
              Running on this bag
            </p>
          </div>
          <div className="adm-side__who">
            <span className="adm-side__name">
              <IconPerson size={22} />
              {session ? session.displayName : ''}
            </span>
            <SignOutButton />
          </div>
        </aside>
        <div className="adm-body">
          <main id="adm-main" ref={mainRef} tabIndex={-1} className={cx('adm-main', wide && 'adm-main--wide')}>
            {content}
          </main>
          {action ? <div className="adm-actionbar">{action}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="adm-frame">
      <a className="sb-skip-link" href="#adm-main">
        Skip to the main part
      </a>
      <header className="adm-top">
        <div className="adm-top__bar">
          <Link to={adminPaths.home()} className="adm-top__brand" aria-label="Sensebod Offline admin home">
            {logo}
            {pill}
          </Link>
          {closeTo ? (
            <Link to={closeTo} className="adm-menu-btn">
              <IconClose size={22} />
              Close
            </Link>
          ) : (
            <Link to={adminPaths.menu(nav)} className="adm-menu-btn">
              <IconMenuGrid size={22} />
              Menu
            </Link>
          )}
        </div>
        <SavedLine />
      </header>
      <main id="adm-main" ref={mainRef} tabIndex={-1} className={cx('adm-main', wide && 'adm-main--wide')}>
        {content}
      </main>
      <div className="adm-bottom">
        {action ? <div className="adm-actionbar">{action}</div> : null}
        <nav aria-label="Admin sections" className="adm-tabs">
          <ul className="adm-tabs__list">
            {TABS.map(({ key, label, to, Icon }) => (
              <li key={key}>
                <Link to={key === 'menu' && nav !== 'menu' ? adminPaths.menu(nav) : to()} className="adm-tabs__tab" aria-current={nav === key ? 'page' : undefined}>
                  <Icon size={26} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
