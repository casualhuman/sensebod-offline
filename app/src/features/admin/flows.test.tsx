/*
 * The admin flows end to end against the mock API: sign-in and the guard,
 * upload → draft, where does it go, publish, series order, typed drafts.
 * Screens are rendered through the feature's own route table, as the app does.
 */
import { getMockDb } from '@mock/handler';
import { installMockApi, type MockApiHandle } from '@mock/installMockFetch';
import { Routes } from '@shared/router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from './routes';
import { resetAdminSessionForTests } from './session';

let mock: MockApiHandle;

beforeEach(() => {
  mock = installMockApi();
  resetAdminSessionForTests();
  window.localStorage.clear();
});

function open(path: string) {
  window.history.replaceState(null, '', path);
  return render(
    <Suspense fallback={<p>Loading the screen…</p>}>
      <Routes routes={routes} notFound={<p>not found</p>} />
    </Suspense>,
  );
}

function chooseFiles(input: HTMLElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

const lessonsCalled = (title: string) => getMockDb().lessons.filter((lesson) => lesson.title === title);

describe('sign-in and the guard', () => {
  it('sends a signed-out visitor to sign in and back to where they were going', async () => {
    open('/admin/library?portalId=climate');
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/sign-in');
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/admin/library?portalId=climate');

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'sensebod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe('/admin/library?portalId=climate');
  });

  it('says so when the password is wrong, and keeps nothing in the browser', async () => {
    open('/admin/sign-in');
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/That username or password is not right/)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/sign-in');
    expect(JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage })).not.toMatch(/wrong|sensebod/);
    expect(window.location.href).not.toMatch(/wrong|password/);
  });

  it('asks for both fields before calling the bag', async () => {
    open('/admin/sign-in');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Type your username.')).toBeInTheDocument();
    expect(screen.getByText('Type your password.')).toBeInTheDocument();
  });

  it('ignores a return address outside the admin', async () => {
    open('/admin/sign-in?next=//evil.example/admin');
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'sensebod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: /Hello/ })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin');
  });

  it('goes back to sign in when the session ends in the middle of the work', async () => {
    mock.signInAdmin();
    open('/admin');
    expect(await screen.findByRole('heading', { name: /Hello/ })).toBeInTheDocument();
    // The bag forgets the session (restart, expiry): the next call answers 401.
    mock.failNext(401);
    fireEvent.click(screen.getByRole('link', { name: 'Library' }));
    await waitFor(() => expect(window.location.pathname).toBe('/admin/sign-in'));
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/admin/library');
  });

  it('shows a way to try again when the bag cannot be reached', async () => {
    mock.failNext(503);
    open('/admin');
    expect(await screen.findByText('The admin did not open')).toBeInTheDocument();
    mock.signInAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: /Hello/ })).toBeInTheDocument();
  });
});

describe('home and menu', () => {
  beforeEach(() => mock.signInAdmin());

  it('shows the four sources and the drafts waiting to be placed', async () => {
    open('/admin');
    expect(await screen.findByRole('link', { name: /Upload files/ })).toHaveAttribute('href', '/admin/add/upload');
    expect(screen.getByRole('link', { name: /Take photos of your notes/ })).toHaveAttribute('href', '/admin/add/notes');
    expect(screen.getByRole('link', { name: /Type it yourself/ })).toHaveAttribute('href', '/admin/add/type');
    expect(screen.getByRole('link', { name: /Upload an animation/ })).toHaveAttribute('href', '/admin/add/animation');
    expect(await screen.findByText('Safe and unsafe touch — story')).toBeInTheDocument();
    expect(screen.getByText(/Voice note · 1:42/)).toBeInTheDocument();
    expect(screen.getByText(/3 photo pages/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Place 2 waiting lessons' })).toHaveAttribute('href', '/admin/lessons/draft-safe-touch-story/place');
    expect(screen.getByText('Nothing published from this phone yet')).toBeInTheDocument();
  });

  it('lists every section in the jumbo menu and marks where you are', async () => {
    open('/admin/menu?from=library');
    const nav = await screen.findByRole('navigation', { name: 'All admin sections' });
    expect(within(nav).getAllByRole('link')).toHaveLength(7);
    expect(within(nav).getByRole('link', { name: /Library/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Close' })).toHaveAttribute('href', '/admin/library');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('says plainly that an undesigned section is not available yet', async () => {
    open('/admin/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Not available yet')).toBeInTheDocument();
  });

  it('signs out through the bag', async () => {
    open('/admin/menu');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(window.location.pathname).toBe('/admin/sign-in'));
  });
});

describe('upload files', () => {
  beforeEach(() => mock.signInAdmin());

  it('uploads the chosen files, makes one draft each, and goes on to placing', async () => {
    open('/admin/add/upload');
    const input = await screen.findByLabelText(/Choose files/);
    chooseFiles(input, [new File(['video-bytes'], 'Hen house.mp4'), new File(['voice'], 'Story.opus'), new File(['x'], 'notes.exe')]);
    expect(await screen.findByText('2 chosen')).toBeInTheDocument();
    expect(screen.getByText('1 file was not added')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Make a smaller copy for old phones/ })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /Next: choose where it goes/ }));
    const next = await screen.findByRole('link', { name: /Next: choose where it goes/ });
    expect(screen.getByRole('heading', { name: 'All 2 files are on the bag' })).toBeInTheDocument();
    const [video] = lessonsCalled('Hen house');
    expect(video).toMatchObject({ type: 'watch', status: 'draft', placement: null, source: 'upload' });
    expect(lessonsCalled('Story')[0]).toMatchObject({ type: 'listen' });
    expect(next).toHaveAttribute('href', `/admin/lessons/${video!.id}/place`);
  });

  it('does not send anything twice when Next is tapped twice', async () => {
    open('/admin/add/upload');
    chooseFiles(await screen.findByLabelText(/Choose files/), [new File(['v'], 'Rabbits.mp4')]);
    const button = await screen.findByRole('button', { name: /Next: choose where it goes/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole('link', { name: /Next: choose where it goes/ });
    expect(lessonsCalled('Rabbits')).toHaveLength(1);
    expect(getMockDb().uploads).toHaveLength(1);
  });

  it('shows a failed upload, loses nothing, and finishes on Try again', async () => {
    open('/admin/add/upload');
    chooseFiles(await screen.findByLabelText(/Choose files/), [new File(['v'], 'Goats.mp4')]);
    mock.failNext(503);
    fireEvent.click(await screen.findByRole('button', { name: /Next: choose where it goes/ }));
    expect(await screen.findByRole('heading', { name: '1 file was not uploaded' })).toBeInTheDocument();
    expect(screen.getByText(/Not uploaded\./)).toBeInTheDocument();
    expect(lessonsCalled('Goats')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('link', { name: /Next: choose where it goes/ });
    expect(lessonsCalled('Goats')).toHaveLength(1);
  });

  it('does not make a second draft when the draft answer was lost and the step is repeated', async () => {
    open('/admin/add/upload');
    chooseFiles(await screen.findByLabelText(/Choose files/), [new File(['v'], 'Snails.mp4')]);
    // The upload succeeds; the request that makes the draft fails once.
    const originalFetch = globalThis.fetch;
    let failed = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      if (!failed && init?.method === 'POST' && String(input).indexOf('/admin/lessons') !== -1) {
        failed = true;
        // The bag did the work, but the answer never reached the phone.
        throw new TypeError('connection lost');
      }
      return response;
    }) as typeof fetch;
    fireEvent.click(await screen.findByRole('button', { name: /Next: choose where it goes/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByRole('link', { name: /Next: choose where it goes/ });
    expect(lessonsCalled('Snails')).toHaveLength(1);
    expect(getMockDb().uploads).toHaveLength(1);
  });

  it('lets a file be removed before uploading', async () => {
    open('/admin/add/upload');
    chooseFiles(await screen.findByLabelText(/Choose files/), [new File(['v'], 'One.mp4'), new File(['v'], 'Two.pdf')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove One.mp4' }));
    expect(screen.getByText('1 chosen')).toBeInTheDocument();
    expect(screen.queryByText('One.mp4')).not.toBeInTheDocument();
  });
});

describe('where does it go', () => {
  beforeEach(() => mock.signInAdmin());

  it('asks one question at a time, shows how the series will look, and saves the place', async () => {
    open('/admin/lessons/draft-safe-touch-story/place');
    expect(await screen.findByRole('heading', { name: 'Where does it go?' })).toBeInTheDocument();
    expect(screen.queryByText('Who is it for?')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('radio', { name: /Child protection/ }));
    expect(await screen.findByText('Who is it for?')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('radio', { name: /I am a child/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /Staying safe/ }));

    const select = (await screen.findByLabelText('Lesson number')) as HTMLSelectElement;
    expect(select.options).toHaveLength(5);
    expect(select.value).toBe('5');
    fireEvent.change(select, { target: { value: '2' } });
    expect(screen.getByText(/Place after Lesson 1/)).toBeInTheDocument();
    const rows = within(screen.getByText('How the series will look').parentElement as HTMLElement).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('My body belongs to me'),
      expect.stringMatching(/Safe and unsafe touch — story.*New/),
      expect.stringContaining('Safe and unsafe touch'),
      expect.stringContaining('Who can I tell?'),
      expect.stringContaining('It is not my fault'),
      expect.stringContaining('Check'),
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Next: check and publish/ }));
    expect(await screen.findByRole('heading', { name: 'Check and publish' })).toBeInTheDocument();
    const placed = getMockDb().lessons.find((lesson) => lesson.id === 'draft-safe-touch-story');
    expect(placed?.placement).toEqual({ portalId: 'child-protection', groupId: 'cp-child', seriesId: 'cp-child-staying-safe', position: 2 });
    expect(placed?.status).toBe('draft');
  });

  it('does not go on without a title or a place', async () => {
    open('/admin/lessons/draft-safe-touch-story/place');
    const title = await screen.findByLabelText('Title learners will see');
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a portal first' }));
    expect(screen.getByText('Type a title first.')).toBeInTheDocument();
    expect(screen.getByText('Learners can only find a lesson that has a place.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/lessons/draft-safe-touch-story/place');
    expect(getMockDb().lessons.find((lesson) => lesson.id === 'draft-safe-touch-story')?.placement).toBeNull();
  });

  it('starts a new series once, even when the button is tapped twice', async () => {
    open('/admin/lessons/draft-safe-touch-story/place');
    fireEvent.click(await screen.findByRole('radio', { name: /Climate/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /Floods/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start a new series' }));
    fireEvent.change(screen.getByLabelText('Name of the new series'), { target: { value: 'Rain stories' } });
    const add = screen.getByRole('button', { name: 'Add this series' });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(await screen.findByRole('radio', { name: /Rain stories/ })).toBeChecked();
    expect(getMockDb().series.filter((series) => series.title === 'Rain stories')).toHaveLength(1);
  });

  it('keeps what was typed when the save fails, and saves on the second try', async () => {
    open('/admin/lessons/draft-fatmata-science-notes/place');
    fireEvent.click(await screen.findByRole('radio', { name: /Child protection/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /I am a child/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /Staying safe/ }));
    await screen.findByLabelText('Lesson number');
    fireEvent.change(screen.getByLabelText('Title learners will see'), { target: { value: 'Science notes' } });
    mock.failNext(503);
    fireEvent.click(screen.getByRole('button', { name: /Next: check and publish/ }));
    expect(await screen.findByText('Not saved')).toBeInTheDocument();
    expect(screen.getByLabelText('Title learners will see')).toHaveValue('Science notes');
    fireEvent.click(screen.getByRole('button', { name: /Next: check and publish/ }));
    expect(await screen.findByRole('heading', { name: 'Check and publish' })).toBeInTheDocument();
    expect(getMockDb().lessons.find((lesson) => lesson.id === 'draft-fatmata-science-notes')?.title).toBe('Science notes');
  });
});

describe('check and publish', () => {
  beforeEach(() => mock.signInAdmin());

  it('will not offer Publish for a lesson that has no place', async () => {
    open('/admin/lessons/draft-safe-touch-story/check');
    expect(await screen.findByRole('heading', { name: 'Not ready yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish to learners' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Choose where it goes/ })).toHaveAttribute('href', '/admin/lessons/draft-safe-touch-story/place');
  });

  it('publishes once on a double tap and then shows where learners find it', async () => {
    const draft = getMockDb().lessons.find((lesson) => lesson.id === 'draft-safe-touch-story')!;
    draft.placement = { portalId: 'child-protection', groupId: 'cp-child', seriesId: 'cp-child-staying-safe', position: 5 };
    draft.placementLabel = 'Child protection → I am a child → Staying safe';
    draft.seriesId = 'cp-child-staying-safe';
    draft.position = 5;
    open('/admin/lessons/draft-safe-touch-story/check');
    const publish = await screen.findByRole('button', { name: 'Publish to learners' });
    expect(screen.getByText(/Read along text not added/)).toBeInTheDocument();
    mock.setDelay(20);
    fireEvent.click(publish);
    fireEvent.click(publish);
    expect(await screen.findByText('Published!')).toBeInTheDocument();
    expect(draft.status).toBe('published');
    expect(screen.getByRole('link', { name: 'See it as a learner' })).toHaveAttribute('href', '/portal/child-protection/cp-child/cp-child-staying-safe');
    expect(JSON.parse(window.localStorage.getItem('sensebod.admin.recent-published.v1') ?? '[]')).toEqual(['draft-safe-touch-story']);
  });

  it('keeps the lesson a draft and says so when publishing fails', async () => {
    const draft = getMockDb().lessons.find((lesson) => lesson.id === 'draft-safe-touch-story')!;
    draft.placement = { portalId: 'child-protection', groupId: 'cp-child', seriesId: 'cp-child-staying-safe', position: 5 };
    draft.placementLabel = 'Child protection → I am a child → Staying safe';
    open('/admin/lessons/draft-safe-touch-story/check');
    const publish = await screen.findByRole('button', { name: 'Publish to learners' });
    mock.failNext(500);
    fireEvent.click(publish);
    expect(await screen.findByText('That did not work')).toBeInTheDocument();
    expect(draft.status).toBe('draft');
    fireEvent.click(screen.getByRole('button', { name: 'Publish to learners' }));
    expect(await screen.findByText('Published!')).toBeInTheDocument();
  });
});

describe('series order', () => {
  beforeEach(() => mock.signInAdmin());

  it('moves lessons with buttons and saves the new order', async () => {
    open('/admin/series/cp-child-staying-safe');
    fireEvent.click(await screen.findByRole('button', { name: 'Move down: My body belongs to me' }));
    const list = screen.getByRole('list', { name: 'Lessons in this series, in order' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Safe and unsafe touch');
    expect(screen.getByRole('button', { name: 'Move up: Safe and unsafe touch' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    expect(await screen.findByText('Order saved')).toBeInTheDocument();
    const saved = getMockDb()
      .lessons.filter((lesson) => lesson.seriesId === 'cp-child-staying-safe' && lesson.type !== 'check')
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((lesson) => lesson.title);
    expect(saved.slice(0, 2)).toEqual(['Safe and unsafe touch', 'My body belongs to me']);
  });

  it('does not overwrite a series that changed meanwhile', async () => {
    open('/admin/series/cp-child-staying-safe');
    fireEvent.click(await screen.findByRole('button', { name: 'Move down: My body belongs to me' }));
    // Another admin removes a lesson while this one is reordering.
    const db = getMockDb();
    db.lessons = db.lessons.filter((lesson) => lesson.id !== 'cp-child-staying-safe-3');
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    expect(await screen.findByText('The series changed while you were working')).toBeInTheDocument();
    expect(db.lessons.find((lesson) => lesson.id === 'cp-child-staying-safe-1')?.position).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Load the newest order' }));
    expect(await screen.findByRole('button', { name: 'Move down: My body belongs to me' })).toBeInTheDocument();
    expect(screen.queryByText('Who can I tell?')).not.toBeInTheDocument();
  });

  it('undoes changes that were not saved', async () => {
    open('/admin/series/cp-child-staying-safe');
    fireEvent.click(await screen.findByRole('button', { name: 'Move down: My body belongs to me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
    const list = screen.getByRole('list', { name: 'Lessons in this series, in order' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('My body belongs to me');
    expect(screen.getByRole('button', { name: 'Nothing to save' })).toBeDisabled();
  });
});

describe('type it yourself', () => {
  beforeEach(() => mock.signInAdmin());

  it('keeps the words on the phone, brings them back after a refresh, and saves one lesson', async () => {
    const first = open('/admin/add/type');
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Keeping drinking water clean' } });
    fireEvent.change(screen.getByLabelText('Paragraph'), { target: { value: 'Dirty water can make people sick.' } });
    expect(screen.getByText('6 words')).toBeInTheDocument();
    // Leaving the page (a refresh, a dead battery) writes the copy at once.
    first.unmount();

    open('/admin/add/type');
    expect(await screen.findByText('Your words are still here')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Keeping drinking water clean');
    expect(screen.getByLabelText('Paragraph')).toHaveValue('Dirty water can make people sick.');

    const next = screen.getByRole('button', { name: /Next: choose where it goes/ });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(await screen.findByRole('heading', { name: 'Where does it go?' })).toBeInTheDocument();
    const made = lessonsCalled('Keeping drinking water clean');
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ type: 'read', source: 'typed', status: 'draft' });
    expect(window.localStorage.getItem('sensebod.admin.typed-draft.v1')).toBeNull();
  });

  it('asks for a title and some text before saving', async () => {
    open('/admin/add/type');
    fireEvent.click(await screen.findByRole('button', { name: /Next: choose where it goes/ }));
    expect(screen.getByText('Type a title first.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A title' } });
    fireEvent.click(screen.getByRole('button', { name: /Next: choose where it goes/ }));
    expect(screen.getByText('Write the lesson text first.')).toBeInTheDocument();
    expect(lessonsCalled('A title')).toHaveLength(0);
  });

  it('shows typed markup as plain text, never as HTML', async () => {
    open('/admin/add/type');
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: '<img src=x onerror=alert(1)>' } });
    const preview = screen.getByRole('group', { name: 'What learners will see' });
    expect(within(preview).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(preview.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('animation upload', () => {
  beforeEach(() => mock.signInAdmin());

  it('shows the checks, saves a Try it draft and goes on', async () => {
    open('/admin/add/animation');
    chooseFiles(await screen.findByLabelText(/Choose the animation file/), [new File(['zip-bytes'], 'Who can I tell.zip')]);
    expect(await screen.findByText('3 of 3 fine')).toBeInTheDocument();
    expect(screen.getByText('Opens without internet')).toBeInTheDocument();
    expect(lessonsCalled('Who can I tell')[0]).toMatchObject({ type: 'try', source: 'animation' });
    fireEvent.click(await screen.findByRole('button', { name: /Next: choose where it goes/ }));
    expect(await screen.findByRole('heading', { name: 'Where does it go?' })).toBeInTheDocument();
  });

  it('does not make a lesson from a file that fails a check', async () => {
    open('/admin/add/animation');
    chooseFiles(await screen.findByLabelText(/Choose the animation file/), [new File(['h5p'], 'Quiz.h5p')]);
    expect(await screen.findByText('Needs the H5P player on this bag')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This file cannot be used yet' })).toBeDisabled();
    expect(lessonsCalled('Quiz')).toHaveLength(0);
  });
});

describe('library', () => {
  beforeEach(() => mock.signInAdmin());

  it('lists a series with its lessons and offers the right actions', async () => {
    open('/admin/library?portalId=child-protection&groupId=cp-child&seriesId=cp-child-staying-safe');
    expect(await screen.findByRole('heading', { name: 'Series: Staying safe' })).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Change order' })).toHaveAttribute('href', '/admin/series/cp-child-staying-safe');
    fireEvent.click(screen.getByRole('button', { name: 'More actions: Who can I tell?' }));
    expect(screen.getByRole('link', { name: 'Try it setup' })).toHaveAttribute('href', '/admin/lessons/cp-child-staying-safe-3/try-it');
  });

  it('asks before deleting and deletes once', async () => {
    open('/admin/library?portalId=child-protection&groupId=cp-child&seriesId=cp-child-staying-safe');
    fireEvent.click(await screen.findByRole('button', { name: 'More actions: Who can I tell?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(getMockDb().lessons.some((lesson) => lesson.id === 'cp-child-staying-safe-3')).toBe(true);
    const yes = screen.getByRole('button', { name: 'Yes, delete it' });
    await act(async () => {
      fireEvent.click(yes);
      fireEvent.click(yes);
    });
    await waitFor(() => expect(screen.queryByText('Who can I tell?')).not.toBeInTheDocument());
    expect(getMockDb().lessons.some((lesson) => lesson.id === 'cp-child-staying-safe-3')).toBe(false);
  });

  it('shows an empty state when nothing matches the search', async () => {
    open('/admin/library');
    fireEvent.change(await screen.findByLabelText('Search lessons'), { target: { value: 'zzzz-nothing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No lessons match')).toBeInTheDocument();
  });

  it('shows the error and recovers when the list cannot be loaded', async () => {
    // Sign-in is checked on another screen first, so only the library's own calls fail.
    const menu = open('/admin/menu');
    await screen.findByRole('heading', { name: 'Menu' });
    menu.unmount();
    mock.failNext(503, 3);
    open('/admin/library');
    expect(await screen.findByText('The lessons did not load')).toBeInTheDocument();
    const section = screen.getByText('The lessons did not load').closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(section).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('questions', () => {
  beforeEach(() => mock.signInAdmin());

  it('will not save an unfinished question, then saves the set', async () => {
    open('/admin/lessons/cp-child-staying-safe-4/questions');
    expect(await screen.findByRole('heading', { name: '2 questions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add question here' }));
    expect(screen.getByRole('heading', { name: 'Question 3 of 3' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('1 question is not finished')).toBeInTheDocument();
    expect(screen.getByText('Type the question.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Who can you tell?' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Answer 1/ }), { target: { value: 'A grown-up I trust' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Answer 2/ }), { target: { value: 'Nobody' } });
    fireEvent.change(screen.getByLabelText('Feedback when right'), { target: { value: 'Yes. Tell a grown-up you trust.' } });
    fireEvent.change(screen.getByLabelText('Feedback when wrong'), { target: { value: 'You can always tell someone.' } });
    fireEvent.change(screen.getByLabelText('Video stops at'), { target: { value: '0:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved in this bag')).toBeInTheDocument();
    const lesson = getMockDb().lessons.find((entry) => entry.id === 'cp-child-staying-safe-4')!;
    expect(lesson.questionCount).toBe(3);
    expect(lesson.content.type === 'watch' && lesson.content.questions.some((q) => q.prompt === 'Who can you tell?' && q.atSeconds === 15)).toBe(true);
  });
});
