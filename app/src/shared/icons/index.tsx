/*
 * Shared icon set, redrawn 1:1 from the V3-Components board and the screens
 * (same path data). Local inline SVG, no icon font, no sprite request.
 * Each icon is its own function so unused ones are dropped from the bundle.
 *
 * Usage: import { IconBack } from '@shared/icons';  <IconBack size={28} />
 */
import { Icon, type IconProps } from './Icon';

export { Icon, type IconProps };

/* ---- navigation ---- */
export function IconBack(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}
export function IconHome(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 11.5l9-7.5 9 7.5" />
      <path d="M5.5 10v10h13V10" />
      <path d="M10 20v-5h4v5" />
    </Icon>
  );
}
/** Arrow used on "Open", "Next question", "See your result". */
export function IconArrowRight(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}
export function IconChevronRight(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 6l6 6-6 6" />
    </Icon>
  );
}
/** "Leave this page" quick exit. */
export function IconLeave(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 21H5V3h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  );
}
export function IconSkip(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 12h12M12 7l5 5-5 5" />
      <path d="M20 5v14" />
    </Icon>
  );
}
export function IconGrid(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Icon>
  );
}
/** Games: a game pad. */
export function IconGames(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M7.5 7h9a5 5 0 0 1 5 5v1.5a4 4 0 0 1-7.4 2.1l-.4-.6h-3.4l-.4.6a4 4 0 0 1-7.4-2.1V12a5 5 0 0 1 5-5z" />
      <path d="M8 10.2v3.6M6.2 12h3.6" />
      <path d="M16 12h.01" />
    </Icon>
  );
}
export function IconClose(p: IconProps) {
  return (
    <Icon strokeWidth={3.4} {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}
export function IconPlus(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </Icon>
  );
}

/* ---- sound and media ---- */
/** Speaker with two waves: the gold Listen button. */
export function IconListen(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 9.5v5h4l5 4.5v-14L7 9.5z" />
      <path d="M16 9a4.5 4.5 0 0 1 0 6" />
      <path d="M19 6a8.5 8.5 0 0 1 0 12" />
    </Icon>
  );
}
/** Speaker with one wave: "Sound", "Needs sound". */
export function IconSound(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 9.5v5h4l5 4.5v-14L7 9.5z" />
      <path d="M16 9a4.5 4.5 0 0 1 0 6" />
    </Icon>
  );
}
export function IconPlay(p: IconProps) {
  return (
    <Icon strokeWidth={2} {...p}>
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
    </Icon>
  );
}
export function IconPause(p: IconProps) {
  return (
    <Icon strokeWidth={0} {...p}>
      <rect x="5.5" y="4.5" width="4.5" height="15" rx="1.3" fill="currentColor" />
      <rect x="14" y="4.5" width="4.5" height="15" rx="1.3" fill="currentColor" />
    </Icon>
  );
}
export function IconBack10(p: IconProps) {
  return (
    <Icon strokeWidth={2.6} {...p}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v5h5" />
      <text x="12.6" y="15.6" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="800">
        10
      </text>
    </Icon>
  );
}
export function IconForward10(p: IconProps) {
  return (
    <Icon strokeWidth={2.6} {...p}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v5h-5" />
      <text x="11.4" y="15.6" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="800">
        10
      </text>
    </Icon>
  );
}
export function IconCaptions(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6" />
      <path d="M17.5 10.2a2.3 2.3 0 1 0 0 3.6" />
    </Icon>
  );
}
export function IconFullScreen(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </Icon>
  );
}
/** "Watch again": retry arrow with a small play triangle. */
export function IconReplay(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v5h5" />
      <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" strokeWidth={2} />
    </Icon>
  );
}
/** "Next video": play triangle against a bar. */
export function IconNext(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 5.5v13l10-6.5z" fill="currentColor" />
      <path d="M19 5v14" />
    </Icon>
  );
}

/* ---- lesson types (bold labelled icons; always shown with their word) ---- */
/** Watch: play in a screen. */
export function IconWatch(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2.5" y="3.5" width="19" height="14" rx="2.5" />
      <path d="M10 7.8v5.4l4.4-2.7z" fill="currentColor" strokeWidth={2} />
      <path d="M8 21h8" />
    </Icon>
  );
}
/** Listen (lesson type): headphones. */
export function IconHeadphones(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="5" height="7" rx="2" />
      <rect x="16" y="14" width="5" height="7" rx="2" />
    </Icon>
  );
}
/** Read: open book with lines. */
export function IconRead(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 6.5C9.5 4.6 6.3 4.2 2.5 5.2v13.6c3.8-1 7-.6 9.5 1.3 2.5-1.9 5.7-2.3 9.5-1.3V5.2c-3.8-1-7-.6-9.5 1.3z" />
      <path d="M12 6.5v13.6" />
      <path d="M6 10.2h2.6M15.4 10.2H18M6 14.2h2.6M15.4 14.2H18" />
    </Icon>
  );
}
/** Try it and "You take part": tapping hand. */
export function IconTryIt(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M10.5 22l-4.2-4.4a1.7 1.7 0 0 1 2.5-2.3l1.7 1.6V11a1.6 1.6 0 0 1 3.2 0v4.2l3.7.7a2.2 2.2 0 0 1 1.8 2.5l-.6 3.6" />
      <path d="M7.2 6.6a5.6 5.6 0 0 1 9.8 0" />
    </Icon>
  );
}
/** Check: clipboard with tick. */
export function IconCheckQuiz(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M8.5 4.5h-2a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2h-2" />
      <rect x="8.5" y="2.5" width="7" height="4" rx="1.2" />
      <path d="M8.5 13.8l2.5 2.5 4.6-5" />
    </Icon>
  );
}
/** "All" in the lesson filter: a list. */
export function IconAll(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.1M4 12h.1M4 18h.1" />
    </Icon>
  );
}

/* ---- state ---- */
/** Plain tick: correct, saved, chosen. */
export function IconTick(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}
/** State chip: Not started. */
export function IconNotStarted(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
    </Icon>
  );
}
/** State chip: Started (also the "[length]" clock). */
export function IconClock(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}
/** State chip: Finished. */
export function IconFinished(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-6" />
    </Icon>
  );
}
/** Information: "Not in bag" chip, hints. */
export function IconInfo(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.2" />
    </Icon>
  );
}
/** The "i" on its own, inside a round message badge. */
export function IconInfoMark(p: IconProps) {
  return (
    <Icon strokeWidth={3.2} {...p}>
      <path d="M12 11v7M12 6.5v.2" />
    </Icon>
  );
}
export function IconTryAgain(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v5h5" />
    </Icon>
  );
}
export function IconError(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.3v.2" />
    </Icon>
  );
}
/** Working: a ring with a brighter quarter. Turns only when motion is allowed. */
export function IconSpinner(p: IconProps) {
  return (
    <Icon strokeWidth={3.2} {...p} className={p.className ? `sb-spinner ${p.className}` : 'sb-spinner'}>
      <circle cx="12" cy="12" r="8.5" opacity="0.4" />
      <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" />
    </Icon>
  );
}
/** Empty bag: "Not in this bag yet". */
export function IconBag(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 8h14l-1 13H6z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </Icon>
  );
}
/** Bag with a tick: "Everything here is in this bag". */
export function IconBagTick(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 8h14l-1 13H6z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      <path d="M9 14l2 2 4-4" />
    </Icon>
  );
}
export function IconQuestion(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9.3 9.3a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.8v.4" />
      <path d="M12 17.3v.2" />
    </Icon>
  );
}
export function IconStar(p: IconProps) {
  return (
    <Icon strokeWidth={2.6} {...p}>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </Icon>
  );
}
export function IconHeart(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 20.5s-8-4.6-8-10.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8 2.5c0 5.8-8 10.4-8 10.4z" />
    </Icon>
  );
}
export function IconLock(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

/* ---- actions ---- */
/** Save: bookmark with a tick. */
export function IconSave(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 3.5h12v17l-6-4-6 4z" />
      <path d="M9 9.5l2 2 4-4" />
    </Icon>
  );
}
export function IconPencil(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
    </Icon>
  );
}
export function IconTrash(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6.5 7l1 13h9l1-13" />
    </Icon>
  );
}
export function IconUpload(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 15V4" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14" />
    </Icon>
  );
}
/** Urgent help: life ring. Used on the red "Get help now" button. */
export function IconHelp(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" />
    </Icon>
  );
}

/* ---- people and language ---- */
export function IconPerson(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5" />
    </Icon>
  );
}
export function IconPersonAdd(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="10" cy="8" r="4" />
      <path d="M3 21c1-4.5 4-6.5 7-6.5 1.6 0 3.2.5 4.5 1.6" />
      <path d="M19 13.5v7M15.5 17h7" />
    </Icon>
  );
}
export function IconLanguage(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19" />
      <path d="M12 2.5c3.2 3 3.2 16 0 19M12 2.5c-3.2 3-3.2 16 0 19" />
    </Icon>
  );
}

/* ---- portals ---- */
/** Primary school: open book. */
export function IconPortalPrimary(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 5.5c3-1 6-1 9 1.5v13c-3-2.5-6-2.5-9-1.5z" />
      <path d="M21 5.5c-3-1-6-1-9 1.5v13c3-2.5 6-2.5 9-1.5z" />
    </Icon>
  );
}
/** Junior secondary: graduation cap. */
export function IconPortalJss(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M2 9.5l10-5 10 5-10 5z" />
      <path d="M6 11.5v5c3.5 2.5 8.5 2.5 12 0v-5" />
      <path d="M22 9.5v6" />
    </Icon>
  );
}
/** Child protection: shield with a heart. */
export function IconPortalChildProtection(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10.5-4.5-2-8-5.5-8-10.5v-6z" />
      <path d="M12 15.5s-3.4-2.2-3.4-4.5a1.8 1.8 0 0 1 3.4-.9 1.8 1.8 0 0 1 3.4.9c0 2.3-3.4 4.5-3.4 4.5z" />
    </Icon>
  );
}
/** Agriculture: seedling. */
export function IconPortalAgriculture(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 21v-9" />
      <path d="M12 12c0-4.5 3-7.5 8-7.5 0 4.5-3 7.5-8 7.5z" />
      <path d="M12 14.5c0-3.5-2.5-6-7-6 0 3.5 2.5 6 7 6z" />
      <path d="M6 21h12" />
    </Icon>
  );
}
/** Climate: rain cloud. */
export function IconPortalClimate(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M7 15h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.5 1.5A3.3 3.3 0 0 0 7 15z" />
      <path d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5" />
    </Icon>
  );
}

/* ---- upload sources (admin "automatic type rule") ---- */
export function IconVideoFile(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2.5" y="5" width="13" height="14" rx="2.5" />
      <path d="M15.5 10l6-3.5v11l-6-3.5" />
    </Icon>
  );
}
export function IconMicrophone(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" />
      <path d="M5 11.5a7 7 0 0 0 14 0" />
      <path d="M12 18.5v3" />
    </Icon>
  );
}
export function IconDocument(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" />
      <path d="M14 2.5V8h5.5" />
      <path d="M8.5 13h7M8.5 17h5" />
    </Icon>
  );
}
export function IconAnimationPackage(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="7" width="18" height="14" rx="2.5" />
      <path d="M3 11h18" />
      <path d="M9.5 2.5l1 2.2 2.2 1-2.2 1-1 2.2" />
      <path d="M10 14.5v3.5l3-1.7z" />
    </Icon>
  );
}
export function IconCamera(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 7.5h3l1.8-2.5h6.4L17 7.5h3a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5V9A1.5 1.5 0 0 1 4 7.5z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </Icon>
  );
}
