/*
 * A-19: when the admin session has ended (expiry, bag restart) and the
 * facilitator taps Save in an editor, the 401 sends them to the sign-in form
 * by unmounting the editor. After signing in they are returned to the same
 * address, but everything they had typed is gone: the editor is loaded again
 * from the bag.
 *
 * Passes while the defect is present.
 */
import { installMockApi } from '@mock/installMockFetch';
import { Routes } from '@shared/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { routes } from '../../../app/src/features/admin/routes';
import { resetAdminSessionForTests } from '../../../app/src/features/admin/session';

describe('A-19 a session that ended loses the unsaved editor work', () => {
  it('drops the typed question when Save answers 401 and the facilitator signs in again', async () => {
    const mock = installMockApi();
    resetAdminSessionForTests();
    window.localStorage.clear();
    mock.signInAdmin();
    window.history.replaceState(null, '', '/admin/lessons/cp-child-staying-safe-4/questions');
    render(
      <Suspense fallback={<p>Loading the screen…</p>}>
        <Routes routes={routes} notFound={<p>not found</p>} />
      </Suspense>,
    );

    // The facilitator rewrites the first question.
    const prompt = (await screen.findByLabelText('Question')) as HTMLTextAreaElement;
    const original = prompt.value;
    expect(original.length).toBeGreaterThan(0);
    fireEvent.change(prompt, { target: { value: 'A question I spent ten minutes writing' } });

    // Meanwhile the bag forgot the session. Save answers 401.
    mock.failNext(401);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(window.location.pathname).toBe('/admin/sign-in'));
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/admin/lessons/cp-child-staying-safe-4/questions');

    // They sign in again and are taken back to the editor…
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'sensebod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const again = (await screen.findByLabelText('Question')) as HTMLTextAreaElement;
    expect(window.location.pathname).toBe('/admin/lessons/cp-child-staying-safe-4/questions');

    // …where the typed text is gone and nothing says so.
    expect(again.value).toBe(original);
    expect(screen.queryByDisplayValue('A question I spent ten minutes writing')).toBeNull();
    expect(screen.getByRole('button', { name: 'Nothing to save' })).toBeInTheDocument();
  });
});
