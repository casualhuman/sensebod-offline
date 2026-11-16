/*
 * The jumbo menu (ADM-M-Menu): every destination as a big labelled tile, two
 * columns, the current one marked "You are here". No hidden hamburger.
 */
import type { ReactNode } from 'react';
import { IconHome, IconPerson, IconTick } from '@shared/icons';
import { Link, useQuery } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { PageHead } from '../components';
import { AdminFrame, SignOutButton, type AdminNavKey } from '../frame/AdminFrame';
import { IconAddCircle, IconBagWifi, IconLearners, IconLibrary, IconSeriesOrder, IconSettings, IconStorage } from '../icons';
import { useAdminSession } from '../session';
import './home.css';

const TILES: { key: AdminNavKey; to: string; label: string; hint: string; icon: ReactNode }[] = [
  { key: 'home', to: adminPaths.home(), label: 'Home', hint: 'What is waiting and recent work', icon: <IconHome size={26} /> },
  { key: 'add', to: adminPaths.add(), label: 'Add content', hint: 'Files, photos, typing or animations', icon: <IconAddCircle size={26} /> },
  { key: 'library', to: adminPaths.library(), label: 'Library', hint: 'Every lesson on this bag', icon: <IconLibrary size={26} /> },
  { key: 'series', to: adminPaths.series(), label: 'Series and order', hint: 'Put lessons in the right order', icon: <IconSeriesOrder size={26} /> },
  { key: 'learners', to: adminPaths.learners(), label: 'Learners and progress', hint: 'Who is learning what', icon: <IconLearners size={26} /> },
  { key: 'storage', to: adminPaths.storage(), label: 'Storage and backup', hint: 'Space left and safe copies', icon: <IconStorage size={26} /> },
  { key: 'settings', to: adminPaths.settings(), label: 'Settings', hint: 'Bag name, languages and staff', icon: <IconSettings size={26} /> },
];

export default function Menu() {
  const { session } = useAdminSession();
  const from = useQuery().get('from');
  const current = TILES.some((tile) => tile.key === from) ? from : null;
  const closeTo = TILES.find((tile) => tile.key === current)?.to ?? adminPaths.home();

  return (
    <AdminFrame title="Menu" nav="menu" closeTo={closeTo}>
      <PageHead title="Menu" />
      <div className="adm-card adm-row">
        <span className="adm-disc adm-disc--tint" aria-hidden="true">
          <IconPerson size={26} />
        </span>
        <p className="adm-row__grow">
          <span className="adm-card__title">{session ? session.displayName : ''}</span>
          <span className="adm-small">Signed in as {session ? session.username : ''}</span>
        </p>
      </div>
      <p className="adm-note adm-note--ok">
        <IconBagWifi size={22} />
        <span>Running on this bag</span>
      </p>
      <nav aria-label="All admin sections">
        <ul className="adm-menu__grid">
          {TILES.map((tile) => (
            <li key={tile.key}>
              <Link to={tile.to} className="adm-menu__tile" aria-current={current === tile.key ? 'page' : undefined}>
                <span className="adm-disc" aria-hidden="true">
                  {tile.icon}
                </span>
                <span className="adm-menu__label">{tile.label}</span>
                <span className="adm-menu__hint">{tile.hint}</span>
                {current === tile.key ? (
                  <span className="adm-menu__here">
                    <IconTick size={20} />
                    You are here
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="adm-stack--sm">
        <SignOutButton className="adm-mini-btn" />
        <p className="adm-small">Signing out keeps everything saved on this bag.</p>
      </div>
    </AdminFrame>
  );
}
