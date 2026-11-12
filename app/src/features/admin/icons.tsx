/*
 * Icons that only the admin uses, drawn on the shared 24px / 3px-stroke base
 * with the path data of the ADM boards (ADM-M-Menu, ADM-M-Notes, ADM-Library,
 * ADM-Series). Icons shared with the learner screens come from @shared/icons.
 */
import { Icon, type IconProps } from '@shared/icons';

export function IconMenuGrid(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

export function IconAddCircle(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </Icon>
  );
}

export function IconLibrary(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="4" width="5" height="16" rx="1" />
      <rect x="10.5" y="4" width="5" height="16" rx="1" />
      <path d="M17.5 5.5l3 14" />
    </Icon>
  );
}

export function IconSeriesOrder(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M11 6h9M11 12h9M11 18h9" />
      <path d="M5 4v16M2.5 6.5L5 4l2.5 2.5M2.5 17.5L5 20l2.5-2.5" />
    </Icon>
  );
}

export function IconLearners(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2c2 .8 3.5 2.8 3.5 5.8" />
    </Icon>
  );
}

export function IconStorage(p: IconProps) {
  return (
    <Icon {...p}>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </Icon>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </Icon>
  );
}

export function IconSignOut(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h10" />
    </Icon>
  );
}

/** "Saved on this bag": a tick in a circle. */
export function IconSaved(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-6" />
    </Icon>
  );
}

/** "No internet needed": the bag with its own Wi-Fi. */
export function IconBagWifi(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 16.5h.01M11 16.5h.01" />
      <path d="M8.5 9.5a5 5 0 0 1 7 0M6 7a8.5 8.5 0 0 1 12 0" />
    </Icon>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20.5 20.5l-4.5-4.5" />
    </Icon>
  );
}

export function IconEye(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function IconMore(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12h.01M12 12h.01M19 12h.01" />
    </Icon>
  );
}

export function IconMoveUp(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </Icon>
  );
}

export function IconMoveDown(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 5v14" />
      <path d="M6 13l6 6 6-6" />
    </Icon>
  );
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}

export function IconRotate(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 3.5v5h-5" />
    </Icon>
  );
}

export function IconUndo(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v5h5" />
    </Icon>
  );
}

export function IconTip(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.5 1.1-2.1A6 6 0 0 0 12 3z" />
    </Icon>
  );
}

export function IconPhone(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </Icon>
  );
}

export function IconLaptop(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19.5h20" />
    </Icon>
  );
}

/** Stop marker on the video timeline. */
export function IconDiamond(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3l9 9-9 9-9-9z" />
    </Icon>
  );
}

export function IconPicture(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4" />
    </Icon>
  );
}
