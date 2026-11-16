/* Home: the gateway to the 5 portals (board: Main). */
import { learnerApi, useApi } from '@shared/api';
import { EmptyState, ErrorState, LoadingState, PortalCard } from '@shared/components';
import { IconGames } from '@shared/icons';
import { paths } from '@shared/router';
import { ListenButton, PageShell } from '@shared/shell';
import { features } from '@shared/switches';
import { LearnerNoticeOnce } from '../components';
import { PortalIcon } from '../icons';

export default function Home() {
  const { data: portals, error, loading, reload } = useApi((signal) => learnerApi.getPortals({ signal }), []);

  return (
    <PageShell title="Home" variant="home" listenSrc={null}>
      <div className="sb-stack sb-stack--lg">
        <section className="lrn-intro">
          <p className="lrn-eyebrow">
            <span lang="kri">Kushɛ!</span> Welcome
          </p>
          <h1 className="sb-h1">What do you want to learn today?</h1>
          <p className="sb-body sb-muted">Tap a big picture to start.</p>
          <ListenButton src={null} label="Listen to this page" fullWidth className="sb-phone-only lrn-gap-top" />
        </section>

        <LearnerNoticeOnce className="lrn-narrow" />

        <section aria-labelledby="lrn-portals" className="sb-stack">
          <h2 id="lrn-portals" className="sb-h2">
            Choose a portal
          </h2>
          {loading && !portals ? <LoadingState label="Opening the portals…" /> : null}
          {error ? <ErrorState title="The portals did not open" error={error} onRetry={reload} /> : null}
          {portals && portals.length === 0 ? <EmptyState>There is nothing in this bag yet. Ask your facilitator.</EmptyState> : null}
          {portals && portals.length > 0 ? (
            <div className="sb-grid">
              {portals.map((portal, index) => (
                <PortalCard
                  key={portal.id}
                  to={paths.portal(portal.id)}
                  title={portal.title}
                  description={portal.description}
                  picture={portal.picture}
                  icon={<PortalIcon portalId={portal.id} size={40} />}
                  theme={portal.theme}
                  eager={index === 0}
                />
              ))}
              {features.games ? (
                <PortalCard to={paths.games()} title="Games" description="Play and learn: coding, maths, puzzles and more" picture={null} icon={<IconGames size={40} />} />
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}
