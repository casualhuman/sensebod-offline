/*
 * One game: /games/<id>.
 *
 *   - an id the catalogue does not know   "This game is not in this bag"
 *   - a game with `installed: false`      "This game is not in this bag yet"
 *   - a game with `installed: true`       the player, which opens
 *                                         /games/<id>/index.html
 *
 * Nothing is asked of the bag for a game that is not installed: no broken
 * frame, no failed request.
 */
import { ButtonLink, EmptyState } from '@shared/components';
import { IconBack } from '@shared/icons';
import { paths, useParams } from '@shared/router';
import { PageShell } from '@shared/shell';
import { CATEGORIES, findGame } from '../catalogue';
import { GamePlayer } from '../GamePlayer';

export default function GameScreen() {
  const { gameId } = useParams<'gameId'>();
  const game = findGame(gameId);
  // Back returns to the list the game was chosen from.
  const back = game ? paths.gamesCategory(game.category) : paths.games();
  const backButton = (
    <ButtonLink to={back} fullWidth icon={<IconBack size={28} />}>
      Back to Games
    </ButtonLink>
  );

  if (!game) {
    return (
      <PageShell title="Game not found" backTo={back}>
        <EmptyState title="This game is not in this bag" action={backButton}>
          The game you asked for could not be found.
        </EmptyState>
      </PageShell>
    );
  }

  const category = CATEGORIES.filter((item) => item.id === game.category)[0];

  return (
    <PageShell title={game.title} backTo={back}>
      <div className="sb-stack sb-stack--lg gam-game">
        <section className="gam-intro">
          {category ? <p className="gam-eyebrow">{category.title}</p> : null}
          <h1 className="sb-h1">{game.title}</h1>
          <p className="sb-body sb-muted">{game.description}</p>
        </section>

        {game.installed ? (
          <GamePlayer game={game} />
        ) : (
          <EmptyState title="This game is not in this bag yet" action={backButton}>
            It will come later. Ask your facilitator.
          </EmptyState>
        )}

        <p className="gam-credit">
          From the project: {game.sourceProject}. Licence: {game.licence}.
        </p>
      </div>
    </PageShell>
  );
}
