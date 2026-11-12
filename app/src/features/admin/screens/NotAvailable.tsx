/*
 * Sections the menu lists but that have not been designed yet (HANDOFF
 * section 8: Learners and progress, Storage and backup, Settings), and the
 * admin's own "not found". Plain states with a way back; nothing invented.
 */
import { ButtonLink, EmptyState } from '@shared/components';
import { IconBack } from '@shared/icons';
import { useLocation } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { PageHead } from '../components';
import { AdminFrame, type AdminNavKey } from '../frame/AdminFrame';

const SECTIONS: Record<string, { title: string; nav: AdminNavKey }> = {
  '/admin/learners': { title: 'Learners and progress', nav: 'learners' },
  '/admin/storage': { title: 'Storage and backup', nav: 'storage' },
  '/admin/settings': { title: 'Settings', nav: 'settings' },
};

export default function NotAvailable() {
  const { pathname } = useLocation();
  const section = SECTIONS[pathname];
  const back = (
    <ButtonLink to={adminPaths.home()} variant="secondary" fullWidth icon={<IconBack size={28} />}>
      Back to admin home
    </ButtonLink>
  );
  if (!section) {
    return (
      <AdminFrame title="Page not found">
        <PageHead title="This page is not in the admin" />
        <EmptyState title="Nothing here" action={back}>
          The address may be mistyped, or the lesson may have been deleted.
        </EmptyState>
      </AdminFrame>
    );
  }
  return (
    <AdminFrame title={section.title} nav={section.nav}>
      <PageHead title={section.title} />
      <EmptyState title="Not available yet" action={back}>
        This part of the admin has not been built yet. Everything else works as usual.
      </EmptyState>
    </AdminFrame>
  );
}
