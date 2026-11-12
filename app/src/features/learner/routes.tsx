/*
 * Learner browsing: route table (stream 2).
 *
 * This file is the only thing the app router knows about this feature.
 * Add one line per screen to `routes`; see README.md in this folder.
 * The placeholder Home below shows the conventions in working form:
 * replace it with the real screens.
 */
import { getPortals } from '@shared/api/learner';
import { useApi } from '@shared/api';
import { ErrorState, InfoStrip, LoadingState, PortalCard } from '@shared/components';
import { IconPortalAgriculture, IconPortalChildProtection, IconPortalClimate, IconPortalJss, IconPortalPrimary } from '@shared/icons';
import { paths, type RouteDef } from '@shared/router';
import { ListenButton, PageShell } from '@shared/shell';
import type { PortalId } from '@shared/api';
import type { ReactNode } from 'react';

const PORTAL_ICONS: Record<PortalId, ReactNode> = {
  primary: <IconPortalPrimary size={40} />,
  jss: <IconPortalJss size={40} />,
  'child-protection': <IconPortalChildProtection size={40} />,
  agriculture: <IconPortalAgriculture size={40} />,
  climate: <IconPortalClimate size={40} />,
};

/** Placeholder for the Home board (Main). Stream 2 replaces this. */
function HomePlaceholder() {
  const { data, error, loading, reload } = useApi((signal) => getPortals({ signal }), []);
  return (
    <PageShell title="Home" variant="home" listenSrc={null}>
      <div className="sb-stack">
        <h1 className="sb-h1">What do you want to learn today?</h1>
        <ListenButton src={null} label="Listen to this page" fullWidth className="sb-phone-only" />
        {loading && !data ? <LoadingState /> : null}
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {data ? (
          <div className="sb-grid">
            {data.map((portal, index) => (
              <PortalCard
                key={portal.id}
                to={paths.portal(portal.id)}
                title={portal.title}
                description={portal.description}
                picture={portal.picture}
                icon={PORTAL_ICONS[portal.id]}
                theme={portal.theme}
                eager={index === 0}
              />
            ))}
          </div>
        ) : null}
        <InfoStrip />
      </div>
    </PageShell>
  );
}

export const routes: RouteDef[] = [
  { path: '/', component: HomePlaceholder },
  // { path: '/save-progress', component: lazy(() => import('./screens/SaveProgress')) },
  // { path: '/portal/:portalId', component: lazy(() => import('./screens/PortalPage')) },
];
