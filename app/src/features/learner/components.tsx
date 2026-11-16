/*
 * Pieces the learner browsing screens share. Everything here is composed
 * from @shared/components; only layout that the shared catalogue does not
 * have (hero card, step heading, class picker) is styled locally (learner.css).
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { ContinueLesson, Picture, PortalId, ThemeName } from '@shared/api';
import {
  Badge,
  ButtonLink,
  Card,
  cx,
  EmptyState,
  ErrorState,
  LessonCard,
  LoadingState,
  Message,
  PersonChip,
  ScenePicture,
  SuccessState,
  type PictureShape,
} from '@shared/components';
import { IconHelp, IconHome, IconPerson, IconPersonAdd } from '@shared/icons';
import { paths, useLocation } from '@shared/router';
import { useSession } from '@shared/session';
import { ListenBar, PageShell } from '@shared/shell';
import { CHILD_PROTECTION, firstName, peekLearnerNotice, saveProgressPath, setLearnerNotice, type LearnerNotice } from './lib';

/* ------------------------------------------------------------------ */
/* Whole-screen states                                                 */
/* ------------------------------------------------------------------ */

/** What the shell needs before any data has arrived, read from the URL. */
export function shellPropsFor(portalId: string | undefined): { theme: ThemeName; quickExit: boolean } {
  return { theme: portalId === 'agriculture' ? 'agriculture' : 'blue', quickExit: portalId === CHILD_PROTECTION };
}

/** A URL that points at nothing in this bag. Same words as the app's own "not found" screen. */
export function NotInBag({ portalId }: { portalId?: string }) {
  return (
    <PageShell title="Page not found" backTo={paths.home()} {...shellPropsFor(portalId)}>
      <EmptyState
        title="This page is not in this bag"
        action={
          <ButtonLink to={paths.home()} fullWidth icon={<IconHome size={28} />}>
            Go to Home
          </ButtonLink>
        }
      >
        The page you asked for could not be found.
      </EmptyState>
    </PageShell>
  );
}

export interface ScreenStateProps {
  title: string;
  backTo: string;
  portalId?: string;
  loadingLabel?: string;
  error: unknown;
  onRetry: () => void;
}

/**
 * Loading and error states for a screen whose data has not arrived. The
 * shell is already the right one (green for Agriculture; Leave this page on
 * Child protection), so the page does not change colour or lose the quick
 * exit while it loads or when it fails.
 */
export function ScreenState({ title, backTo, portalId, loadingLabel, error, onRetry }: ScreenStateProps) {
  if (error && typeof error === 'object' && (error as { status?: number }).status === 404) return <NotInBag portalId={portalId} />;
  return (
    <PageShell title={title} backTo={backTo} {...shellPropsFor(portalId)}>
      {error ? (
        <ErrorState
          error={error}
          onRetry={onRetry}
          action={
            <ButtonLink to={backTo} variant="secondary" fullWidth className="lrn-gap-top">
              Go back
            </ButtonLink>
          }
        />
      ) : (
        <LoadingState label={loadingLabel ?? 'Opening…'} />
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Hero card at the top of a portal, series or help page               */
/* ------------------------------------------------------------------ */

export interface HeroProps {
  description?: string;
  /** Small accent line: where this page sits ("Climate"). */
  eyebrow?: string;
  picture: Picture | null;
  pictureShape?: PictureShape;
  /** Icon for the round badge. */
  icon: ReactNode;
  listenSrc: string | null;
}

/**
 * A short strip at the top of a portal, series or help page: a small scene,
 * the round badge, where the page sits and one line about it, then Listen.
 * The page's name is in the header (PageShell `heading`), so this stays
 * small and the lessons start near the top of the screen.
 */
export function Hero({ description, eyebrow, picture, pictureShape = 'header', icon, listenSrc }: HeroProps) {
  return (
    <Card large className="lrn-hero">
      <div className="lrn-hero__row">
        <ScenePicture picture={picture} shape={pictureShape} eager className="lrn-hero__picture" />
        <Badge size="sm" className="lrn-hero__badge">
          {icon}
        </Badge>
        <div className="lrn-hero__words">
          {eyebrow ? <p className="lrn-eyebrow">{eyebrow}</p> : null}
          {description ? <p className="sb-body sb-muted">{description}</p> : null}
        </div>
      </div>
      <ListenBar src={listenSrc} className="lrn-listen lrn-hero__listen" />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Who is learning                                                     */
/* ------------------------------------------------------------------ */

function NoticeMessage({ notice }: { notice: LearnerNotice }) {
  if (notice.kind === 'saved') {
    return <SuccessState>Your progress is saved in this bag, {firstName(notice.name)}.</SuccessState>;
  }
  if (notice.kind === 'welcome') {
    return <SuccessState>Welcome back, {firstName(notice.name)}. You are signed in.</SuccessState>;
  }
  return (
    <Message tone="info" title="Your name is not in this bag any more">
      You are learning as a guest. Add your name again to save your progress.
    </Message>
  );
}

/**
 * "Learning as Aminata · Change" (V3-Primary, AGB-Agriculture), or for a
 * guest the same row offering "Add name". Also shows the one-time message
 * after saving a name.
 */
export function LearnerStrip({ className }: { className?: string }) {
  const { learner } = useSession();
  const { pathname } = useLocation();
  const [notice] = useState(peekLearnerNotice);
  // Shown once: the next screen starts without it.
  useEffect(() => {
    setLearnerNotice(null);
  }, []);
  const changeTo = saveProgressPath(pathname);
  return (
    <div className={cx('sb-stack', className)}>
      {notice ? <NoticeMessage notice={notice} /> : null}
      {learner ? (
        <PersonChip name={learner.name} changeTo={changeTo}>
          Learning as <strong>{firstName(learner.name)}</strong>
        </PersonChip>
      ) : (
        <PersonChip icon={<IconPerson size={28} />} changeTo={changeTo} changeLabel="Sign in">
          You are a <strong>guest</strong>
        </PersonChip>
      )}
    </div>
  );
}

/** Home: only the one-off notice ("Your progress is saved…"). Who is learning is in the header there. */
export function LearnerNoticeOnce({ className }: { className?: string }) {
  const [notice] = useState(peekLearnerNotice);
  // Shown once: the next screen starts without it.
  useEffect(() => {
    setLearnerNotice(null);
  }, []);
  return notice ? (
    <div className={className}>
      <NoticeMessage notice={notice} />
    </div>
  ) : null;
}

/** "You are a guest · Add your name to save your progress · Add name" as a card (no longer on Home). */
export function GuestCard() {
  return (
    <Card tappable large className="lrn-panel">
      <div className="lrn-media">
        <Badge size="md" className="lrn-media__badge lrn-badge--tint-ring">
          <IconPerson size={32} />
        </Badge>
        <div>
          <p className="lrn-media__title">You are a guest</p>
          <p className="sb-label lrn-regular sb-muted">Add your name to save your progress.</p>
        </div>
      </div>
      <ButtonLink to={paths.saveProgress()} fullWidth icon={<IconPersonAdd size={30} />} className="lrn-gap-top">
        Add name
      </ButtonLink>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

/** "Continue where you stopped" (AGB-Agriculture): the lesson card with the 3px edge. */
export function ContinueCard({ item }: { item: ContinueLesson }) {
  const { lesson, lessonCount, seriesTitle } = item;
  const position = lesson.position === null ? undefined : `Lesson ${lesson.position} of ${lessonCount}`;
  return (
    <section aria-label="Continue where you stopped" className="lrn-continue">
      <LessonCard
        lesson={lesson.summary ? lesson : { ...lesson, summary: seriesTitle }}
        to={paths.lesson(lesson.id)}
        state="started"
        current
        eyebrow="Continue where you stopped"
        positionLabel={position}
        eager
      />
    </section>
  );
}

export interface HelpCardProps {
  /** "Need help now?", "Worried about a child?", "A child needs help now?" */
  title: string;
  text: string;
}

/** Red "Get help now" entry at the foot of every Child protection list (CPB-Who, CPB-Parent, CPB-Elder). */
export function HelpCard({ title, text }: HelpCardProps) {
  return (
    <Card tappable large className="lrn-panel lrn-help-card">
      <div className="lrn-media lrn-help-card__words">
        <Badge size="md" className="lrn-media__badge lrn-badge--tint-ring">
          <IconHelp size={32} />
        </Badge>
        <div>
          <h2 className="lrn-media__title lrn-media__title--lg">{title}</h2>
          <p className="sb-label lrn-regular sb-muted">{text}</p>
        </div>
      </div>
      <ButtonLink to={paths.help()} variant="danger" fullWidth icon={<IconHelp size={30} />} className="lrn-help-card__action">
        Get help now
      </ButtonLink>
    </Card>
  );
}

/** "Step 1 of 2" pill, heading and one line (V3-Primary, V3-JSS). */
export function SectionHeading({ id, step, title, text, focusable }: { id?: string; step?: string; title: string; text?: string; focusable?: boolean }) {
  return (
    <div className="lrn-heading">
      {step ? <span className="lrn-step-pill">{step}</span> : null}
      <h2 id={id} className="sb-h2" tabIndex={focusable ? -1 : undefined}>
        {title}
      </h2>
      {text ? <p className="sb-body sb-muted">{text}</p> : null}
    </div>
  );
}

/** Portal ids whose pages never show who is learning (sensitive content). */
export function showsLearner(portalId: PortalId | string): boolean {
  return portalId !== CHILD_PROTECTION;
}
