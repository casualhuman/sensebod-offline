/*
 * Icons that only the learner browsing screens use. Same path data as the
 * boards (V3-Primary, V3-JSS, CLB-Climate, CPB-Who, CPB-Elder, CPB-Help,
 * V3-SignIn), drawn on the shared base: 24px grid, 3px round stroke.
 * Icons used by more than one stream live in @shared/icons.
 */
import type { ReactNode } from 'react';
import type { Group, PortalId } from '@shared/api';
import {
  Icon,
  IconPortalAgriculture,
  IconPortalChildProtection,
  IconPortalClimate,
  IconPortalJss,
  IconPortalPrimary,
  IconWatch,
  type IconProps,
} from '@shared/icons';

/* ---- school subjects (V3-Primary, V3-JSS) ---- */
export function IconSubjectLanguage(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 20l4-1L19 8l-3-3L5 16z" />
      <path d="M14 7l3 3" />
    </Icon>
  );
}
export function IconSubjectMaths(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M7 4v6M4 7h6" />
      <path d="M14 7h6" />
      <path d="M5 15l4 4M9 15l-4 4" />
      <path d="M14 15h6M14 19h6" />
    </Icon>
  );
}
export function IconSubjectScience(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 3h6" />
      <path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </Icon>
  );
}
export function IconSubjectSocial(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19" />
      <path d="M12 2.5c3 3 3 16 0 19c-3-3-3-16 0-19z" />
    </Icon>
  );
}

/* ---- climate topics (CLB-Climate) ---- */
export function IconTopicSeasons(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="3.5" />
      <path d="M9 20h8a3.5 3.5 0 0 0 .3-7 4.5 4.5 0 0 0-8.6 1.2A2.9 2.9 0 0 0 9 20z" />
    </Icon>
  );
}
export function IconTopicFloods(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 11l8-6.5 8 6.5" />
      <path d="M6.5 9.5V14h11V9.5" />
      <path d="M3 18.5c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0" />
    </Icon>
  );
}
export function IconTopicCleanWater(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3c3.5 4.5 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.5-6.5 6-11z" />
      <path d="M9.3 14.2l2 2 3.5-4" />
    </Icon>
  );
}
export function IconTopicHeat(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" />
      <path d="M12 10v6" />
    </Icon>
  );
}

/* ---- Child protection audiences (CPB-Who) ---- */
export function IconAudienceChild(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="5.5" r="3" />
      <path d="M8 10.5h8l-1 5H9z" />
      <path d="M10 15.5v5M14 15.5v5" />
    </Icon>
  );
}
export function IconAudienceParent(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="8" cy="5" r="2.8" />
      <path d="M4 21v-8a4 4 0 0 1 8 0v8" />
      <circle cx="17.5" cy="11" r="2.2" />
      <path d="M14.5 21v-4.5a3 3 0 0 1 6 0V21" />
    </Icon>
  );
}
export function IconAudienceElder(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="10" cy="4.5" r="2.6" />
      <path d="M6 21l1.5-8.5a3 3 0 0 1 5.5-1l2 3.5" />
      <path d="M10 15l1 6M17.5 12v9" />
    </Icon>
  );
}

/* ---- "What to do if a child tells you" (CPB-Elder) and Get help now (CPB-Help) ---- */
export function IconEar(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.5 1.5" />
      <path d="M10 9.5a2 2 0 0 1 4 0" />
    </Icon>
  );
}
export function IconFlag(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 21V4" />
      <path d="M4 4.5h12l-2.5 4 2.5 4H4" />
    </Icon>
  );
}
export function IconPlace(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 21.5s-7-6-7-11.5a7 7 0 0 1 14 0c0 5.5-7 11.5-7 11.5z" />
      <circle cx="12" cy="10" r="2.5" />
    </Icon>
  );
}
export function IconPhone(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 3.5h4l2 5-2.5 1.5a11 11 0 0 0 5.5 5.5l1.5-2.5 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5.5a2 2 0 0 1 2-2z" />
    </Icon>
  );
}
export function IconTalk(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 4.5h12v8H8l-4 3.5v-3.5H3z" />
      <path d="M18 9h3v8h-1v3l-3.5-3H11v-1.5" />
    </Icon>
  );
}

/* ---- Save my progress (V3-SignIn) ---- */
export function IconTeacher(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20l4-4 4 4" />
    </Icon>
  );
}

/* ------------------------------------------------------------------ */
/* Which icon a card gets                                              */
/* ------------------------------------------------------------------ */

type IconComponent = (props: IconProps) => ReactNode;

const PORTAL_ICONS: Record<PortalId, IconComponent> = {
  primary: IconPortalPrimary,
  jss: IconPortalJss,
  'child-protection': IconPortalChildProtection,
  agriculture: IconPortalAgriculture,
  climate: IconPortalClimate,
};

export function PortalIcon({ portalId, size }: { portalId: string; size?: number }) {
  const Glyph = (PORTAL_ICONS as Record<string, IconComponent | undefined>)[portalId] ?? IconPortalPrimary;
  return <Glyph size={size} />;
}

/*
 * TODO(stream-1): the contract has no icon field for a group or a series, so
 * the icon is chosen from words in the (English) title, with the portal icon
 * as the fallback. See docs/team/REQUESTS.md "icon key for groups and series".
 */
const TITLE_ICONS: readonly [RegExp, IconComponent][] = [
  [/agric|grow|crop|farm/i, IconPortalAgriculture],
  [/math/i, IconSubjectMaths],
  [/science/i, IconSubjectScience],
  [/social/i, IconSubjectSocial],
  [/english|language|reading|writing/i, IconSubjectLanguage],
  [/flood/i, IconTopicFloods],
  [/rain|season/i, IconTopicSeasons],
  [/clean|water/i, IconTopicCleanWater],
  [/heat|hot/i, IconTopicHeat],
];

/** Badge icon for a subject (series) or topic (group) card. */
export function TopicIcon({ title, portalId, watchOnly = false, size = 32 }: { title: string; portalId: string; watchOnly?: boolean; size?: number }) {
  // AGB-Agriculture: a topic that only holds videos wears the Watch icon.
  if (watchOnly) return <IconWatch size={size} />;
  for (const [pattern, Glyph] of TITLE_ICONS) {
    if (pattern.test(title)) return <Glyph size={size} />;
  }
  return <PortalIcon portalId={portalId} size={size} />;
}

/** Badge icon for a Child protection audience (CPB-Who). */
export function AudienceIcon({ group, size = 40 }: { group: Pick<Group, 'title'>; size?: number }) {
  const title = group.title;
  if (/parent|carer/i.test(title)) return <IconAudienceParent size={size} />;
  if (/elder/i.test(title)) return <IconAudienceElder size={size} />;
  if (/child/i.test(title)) return <IconAudienceChild size={size} />;
  return <IconPortalChildProtection size={size} />;
}
