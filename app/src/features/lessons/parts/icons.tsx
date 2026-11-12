/*
 * Icons that only the lesson screens use, built on the shared base (24px
 * grid, 3px round stroke) with path data taken from the boards.
 */
import { Icon, type IconProps } from '@shared/icons';

/** "What you will learn" (CPB-Video). */
export function IconLightbulb(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </Icon>
  );
}

/** Sound switched off: the shared speaker with a cross instead of a wave. */
export function IconSoundOff(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 9.5v5h4l5 4.5v-14L7 9.5z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </Icon>
  );
}

/** Leave full screen: the four corners pointing inwards. */
export function IconExitFullScreen(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" />
    </Icon>
  );
}

/** Previous page / previous step. */
export function IconArrowLeft(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Icon>
  );
}

/** Pictures in a row: "Watch it step by step" (CLB-Climate-Lesson). */
export function IconPictures(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 15l4.5-4 4 3.5 3-2.5L21 16" />
      <path d="M15.5 9.2v.2" />
    </Icon>
  );
}
