/*
 * Icons that only the Games section uses, drawn on the shared base: 24px
 * grid, 3px round stroke. One per category; always shown beside its words.
 */
import type { ReactNode } from 'react';
import { Icon, IconGrid, type IconProps } from '@shared/icons';
import type { GameCategoryId } from './catalogue';

function IconStrategy(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="6.5" r="3" />
      <path d="M10.5 9.5c0 3-3 4.5-3 9h9c0-4.5-3-6-3-9" />
      <path d="M6 21h12" />
    </Icon>
  );
}
function IconQuickPlay(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M13 2.5L4.5 14H11l-1 7.5L18.5 10H12z" />
    </Icon>
  );
}

const CATEGORY_ICONS: Record<GameCategoryId, (p: IconProps) => ReactNode> = {
  thinking: IconStrategy,
  puzzles: IconGrid,
  'quick-play': IconQuickPlay,
};

export function CategoryIcon({ category, ...props }: IconProps & { category: GameCategoryId }) {
  const Glyph = CATEGORY_ICONS[category];
  return <Glyph {...props} />;
}
