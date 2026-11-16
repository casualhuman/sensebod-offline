import { installMockApi, type MockApiHandle } from '@mock/installMockFetch';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { learnerApi, type Learner } from '@shared/api';
import { paths, Routes } from '@shared/router';
import { getSession, learnAsGuest, setLearner } from '@shared/session';
import { routes } from './routes';

const AMINATA: Learner = { id: 'learner-aminata', name: 'Aminata Kamara', role: 'learner', roleLabel: 'Learner · JSS 2' };
const MOHAMED: Learner = { id: 'learner-mohamed', name: 'Mohamed Sesay', role: 'other', roleLabel: 'Farmer' };
const CHILD_SERIES = paths.series('child-protection', 'cp-child', 'cp-child-staying-safe');

let mock: MockApiHandle;
beforeEach(() => {
  mock = installMockApi();
});

function open(path: string) {
  window.history.replaceState(null, '', path);
  return render(
    <Suspense fallback={<p>Opening…</p>}>
      <Routes routes={routes} notFound={<p>no route</p>} />
    </Suspense>,
  );
}

function tap(element: HTMLElement) {
  fireEvent.click(element, { button: 0 });
}

describe('Home (Main)', () => {
  it('shows the five portals and offers a guest to add a name', async () => {
    open('/');
    expect(await screen.findByRole('link', { name: /Primary school/ })).toHaveAttribute('href', '/portal/primary');
    expect(screen.getByRole('link', { name: /Junior secondary/ })).toHaveAttribute('href', '/portal/jss');
    expect(screen.getByRole('link', { name: /Child protection/ })).toHaveAttribute('href', '/portal/child-protection');
    expect(screen.getByRole('link', { name: /Agriculture/ })).toHaveAttribute('data-theme', 'agriculture');
    expect(screen.getByRole('link', { name: /Climate/ })).toHaveAttribute('href', '/portal/climate');
    // Games sits with the portals (and in the header).
    expect(screen.getByText('Play and learn: coding, maths, puzzles and more').closest('a')).toHaveAttribute('href', '/games');
    // Who is learning lives in the header, not in a card on the page.
    expect(screen.queryByText('You are a guest')).not.toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/save-progress');
    expect(screen.getByText('Kushɛ!')).toHaveAttribute('lang', 'kri');
  });

  it('says who is learning instead of the guest card', async () => {
    setLearner(AMINATA);
    open('/');
    await screen.findByRole('link', { name: /Primary school/ });
    expect(screen.getByText('Aminata')).toBeInTheDocument();
    expect(screen.queryByText('You are a guest')).not.toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Learning as Aminata. Sign out or change' })).toHaveAttribute('href', '/save-progress');
  });

  it('shows an error with Try again when the bag does not answer, and recovers', async () => {
    mock.failNext(503);
    open('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('The portals did not open');
    tap(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Climate/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Sign in (V3-SignIn, with a secret number)', () => {
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('a new learner answers one question at a time: name, who, secret number', async () => {
    open('/save-progress?from=%2Fportal%2Fagriculture');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Used this phone before?')).not.toBeInTheDocument();
    tap(screen.getByRole('button', { name: 'I am new here' }));

    // 1: the name, and nothing else.
    expect(screen.getByRole('heading', { level: 1, name: 'What is your name?' })).toBeInTheDocument();
    tap(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Type your name first.');
    type('Your name', '  Fatmata  ');
    tap(screen.getByRole('button', { name: 'Next' }));
    // 2: who you are, one tap.
    expect(screen.getByRole('heading', { level: 1, name: 'Hello, Fatmata! Who are you?' })).toBeInTheDocument();
    tap(screen.getByRole('button', { name: 'Teacher' }));
    // 3: the secret number; only digits are kept, four at most.
    expect(screen.getByRole('heading', { level: 1, name: 'Choose a secret number' })).toBeInTheDocument();
    expect(getSession().learner).toBeNull();
    tap(screen.getByRole('button', { name: 'Save and start learning' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Type 4 numbers.');
    type('Your secret number', '2a5-8 09');
    expect(screen.getByLabelText('Your secret number')).toHaveValue('2580');
    tap(screen.getByRole('button', { name: 'Save and start learning' }));

    expect(await screen.findByRole('heading', { name: 'Agriculture' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/portal/agriculture');
    expect(getSession().learner).toMatchObject({ name: 'Fatmata', role: 'teacher' });
    expect(JSON.stringify(getSession())).not.toContain('2580');
    expect(screen.getByRole('status')).toHaveTextContent('Your progress is saved in this bag, Fatmata.');
  });

  it('two learners with the same name are told apart by their numbers, and each signs in again as themselves', async () => {
    const first = await learnerApi.createLearner({ name: 'Abdul', role: 'learner', pin: '1111' });
    const second = await learnerApi.createLearner({ name: 'Abdul', role: 'learner', pin: '2222' });
    expect(second.id).not.toBe(first.id);

    // A third Abdul who picks a number already used with that name is asked for another.
    open('/save-progress');
    tap(await screen.findByRole('button', { name: 'I am new here' }));
    type('Your name', 'Abdul');
    tap(screen.getByRole('button', { name: 'Next' }));
    tap(screen.getByRole('button', { name: 'Learner' }));
    type('Your secret number', '1111');
    tap(screen.getByRole('button', { name: 'Save and start learning' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a different number.');
    expect(getSession().learner).toBeNull();
    cleanup();

    // "I have a name already": name + number finds the right Abdul.
    open('/save-progress');
    tap(await screen.findByRole('button', { name: 'I have a name already' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument();
    type('Your name', 'abdul');
    type('Your secret number', '9999');
    tap(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The name or the number is not right. Try again.');
    expect(screen.getByLabelText('Your secret number')).toHaveValue('');
    type('Your secret number', '2222');
    tap(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(getSession().learner).toMatchObject({ id: second.id }));
    expect(window.location.pathname).toBe('/');
    expect(await screen.findByRole('status')).toHaveTextContent('Welcome back, Abdul. You are signed in.');
  });

  it('keeps what was typed when saving fails, and a second try saves one learner', async () => {
    open('/save-progress');
    tap(await screen.findByRole('button', { name: 'I am new here' }));
    type('Your name', 'Ibrahim');
    tap(screen.getByRole('button', { name: 'Next' }));
    tap(screen.getByRole('button', { name: 'Learner' }));
    type('Your secret number', '4321');
    mock.failNext(503);
    tap(screen.getByRole('button', { name: 'Save and start learning' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your name was not saved');
    expect(screen.getByLabelText('Your secret number')).toHaveValue('4321');
    expect(getSession().learner).toBeNull();

    tap(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getSession().learner).toMatchObject({ name: 'Ibrahim' }));
    expect(getSession().knownLearners).toHaveLength(1);
    expect(window.location.pathname).toBe('/');
  });

  it('a name used on this phone before still needs its number', async () => {
    setLearner(MOHAMED);
    setLearner(AMINATA);
    learnAsGuest();
    open('/save-progress');
    const list = (await screen.findByText('Used this phone before?')).closest('.sb-card') as HTMLElement;
    tap(within(list).getByRole('button', { name: 'Mohamed Sesay' }));
    expect(getSession().learner).toBeNull();
    expect(screen.getByLabelText('Your name')).toHaveValue('Mohamed Sesay');
    type('Your secret number', '1234');
    tap(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(getSession().learner).toMatchObject({ id: 'learner-mohamed' }));
    expect(window.location.pathname).toBe('/');
  });

  it('signs out: the phone goes back to guest and the name stays in the short list', async () => {
    setLearner(AMINATA);
    open('/save-progress?from=%2Fportal%2Fclimate');
    // Signed in: the screen is only about that person. No "I am new here", no other names.
    expect(await screen.findByRole('heading', { level: 1, name: 'You are signed in' })).toBeInTheDocument();
    expect(screen.getByText('Aminata Kamara')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I am new here' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I have a name already' })).not.toBeInTheDocument();
    expect(screen.queryByText('Used this phone before?')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Not now, learn as a guest' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Keep learning' })).toHaveAttribute('href', '/portal/climate');
    tap(screen.getByRole('button', { name: 'Sign out' }));
    expect(getSession().learner).toBeNull();
    expect(getSession().knownLearners).toHaveLength(1);
    expect(screen.queryByText('You are signed in')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I am new here' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    tap(screen.getByRole('link', { name: 'Not now, learn as a guest' }));
    expect(window.location.pathname).toBe('/portal/climate');
  });

  it('removes a name only after asking, from the phone and from the bag', async () => {
    setLearner(AMINATA);
    learnAsGuest();
    open('/save-progress');
    tap(await screen.findByRole('button', { name: 'Remove a name' }));
    tap(screen.getByRole('button', { name: 'Remove Aminata Kamara' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Their saved progress in this bag will be removed too.');
    expect(getSession().knownLearners).toHaveLength(1);

    tap(screen.getByRole('button', { name: 'Yes, remove Aminata Kamara' }));
    await waitFor(() => expect(getSession().knownLearners).toHaveLength(0));
    expect(getSession().learner).toBeNull();
    const answer = await fetch('/api/v1/learners/learner-aminata');
    expect(answer.status).toBe(404);
    expect(screen.queryByText('Used this phone before?')).not.toBeInTheDocument();
  });

  it('never returns to an address outside the app', async () => {
    open('/save-progress?from=%2F%2Fexample.org%2Fx');
    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Not now, learn as a guest' })).toHaveAttribute('href', '/');
  });
});

describe('Primary and JSS (V3-Primary, V3-JSS)', () => {
  it('asks for the class first, then shows that class’s subjects without leaving the page', async () => {
    open('/portal/primary');
    expect(await screen.findByRole('heading', { name: 'Which class are you in?' })).toBeInTheDocument();
    const classes = screen.getByRole('list', { name: 'Choose your class' });
    expect(within(classes).getAllByRole('link')).toHaveLength(6);
    expect(screen.queryByText('Step 2 of 2')).not.toBeInTheDocument();

    tap(within(classes).getByRole('link', { name: 'Class 4' }));
    expect(window.location.pathname).toBe('/portal/primary/primary-class-4');
    const subjects = await screen.findByRole('heading', { name: 'Class 4 subjects' });
    expect(await screen.findByRole('link', { name: /Mathematics/ })).toHaveAttribute('href', '/portal/primary/primary-class-4/primary-class-4-mathematics');
    expect(screen.getByRole('link', { name: /Mathematics/ })).toHaveTextContent('Start at Lesson 1 of 10');
    await waitFor(() => expect(subjects).toHaveFocus());
    expect(within(classes).getByRole('link', { name: /Class 4/ })).toHaveAttribute('aria-current', 'true');
    expect(within(classes).getByRole('link', { name: /Class 4/ })).toHaveTextContent('Your class');
    // Listed, but not in this bag: words and a dashed card, never a link.
    expect(screen.getByText('Social Studies').closest('a')).toBeNull();
    expect(screen.getByText('Not in this bag yet. Ask your teacher.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/portal/primary');
  });

  it('offers the practice quiz of a JSS class and links it to the lesson player', async () => {
    open('/portal/jss/jss-2');
    expect(await screen.findByRole('heading', { name: 'JSS 2 subjects' })).toBeInTheDocument();
    const quiz = await screen.findByRole('link', { name: /Practice quiz/ });
    expect(quiz).toHaveAttribute('href', '/lesson/jss-2-integrated-science-quiz');
    expect(quiz).toHaveTextContent('Start the quiz');
    expect(screen.getByRole('link', { name: /Integrated Science.*Start at Lesson 1 of 12/ })).toHaveAttribute('href', '/portal/jss/jss-2/jss-2-integrated-science');
  });

  it('lists a subject’s lessons in order with the quiz last, and goes back to the class', async () => {
    open('/portal/jss/jss-2/jss-2-integrated-science');
    expect(await screen.findByRole('heading', { level: 1, name: 'Integrated Science' })).toBeInTheDocument();
    const cards = screen.getAllByRole('link').filter((link) => (link.getAttribute('href') ?? '').indexOf('/lesson/') === 0);
    expect(cards).toHaveLength(13);
    expect(cards[0]).toHaveAttribute('href', '/lesson/jss-2-integrated-science-1');
    expect(cards[3]).toHaveTextContent('Kinds of matter');
    expect(cards[12]).toHaveAttribute('href', '/lesson/jss-2-integrated-science-quiz');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/portal/jss/jss-2');
  });

  it('says so when a class is not in this bag', async () => {
    open('/portal/primary/primary-class-9');
    expect(await screen.findByText('This page is not in this bag')).toBeInTheDocument();
  });
});

describe('Agriculture and Climate (AGB-Agriculture, CLB-Climate)', () => {
  it('shows the topics in green with real counts, progress and Continue where you stopped', async () => {
    setLearner(AMINATA);
    const { container } = open('/portal/agriculture');
    expect(await screen.findByRole('heading', { name: 'Choose a topic' })).toBeInTheDocument();
    expect(container.querySelector('.sb-shell')).toHaveAttribute('data-theme', 'agriculture');
    expect(screen.getByText('All topics here are videos to watch.')).toBeInTheDocument();

    const topics = within(screen.getByRole('region', { name: 'Choose a topic' }));
    const chickens = await topics.findByRole('link', { name: /Chickens and quail/ });
    expect(chickens).toHaveAttribute('href', '/portal/agriculture/agriculture-chickens-and-quail/agriculture-chickens-and-quail-videos');
    expect(chickens).toHaveTextContent('Watch · 12 videos');
    await waitFor(() => expect(chickens).toHaveTextContent('1 of 12 done'));
    expect(screen.getByRole('link', { name: /Milk and dairy cows/ })).toHaveTextContent('All done. Well done!');
    expect(screen.getByRole('link', { name: /Feed and animal health/ })).toHaveTextContent('27 videos');
    expect(screen.getByRole('link', { name: /Rabbits/ })).toHaveTextContent('Not started');
    expect(screen.getByText('Crops').closest('a')).toBeNull();

    const resume = within(await screen.findByRole('region', { name: 'Continue where you stopped' })).getByRole('link');
    expect(resume).toHaveAttribute('href', '/lesson/agriculture-chickens-and-quail-videos-2');
    expect(resume).toHaveTextContent('Lesson 2 of 12');
    expect(resume).toHaveTextContent('Quail housing');
    expect(resume).toHaveTextContent('Watch video');
  });

  it('shows a guest every topic as not started, with a way to add a name', async () => {
    open('/portal/agriculture');
    const chickens = await screen.findByRole('link', { name: /Chickens and quail/ });
    expect(chickens).toHaveTextContent('Not started');
    expect(screen.queryByRole('region', { name: 'Continue where you stopped' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/save-progress?from=%2Fportal%2Fagriculture');
  });

  it('lists a topic’s videos without a filter (one type only), quiz at the end', async () => {
    open('/portal/agriculture/agriculture-chickens-and-quail/agriculture-chickens-and-quail-videos');
    expect(await screen.findByRole('heading', { level: 1, name: 'Chickens and quail' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Show lessons by type' })).not.toBeInTheDocument();
    const cards = screen.getAllByRole('link').filter((link) => (link.getAttribute('href') ?? '').indexOf('/lesson/') === 0);
    expect(cards).toHaveLength(13);
    expect(cards[12]).toHaveTextContent('Quick quiz: keeping quail');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/portal/agriculture');
  });

  it('shows the Climate topics, one of them not in this bag', async () => {
    open('/portal/climate');
    expect(await screen.findByRole('link', { name: /Floods: stay safe/ })).toHaveAttribute('href', '/portal/climate/climate-floods-stay-safe/climate-floods-stay-safe-lessons');
    expect(screen.getByText('Growing food when the weather changes').closest('a')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Leave this page' })).not.toBeInTheDocument();
  });

  it('forgets a name that is no longer in the bag and says so', async () => {
    setLearner({ id: 'learner-gone', name: 'Kadiatu', role: 'learner', roleLabel: 'Learner' });
    open('/portal/climate');
    await screen.findByRole('link', { name: /Floods: stay safe/ });
    await waitFor(() => expect(getSession().learner).toBeNull());
    expect(getSession().knownLearners).toHaveLength(0);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('Child protection', () => {
  function expectSafeFrame() {
    expect(screen.getByRole('link', { name: 'Leave this page' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getAllByRole('button', { name: 'Listen' }).length).toBeGreaterThan(0);
  }

  it('Who are you? offers the three audiences and Get help now (CPB-Who)', async () => {
    open('/portal/child-protection');
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expectSafeFrame();
    const child = screen.getByRole('link', { name: /I am a child/ });
    expect(child).toHaveAttribute('href', CHILD_SERIES);
    expect(child).toHaveTextContent('This is me');
    expect(screen.getByRole('link', { name: /I am a parent or carer/ })).toHaveAttribute('href', '/portal/child-protection/cp-parent/cp-parent-keeping-children-safe');
    expect(screen.getByRole('link', { name: /I am a community elder/ })).toHaveAttribute('href', '/portal/child-protection/cp-elder/cp-elder-protecting-our-children');
    expect(screen.getByRole('link', { name: 'Get help now' })).toHaveAttribute('href', '/portal/child-protection/help');
    // No name is shown or asked for on these pages.
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('lists the child lessons in order, filters by type and always keeps the Check (CPB-Child)', async () => {
    setLearner(AMINATA);
    open(CHILD_SERIES);
    expect(await screen.findByRole('heading', { level: 1, name: 'Staying safe' })).toBeInTheDocument();
    expectSafeFrame();
    expect(screen.getByText('I am a child', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/portal/child-protection');
    expect(getSession().childProtectionAudience).toBe('cp-child');
    expect(screen.queryByText(/Learning as/)).not.toBeInTheDocument();

    const lessons = () => screen.getAllByRole('link').filter((link) => (link.getAttribute('href') ?? '').indexOf('/lesson/') === 0);
    expect(lessons().map((link) => link.getAttribute('href'))).toEqual([
      '/lesson/cp-child-staying-safe-1',
      '/lesson/cp-child-staying-safe-2',
      '/lesson/cp-child-staying-safe-3',
      '/lesson/cp-child-staying-safe-4',
      '/lesson/cp-child-staying-safe-quiz',
    ]);
    expect(lessons()[3]).toHaveTextContent('Watch and answer');
    expect(lessons()[3]).toHaveTextContent('You take part');

    // Progress in words first, for the learner who saves it.
    const progress = await screen.findByRole('region', { name: 'Your progress' });
    expect(progress).toHaveTextContent('You finished 1 of 4 lessons');
    expect(progress).toHaveTextContent('1 finished · 1 started · 2 to go');
    expect(lessons()[0]).toHaveTextContent('Finished');
    expect(lessons()[1]).toHaveTextContent('Started');

    // The filter offers the types this series has (the board shows four buttons).
    const filter = screen.getByRole('group', { name: 'Show lessons by type' });
    expect(within(filter).getAllByRole('button').map((button) => button.textContent)).toEqual(['All', 'Watch', 'Listen', 'Try it']);
    tap(within(filter).getByRole('button', { name: 'Watch' }));
    expect(within(filter).getByRole('button', { name: 'Watch' })).toHaveAttribute('aria-pressed', 'true');
    expect(lessons().map((link) => link.getAttribute('href'))).toEqual(['/lesson/cp-child-staying-safe-1', '/lesson/cp-child-staying-safe-4', '/lesson/cp-child-staying-safe-quiz']);
    expect(screen.getByText('Showing 2 lessons to watch and the quiz.')).toBeInTheDocument();
    tap(within(filter).getByRole('button', { name: 'All' }));
    expect(lessons()).toHaveLength(5);

    expect(screen.getByRole('heading', { name: 'Talk to someone you trust' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get help now' })).toHaveAttribute('href', '/portal/child-protection/help');
    expect(screen.getByText('It is never your fault.')).toBeInTheDocument();
  });

  it('shows no progress panel to a guest', async () => {
    open(CHILD_SERIES);
    await screen.findByRole('heading', { level: 1, name: 'Staying safe' });
    expect(screen.queryByRole('region', { name: 'Your progress' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Not started')).toHaveLength(5);
  });

  it('opens an audience by its group address and offers Read to parents (CPB-Parent)', async () => {
    open('/portal/child-protection/cp-parent');
    expect(await screen.findByRole('heading', { level: 1, name: 'Keeping children safe' })).toBeInTheDocument();
    expectSafeFrame();
    const filter = screen.getByRole('group', { name: 'Show lessons by type' });
    expect(within(filter).getAllByRole('button').map((button) => button.textContent)).toEqual(['All', 'Watch', 'Listen', 'Read', 'Try it']);
    tap(within(filter).getByRole('button', { name: 'Read' }));
    const shown = screen.getAllByRole('link').filter((link) => (link.getAttribute('href') ?? '').indexOf('/lesson/') === 0);
    expect(shown.map((link) => link.getAttribute('href'))).toEqual(['/lesson/cp-parent-keeping-children-safe-5', '/lesson/cp-parent-keeping-children-safe-quiz']);
    expect(shown[0]).toHaveTextContent('[pages] pages');
    expect(screen.getByText('Worried about a child?')).toBeInTheDocument();
  });

  it('gives elders the four steps with the referral contact still a placeholder (CPB-Elder)', async () => {
    open('/portal/child-protection/cp-elder/cp-elder-protecting-our-children');
    expect(await screen.findByRole('heading', { name: 'What to do if a child tells you' })).toBeInTheDocument();
    expectSafeFrame();
    const steps = screen.getAllByRole('listitem').filter((item) => item.className === 'lrn-steps__item');
    expect(steps.map((item) => item.querySelector('.lrn-steps__title')?.textContent)).toEqual(['Step 1: Listen', 'Step 2: Believe', 'Step 3: Keep them safe', 'Step 4: Report']);
    expect(steps[3]).toHaveTextContent('[Local referral contact — confirm]');
    expect(screen.getByRole('link', { name: 'See where to report' })).toHaveAttribute('href', '/portal/child-protection/help');
  });

  it('Get help now keeps every contact a marked placeholder and never a link to dial (CPB-Help)', async () => {
    const { container } = open('/portal/child-protection/help');
    expect(await screen.findByRole('heading', { level: 1, name: 'Get help now' })).toBeInTheDocument();
    expectSafeFrame();
    expect(screen.getByRole('heading', { name: 'If you are in danger now' })).toBeInTheDocument();
    for (const placeholder of ['[Emergency number — confirm]', '[Child helpline number — confirm]', '[Family Support Unit contact — confirm]', '[Nearest police station — confirm]']) {
      expect(screen.getByText(placeholder, { exact: false })).toBeInTheDocument();
    }
    expect(container.querySelector('a[href^="tel:"], a[href^="http"], a[href^="sms:"]')).toBeNull();
    // No digits anywhere in the contact boxes: nothing has been invented.
    container.querySelectorAll('.lrn-contact').forEach((node) => expect(node.textContent).not.toMatch(/\d/));
    expect(screen.getByRole('link', { name: 'Back to Child protection' })).toHaveAttribute('href', '/portal/child-protection');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/portal/child-protection');
  });

  it('Leave this page goes Home and forgets who was reading', async () => {
    open(CHILD_SERIES);
    await screen.findByRole('heading', { level: 1, name: 'Staying safe' });
    expect(getSession().childProtectionAudience).toBe('cp-child');
    act(() => tap(screen.getByRole('link', { name: 'Leave this page' })));
    expect(window.location.pathname).toBe('/');
    expect(getSession().childProtectionAudience).toBeNull();
    expect(await screen.findByRole('heading', { name: 'What do you want to learn today?' })).toBeInTheDocument();
  });

  it('keeps Leave this page while loading and when the bag does not answer', async () => {
    mock.setDelay(50);
    mock.failNext(503, 2);
    open(CHILD_SERIES);
    expect(await screen.findByRole('status')).toHaveTextContent('Opening the lessons…');
    expect(screen.getByRole('link', { name: 'Leave this page' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('This page did not open');
    expect(screen.getByRole('link', { name: 'Leave this page' })).toBeInTheDocument();
    mock.setDelay(0);
    tap(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Staying safe' })).toBeInTheDocument();
  });

  it('does not show a series under another portal’s address', async () => {
    open('/portal/climate/cp-child/cp-child-staying-safe');
    expect(await screen.findByText('This page is not in this bag')).toBeInTheDocument();
    expect(screen.queryByText('Staying safe')).not.toBeInTheDocument();
  });
});

describe('unknown addresses', () => {
  it('offers a way Home for a portal that does not exist', async () => {
    open('/portal/nowhere');
    expect(await screen.findByText('This page is not in this bag')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });
});
