/*
 * Games: choose a category, then a game. Games are not tied to a class.
 *
 *   /games                      the categories
 *   /games?category=<id>        the games of one category
 *
 * The category is in the query, not in the path: everything below
 * /games/<name>/ is a game's own static folder (app/docs/GAMES.md).
 */
import { ButtonLink, Card, Badge, EmptyState, Message, cx } from '@shared/components';
import { IconBack } from '@shared/icons';
import { paths, useQuery } from '@shared/router';
import { PageShell } from '@shared/shell';
import { CATEGORIES, findCategory, GAMES, gamesIn, type GameCategory } from '../catalogue';
import { GameCard } from '../components';
import { CategoryIcon } from '../icons';

function countWords(count: number): string {
  return count === 1 ? '1 game' : `${count} games`;
}

function CategoryCard({ category }: { category: GameCategory }) {
  return (
    <Card to={paths.gamesCategory(category.id)} className={cx('sb-topic-card', 'sb-topic-card--plain', 'gam-card')}>
      <span className="sb-card__body">
        <span className="sb-topic-card__top">
          <Badge size="md" tone="accent">
            <CategoryIcon category={category.id} size={32} />
          </Badge>
          <span className="gam-count">{countWords(gamesIn(category.id).length)}</span>
        </span>
        <span className="sb-topic-card__title">{category.title}</span>
        <span className="sb-topic-card__detail">{category.description}</span>
      </span>
    </Card>
  );
}

export default function GamesHome() {
  const asked = useQuery().get('category');
  const category = findCategory(asked);
  const anyInBag = GAMES.some((game) => game.installed);
  const none = anyInBag ? null : (
    <Message tone="empty" title="No games in this bag yet">
      The games will come later. Ask your facilitator.
    </Message>
  );

  if (asked !== null && !category) {
    return (
      <PageShell title="Games" backTo={paths.games()}>
        <EmptyState
          title="This kind of game is not in this bag"
          action={
            <ButtonLink to={paths.games()} fullWidth icon={<IconBack size={28} />}>
              Back to Games
            </ButtonLink>
          }
        >
          Go back and choose another kind of game.
        </EmptyState>
      </PageShell>
    );
  }

  if (category) {
    const games = gamesIn(category.id);
    return (
      <PageShell title={category.title} backTo={paths.games()}>
        <div className="sb-stack sb-stack--lg">
          <section className="gam-intro">
            <p className="gam-eyebrow">Games</p>
            <h1 className="sb-h1">{category.title}</h1>
            <p className="sb-body sb-muted">{category.description}</p>
          </section>
          {none}
          <section aria-labelledby="gam-games" className="sb-stack">
            <h2 id="gam-games" className="sb-h2">
              Choose a game
            </h2>
            <ul className="sb-grid gam-list">
              {games.map((game) => (
                <li key={game.id}>
                  <GameCard game={game} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Games" backTo={paths.home()}>
      <div className="sb-stack sb-stack--lg">
        <section className="gam-intro">
          <h1 className="sb-h1">Games</h1>
          <p className="sb-body sb-muted">Play and learn. Choose a kind of game.</p>
        </section>
        {none}
        <section aria-labelledby="gam-categories" className="sb-stack">
          <h2 id="gam-categories" className="sb-h2">
            Choose a kind of game
          </h2>
          <ul className="sb-grid gam-list">
            {CATEGORIES.map((item) => (
              <li key={item.id}>
                <CategoryCard category={item} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
