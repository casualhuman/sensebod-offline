/* Pieces of the Games screens: the game card. */
import { Badge, ButtonLook, Card, StateChip, cx } from '@shared/components';
import { IconPlay, IconTick } from '@shared/icons';
import { paths } from '@shared/router';
import type { Game } from './catalogue';
import { CategoryIcon } from './icons';

/**
 * One game. In the bag: the whole card is one link with a "Play" look at the
 * bottom. Not in the bag yet: a dashed card that is not a link and says so in
 * words ("Not in bag" and a sentence), never by colour alone.
 */
export function GameCard({ game }: { game: Game }) {
  const ready = game.installed;
  return (
    <Card to={ready ? paths.game(game.id) : undefined} unavailable={!ready} className={cx('sb-topic-card', 'sb-topic-card--plain', 'gam-card')}>
      <span className="sb-card__body">
        <span className="sb-topic-card__top">
          <Badge size="md" tone={ready ? 'accent' : 'muted'}>
            <CategoryIcon category={game.category} size={32} />
          </Badge>
          {ready ? (
            <span className="sb-state-chip sb-state-chip--started">
              <IconTick size={22} />
              Ready to play
            </span>
          ) : (
            <StateChip state="not-in-bag" />
          )}
        </span>
        <span className="sb-topic-card__title">{game.title}</span>
        <span className="sb-topic-card__detail">{game.description}</span>
        {ready ? (
          <ButtonLook className="gam-card__action" fullWidth icon={<IconPlay size={28} />}>
            Play
          </ButtonLook>
        ) : (
          <span className="gam-card__missing">Not in this bag yet. Ask your facilitator.</span>
        )}
      </span>
    </Card>
  );
}
