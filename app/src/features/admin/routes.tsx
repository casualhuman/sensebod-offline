/*
 * Admin: route table (stream 4).
 *
 * This file is the only thing the app router knows about this feature.
 * Add one line per screen to `routes`; see README.md in this folder.
 * The placeholder below shows the conventions in working form: replace it.
 */
import { Message } from '@shared/components';
import { paths, type RouteDef } from '@shared/router';
import { PageShell } from '@shared/shell';

/** Placeholder for the admin. Stream 4 replaces this. */
function AdminPlaceholder() {
  return (
    <PageShell title="Admin" backTo={paths.home()} noFooter>
      <div className="sb-stack">
        <h1 className="sb-h1">Admin</h1>
        <Message tone="info" title="Admin not built yet">
          The phone add-content flow and the laptop library are built by stream 4.
        </Message>
      </div>
    </PageShell>
  );
}

export const routes: RouteDef[] = [
  { path: '/admin', component: AdminPlaceholder },
  { path: '/admin/*', component: AdminPlaceholder },
];
