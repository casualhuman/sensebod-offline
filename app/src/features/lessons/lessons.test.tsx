/*
 * The lesson screens against the mock API, one lesson of each type.
 * jsdom has no media engine, so <video>/<audio> are driven by hand: the
 * tests stub play / pause / load / canPlayType and fire the media events.
 */
import { installMockApi } from '@mock/installMockFetch';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate, Routes } from '@shared/router';
import { setLearner } from '@shared/session';
import { resetFinishRecordForTests } from './progress/progress';
import { routes } from './routes';

let mock: ReturnType<typeof installMockApi>;
let canPlay = 'maybe';
const play = vi.fn();
const pause = vi.fn();
const load = vi.fn();
/** Every request the screens made, as "METHOD /path". */
let requests: string[] = [];

beforeEach(() => {
  mock = installMockApi();
  resetFinishRecordForTests();
  canPlay = 'maybe';
  requests = [];
  play.mockReset().mockImplementation(() => Promise.resolve());
  // Like a real element, pausing reports itself with a "pause" event.
  pause.mockReset().mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'));
  });
  load.mockReset();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: load });
  Object.defineProperty(HTMLMediaElement.prototype, 'canPlayType', { configurable: true, value: () => canPlay });
  // Record requests; answer /media/ (not part of the API mock) like the Pi would.
  const api = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(`${(init?.method ?? 'GET').toUpperCase()} ${url}`);
    if (url.indexOf('/media/') === 0) return Promise.resolve(new Response(null, { status: url.indexOf('missing') === -1 ? 200 : 404 }));
    return api(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
});

function open(path: string) {
  window.history.replaceState(null, '', path);
  return render(<Routes routes={routes} notFound={<p>not found</p>} />);
}

function media(): HTMLMediaElement {
  const element = document.querySelector('video, audio');
  if (!element) throw new Error('no media element');
  return element as HTMLMediaElement;
}

/** Pretend the media engine reached `seconds` and fire `event`. */
function at(seconds: number, event = 'timeupdate', extra: Record<string, unknown> = {}) {
  const element = media();
  Object.defineProperty(element, 'currentTime', { configurable: true, writable: true, value: seconds });
  Object.defineProperty(element, 'duration', { configurable: true, value: 20 });
  Object.keys(extra).forEach((key) => Object.defineProperty(element, key, { configurable: true, value: extra[key] }));
  act(() => {
    // A real engine reports the length before anything else happens.
    if (event === 'playing' || event === 'timeupdate') element.dispatchEvent(new Event('durationchange'));
    element.dispatchEvent(new Event(event));
  });
}

const aminata = { id: 'learner-aminata', name: 'Aminata', role: 'learner' as const, roleLabel: 'Learner' };

describe('every lesson screen', () => {
  it('shows a loading state, then the lesson', async () => {
    mock.setDelay(30);
    open('/lesson/cp-child-staying-safe-1');
    expect(screen.getByText('Opening the lesson…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'My body belongs to me' })).toBeInTheDocument();
  });

  it('shows an error with Try again when the bag does not answer, and recovers', async () => {
    mock.failNext(503);
    open('/lesson/cp-child-staying-safe-1');
    expect(await screen.findByText('This lesson did not open')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My body belongs to me' })).toBeInTheDocument();
  });

  it('says so when the lesson is not in this bag, with a way out', async () => {
    open('/lesson/no-such-lesson');
    expect(await screen.findByText('This is not in this bag.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });

  it('Child protection lessons keep Leave this page, Back, Home, Listen and Get help now', async () => {
    open('/lesson/cp-child-staying-safe-1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('link', { name: 'Leave this page' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/portal/child-protection/cp-child/cp-child-staying-safe');
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Listen' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Get help now' })).toHaveAttribute('href', '/portal/child-protection/help');
  });

  it('names the next lesson and links to it', async () => {
    open('/lesson/cp-child-staying-safe-1');
    const next = await screen.findByRole('link', { name: /Next: Lesson 2 · Listen/ });
    expect(next).toHaveAttribute('href', '/lesson/cp-child-staying-safe-2');
    expect(within(next).getByText('Safe and unsafe touch')).toBeInTheDocument();
  });

  it('a guest sends nothing about progress', async () => {
    open('/lesson/cp-child-staying-safe-1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/learning as a guest/)).toBeInTheDocument();
    expect(requests.filter((request) => request.indexOf('/learners/') !== -1)).toEqual([]);
  });

  it('a saved learner sees the series progress in words and the lesson is marked started', async () => {
    setLearner(aminata);
    open('/lesson/cp-child-staying-safe-3');
    expect(await screen.findByText(/1 finished · doing this now · 2 to go/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Lesson 1 finished. Lesson 2 started. Doing lesson 3 now. Lesson 4 not started./ })).toBeInTheDocument();
    await waitFor(() => expect(requests).toContain('PUT /api/v1/learners/learner-aminata/progress/cp-child-staying-safe-3'));
  });

  it('gives the next lesson a fresh player when only the lesson id changes', async () => {
    open('/lesson/cp-child-staying-safe-quiz');
    fireEvent.click(await screen.findByRole('radio', { name: /Nobody/ }));
    expect(screen.getByText('Let’s think again')).toBeInTheDocument();
    act(() => navigate('/lesson/cp-parent-keeping-children-safe-quiz'));
    await screen.findByText('Quiz · Keeping children safe');
    expect(screen.queryByText('Let’s think again')).not.toBeInTheDocument();
    expect(screen.getByText('Tap the answer you think is right.')).toBeInTheDocument();
  });
});

describe('Watch', () => {
  it('state A: never plays or loads by itself', async () => {
    open('/lesson/cp-child-staying-safe-1');
    await screen.findByRole('button', { name: 'Play video' });
    const video = media();
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.hasAttribute('src')).toBe(false);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(document.querySelector('track')).toBeNull();
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByText('Tap Play when you are ready.')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('state B: Play attaches the file, then shows the labelled controls and captions', async () => {
    open('/lesson/cp-child-staying-safe-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    const video = media();
    expect(video.getAttribute('src')).toBe('/media/sample-video.mp4');
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    at(3, 'playing');
    at(3);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back 10s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forward 10s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Captions on' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('track')).toHaveAttribute('src', '/media/sample-captions.vtt');
    const slider = screen.getByRole('slider', { name: 'Video time' });
    expect(slider).toHaveAttribute('aria-valuetext', '3 seconds of 20 seconds');
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10s' }));
    expect(video.currentTime).toBe(13);
    fireEvent.change(slider, { target: { value: '5' } });
    expect(video.currentTime).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: 'Back 10s' }));
    expect(video.currentTime).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Captions on' }));
    expect(screen.getByRole('button', { name: 'Captions off' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Sound' }));
    expect(video.muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Sound off' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('state C: finished, with the next lesson and Watch again', async () => {
    open('/lesson/cp-child-staying-safe-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    at(20, 'ended', { ended: true });
    expect(screen.getByText('You finished this video.')).toBeInTheDocument();
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next lesson' })).toHaveAttribute('href', '/lesson/cp-child-staying-safe-2');
    expect(screen.getByRole('link', { name: 'Back to lessons' })).toBeInTheDocument();
    play.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Watch again' }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('saves the finished video for a learner and says so', async () => {
    setLearner(aminata);
    open('/lesson/cp-child-staying-safe-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    at(20, 'ended', { ended: true });
    expect(await screen.findByText('Saved for Aminata')).toBeInTheDocument();
  });

  it('says so when saving fails, and saves on Try again', async () => {
    setLearner(aminata);
    open('/lesson/cp-child-staying-safe-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    await waitFor(() => expect(requests.filter((request) => request.indexOf('PUT') === 0)).toHaveLength(1));
    mock.failNext(503);
    at(20, 'ended', { ended: true });
    expect(await screen.findByText('Your progress is not saved yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Saved for Aminata')).toBeInTheDocument();
  });

  it('fallback: a phone that cannot decode the video is told so, and nothing is requested', async () => {
    canPlay = '';
    open('/lesson/cp-child-staying-safe-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This video cannot play on this phone');
    expect(media().hasAttribute('src')).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Next: Lesson 2/ })).toBeInTheDocument();
  });

  it('fallback: a decode error after loading shows the same plain message', async () => {
    open('/lesson/cp-child-staying-safe-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    at(0, 'error', { error: { code: 4 } });
    expect(screen.getByRole('alert')).toHaveTextContent('This video cannot play on this phone');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('a dropped connection offers Try again and carries on from the same place', async () => {
    open('/lesson/cp-child-staying-safe-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    at(7, 'playing');
    at(7, 'error', { error: { code: 2 } });
    expect(screen.getByRole('alert')).toHaveTextContent('The video stopped');
    play.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(play).toHaveBeenCalledTimes(1);
    at(0, 'loadedmetadata');
    expect(media().currentTime).toBe(7);
  });

  it('releases the media when the screen goes away', async () => {
    const view = open('/lesson/cp-child-staying-safe-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    const video = media();
    pause.mockClear();
    view.unmount();
    expect(pause).toHaveBeenCalled();
    expect(video.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('carries on from the saved place for a learner', async () => {
    setLearner(aminata);
    open('/lesson/agriculture-chickens-and-quail-videos-2');
    expect(await screen.findByText('Tap Play to carry on from where you stopped (0:08).')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    at(0, 'loadedmetadata');
    expect(media().currentTime).toBe(8);
  });

  it('Agriculture lessons use the green theme and put the title under the player', async () => {
    open('/lesson/agriculture-chickens-and-quail-videos-2');
    const title = await screen.findByRole('heading', { level: 1, name: 'Quail housing' });
    expect(document.querySelector('[data-theme="agriculture"]')).not.toBeNull();
    const player = screen.getByRole('region', { name: 'Video player' });
    expect(player.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Chickens and quail · Lesson 2 of 12/)).toBeInTheDocument();
  });
});

describe('Watch and answer', () => {
  async function toQuestion() {
    open('/lesson/cp-child-staying-safe-4');
    fireEvent.click(await screen.findByRole('button', { name: 'Play video' }));
    at(2, 'playing');
    pause.mockClear();
    at(6.1);
  }

  it('pauses for the question and waits for the answer', async () => {
    await toQuestion();
    expect(pause).toHaveBeenCalled();
    expect(screen.getByText('Paused for a question')).toBeInTheDocument();
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('If an adult hurts a child, whose fault is it?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tap an answer first' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Full screen' })).not.toBeInTheDocument();
  });

  it('a wrong answer is gentle and can be changed; the right one continues the video', async () => {
    await toQuestion();
    fireEvent.click(screen.getByRole('radio', { name: /It is the child’s fault/ }));
    expect(screen.getByText('Let’s think again')).toBeInTheDocument();
    expect(screen.getByText('A child is never to blame. Tap the other answer.')).toBeInTheDocument();
    expect(screen.getByText('It is OK to try again. Choose another answer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tap an answer first' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /It is never the child’s fault/ }));
    expect(screen.getByText('Yes, that is right')).toBeInTheDocument();
    expect(screen.getByText('The adult is always responsible. You did nothing wrong.')).toBeInTheDocument();
    play.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Continue video' }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Question 1 of 2')).not.toBeInTheDocument();
    at(7);
    expect(screen.queryByText('Paused for a question')).not.toBeInTheDocument();
  });

  it('seeking forward cannot jump over a question; going back to watch again is allowed', async () => {
    await toQuestion();
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10s' }));
    expect(media().currentTime).toBe(6.1);
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back 10s' }));
    expect(media().currentTime).toBe(0);
    expect(screen.queryByText('Question 1 of 2')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '18' } });
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
    expect(media().currentTime).toBe(6);
  });

  it('saves the answers with the finished video', async () => {
    setLearner(aminata);
    await toQuestion();
    fireEvent.click(screen.getByRole('radio', { name: /It is never the child’s fault/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue video' }));
    at(14.1);
    fireEvent.click(screen.getByRole('radio', { name: /Keep it a secret/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Tell a grown-up you trust/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue video' }));
    at(20, 'ended', { ended: true });
    expect(await screen.findByText('Saved for Aminata')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Take the quiz' })).toHaveAttribute('href', '/lesson/cp-child-staying-safe-quiz');
  });
});

describe('Listen', () => {
  it('shows the player and the words; nothing loads before Play', async () => {
    open('/lesson/cp-child-staying-safe-2');
    await screen.findByRole('region', { name: 'Audio player' });
    const audio = media();
    expect(audio.getAttribute('preload')).toBe('none');
    expect(audio.hasAttribute('src')).toBe(false);
    expect(screen.getByText('The story never starts by itself. Tap Play to start.')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Story time' })).toBeDisabled();
    expect(screen.getByRole('region', { name: /Read along/ })).toHaveTextContent('Mariama’s aunty gives her a big hug.');
  });

  it('Read along marks the line being spoken, and can be turned off', async () => {
    open('/lesson/cp-child-staying-safe-2');
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    expect(media().getAttribute('src')).toBe('/media/sample-audio.m4a');
    at(5, 'playing');
    at(5);
    const now = document.querySelector('[aria-current="true"]');
    expect(now).toHaveTextContent('Now: One day, someone touches her in a way that feels wrong.');
    fireEvent.click(screen.getByRole('button', { name: 'Read along: on' }));
    expect(screen.getByRole('button', { name: 'Read along: off' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.getElementById('les-read-along')).not.toBeVisible();
  });

  it('finishes at the end and offers the next lesson', async () => {
    open('/lesson/cp-child-staying-safe-2');
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    at(12, 'ended', { ended: true });
    expect(screen.getByText('Well done! You listened to the end.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next lesson' })).toHaveAttribute('href', '/lesson/cp-child-staying-safe-3');
    expect(screen.getByRole('button', { name: 'Listen again' })).toBeInTheDocument();
  });

  it('fallback when the sound cannot be decoded', async () => {
    canPlay = '';
    open('/lesson/cp-child-staying-safe-2');
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This sound cannot play on this phone');
  });
});

describe('Read', () => {
  it('renders typed text with headings, a numbered list and the Read along tools', async () => {
    open('/lesson/cp-parent-keeping-children-safe-5');
    expect(await screen.findByRole('heading', { level: 2, name: 'Talking about safety at home' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Three things you can do this week' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').filter((item) => item.className.indexOf('les-read__item') !== -1)).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Play the reading/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Highlight: on' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('Page 1 of 1').length).toBeGreaterThan(0);
    expect(media().hasAttribute('src')).toBe(false);
  });

  it('marks the paragraph being read while the voice plays', async () => {
    open('/lesson/cp-parent-keeping-children-safe-5');
    fireEvent.click(await screen.findByRole('button', { name: /Play the reading/ }));
    at(1, 'playing');
    at(1);
    expect(document.querySelector('.is-reading')).toHaveTextContent('Being read now:');
    fireEvent.click(screen.getByRole('button', { name: 'Highlight: on' }));
    expect(document.querySelector('.is-reading')).toBeNull();
    expect(screen.getByRole('button', { name: /Pause the reading/ })).toBeInTheDocument();
  });

  it('changes the text size and remembers it', async () => {
    open('/lesson/cp-parent-keeping-children-safe-5');
    const bigger = await screen.findByRole('button', { name: 'Bigger text' });
    expect(document.querySelector('.les-read--size-1')).not.toBeNull();
    fireEvent.click(bigger);
    fireEvent.click(bigger);
    expect(document.querySelector('.les-read--size-3')).not.toBeNull();
    expect(bigger).toBeDisabled();
    expect(window.localStorage.getItem('sensebod.read.textSize')).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: 'Smaller text' }));
    expect(document.querySelector('.les-read--size-2')).not.toBeNull();
    window.localStorage.removeItem('sensebod.read.textSize');
  });

  it('finishing goes to the finished screen', async () => {
    open('/lesson/cp-parent-keeping-children-safe-5');
    fireEvent.click(await screen.findByRole('button', { name: 'I have finished reading' }));
    expect(await screen.findByRole('heading', { level: 1, name: /You finished A note for parents/ })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/lesson/cp-parent-keeping-children-safe-5/done');
    expect(screen.getByRole('link', { name: 'Read again' })).toHaveAttribute('href', '/lesson/cp-parent-keeping-children-safe-5');
  });
});

describe('Try it: tap the picture', () => {
  it('each person answers when tapped, and the count goes up', async () => {
    open('/lesson/cp-child-staying-safe-3');
    expect(await screen.findByText('Tap each person you can tell.')).toBeInTheDocument();
    expect(screen.getByText('0 of 4 found')).toBeInTheDocument();
    expect(screen.getByText('When you find all 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^1\. Mr Koroma, Teacher, at the school\. Tap to hear/ }));
    expect(screen.getByText('“You can tell me. I will listen and help.”')).toBeInTheDocument();
    expect(screen.getByText('1 of 4 found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^1\. Mr Koroma.*Showing now/ })).toHaveAttribute('aria-pressed', 'true');
    // the recorded voice plays through the shared narration player, on the tap
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('Next person, Replay, and the finish when all are found', async () => {
    setLearner(aminata);
    open('/lesson/cp-child-staying-safe-3');
    const next = await screen.findByRole('button', { name: 'Next person' });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(screen.getByText('2 of 4 found')).toBeInTheDocument();
    expect(screen.getByText('Health worker, at the clinic')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(screen.getByText('0 of 4 found')).toBeInTheDocument();
    for (let count = 0; count < 4; count += 1) fireEvent.click(next);
    expect(screen.getByText('4 of 4 found')).toBeInTheDocument();
    expect(screen.getAllByText('Well done! You found 4 people you can tell.').length).toBe(1);
    expect(screen.getByRole('link', { name: 'Next: Lesson 4 · Watch and answer' })).toHaveAttribute('href', '/lesson/cp-child-staying-safe-4');
    expect(await screen.findByText('Saved for Aminata')).toBeInTheDocument();
  });
});

describe('Try it: animation package', () => {
  it('loads nothing until Start, then shows the package in a sandboxed frame', async () => {
    open('/lesson/cp-parent-keeping-children-safe-4');
    const start = await screen.findByRole('button', { name: 'Start' });
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(start);
    const frame = await screen.findByTitle('Where to report [confirm local services]');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('src', '/media/tryit/sample/index.html');
    expect(requests).toContain('HEAD /media/tryit/sample/index.html');
    expect(screen.getByText('Opening the activity…')).toBeInTheDocument();
    fireEvent.load(frame);
    expect(screen.queryByText('Opening the activity…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I have finished' }));
    expect(await screen.findByRole('heading', { level: 1, name: /You finished/ })).toBeInTheDocument();
  });
});

describe('Check quiz and the finished screen', () => {
  it('one question at a time, with no timer', async () => {
    open('/lesson/agriculture-chickens-and-quail-videos-quiz');
    expect(await screen.findByText('Why do we build the quail house off the ground?')).toBeInTheDocument();
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Now on question 1. Question 2 to go. Question 3 to go.' })).toBeInTheDocument();
    expect(screen.getByText('No timer. Take your time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listen to the question' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Next question' })).toBeDisabled();
  });

  it('wrong is "let’s think again" with the reason and Try again; right says why', async () => {
    open('/lesson/agriculture-chickens-and-quail-videos-quiz');
    fireEvent.click(await screen.findByRole('radio', { name: /So the quail can fly out/ }));
    const wrong = screen.getByRole('radio', { name: /So the quail can fly out/ });
    expect(wrong).toHaveAttribute('aria-checked', 'true');
    expect(within(wrong).getByText('Your answer')).toBeInTheDocument();
    expect(within(wrong).getByText('Let’s think again')).toBeInTheDocument();
    expect(within(wrong).getByText('The house is raised to keep the birds dry and safe, not to let them out.')).toBeInTheDocument();
    expect(screen.getByText('It is OK to try again. Choose another answer.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Tap the answer you think is right.')).toBeInTheDocument();
    expect(screen.queryByText('Let’s think again')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /To keep the birds dry and safe/ }));
    expect(screen.getByText('Yes, that is right')).toBeInTheDocument();
    expect(screen.getByText(/A raised house stays dry when it rains/)).toBeInTheDocument();
    expect(screen.getByText('Well done. Go to the next question.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('What helps quail stay healthy in their house?')).toBeInTheDocument();
  });

  async function finishQuiz(answers: RegExp[]) {
    open('/lesson/agriculture-chickens-and-quail-videos-quiz');
    await screen.findByText('Question 1 of 3');
    answers.forEach((answer, index) => {
      fireEvent.click(screen.getByRole('radio', { name: answer }));
      fireEvent.click(screen.getByRole('button', { name: index === answers.length - 1 ? 'See your result' : 'Next question' }));
    });
    await screen.findByRole('heading', { level: 1, name: 'You finished Quick quiz: keeping quail!' });
  }

  it('shows the result, saves it for the learner and offers what is next', async () => {
    setLearner(aminata);
    await finishQuiz([/To keep the birds dry and safe/, /Full sun all day/, /Clean water and feed/]);
    expect(screen.getByText('Quiz: 2 of 3 correct')).toBeInTheDocument();
    const marks = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(marks.map((item) => item.textContent)).toEqual(['Question 1: correct', 'Question 2: not yetNot yet', 'Question 3: correct']);
    expect(await screen.findByText('Saved for Aminata')).toBeInTheDocument();
    expect(screen.getByText('Your progress stays in this bag.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Do the quiz again' })).toHaveAttribute('href', '/lesson/agriculture-chickens-and-quail-videos-quiz');
    expect(screen.getByRole('link', { name: 'Back to topics' })).toHaveAttribute('href', '/portal/agriculture');
    const put = requests.filter((request) => request.indexOf('PUT') === 0);
    expect(put[put.length - 1]).toBe('PUT /api/v1/learners/learner-aminata/progress/agriculture-chickens-and-quail-videos-quiz');
  });

  it('a guest gets the result and is told plainly it is not saved', async () => {
    await finishQuiz([/To keep the birds dry and safe/, /Fresh air, shade/, /Clean water and feed/]);
    expect(screen.getByText('Quiz: 3 of 3 correct')).toBeInTheDocument();
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Save my progress' })).toHaveAttribute('href', '/save-progress');
    expect(requests.filter((request) => request.indexOf('/learners/') !== -1)).toEqual([]);
  });

  it('after a refresh a learner still sees what the bag saved', async () => {
    setLearner(aminata);
    await finishQuiz([/To keep the birds dry and safe/, /Fresh air, shade/, /Clean water and feed/]);
    await screen.findByText('Saved for Aminata');
    resetFinishRecordForTests(); // what a page refresh does
    open('/lesson/agriculture-chickens-and-quail-videos-quiz/done');
    expect((await screen.findAllByText('Quiz: 3 of 3 correct')).length).toBeGreaterThan(0);
  });

  it('opened directly by someone who has not finished, it sends them to the lesson', async () => {
    open('/lesson/cp-child-staying-safe-1/done');
    expect(await screen.findByText('This lesson is not finished yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the lesson' })).toHaveAttribute('href', '/lesson/cp-child-staying-safe-1');
    expect(screen.queryByText(/You finished/)).not.toBeInTheDocument();
  });

  it('the finished screen names the next lesson', async () => {
    open('/lesson/cp-parent-keeping-children-safe-5');
    fireEvent.click(await screen.findByRole('button', { name: 'I have finished reading' }));
    const next = await screen.findByRole('link', { name: /Next: the quiz/ });
    expect(next).toHaveAttribute('href', '/lesson/cp-parent-keeping-children-safe-quiz');
    expect(screen.getByRole('link', { name: 'Leave this page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get help now' })).toBeInTheDocument();
  });
});

describe('Picture lesson (Climate)', () => {
  it('shows the pictures in order with their captions', async () => {
    open('/lesson/climate-floods-stay-safe-lessons-1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Move to high ground before the water rises' })).toBeInTheDocument();
    expect(screen.getByText('3 pictures show what to do.')).toBeInTheDocument();
    expect(screen.getByText('Rain falls')).toBeInTheDocument();
    expect(screen.getByText('Walk uphill')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Leave this page' })).not.toBeInTheDocument();
  });

  it('"Play animation" shows one picture at a time, slowly, and stops by itself', async () => {
    open('/lesson/climate-floods-stay-safe-lessons-1');
    const playButton = await screen.findByRole('button', { name: 'Play animation' });
    vi.useFakeTimers();
    fireEvent.click(playButton);
    expect(screen.getByRole('status')).toHaveTextContent('Picture 1 of 3: Rain falls');
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Picture 2 of 3: River rises');
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(screen.getByRole('button', { name: 'Play animation' })).toBeInTheDocument();
    expect(screen.getByText('Rain falls')).toBeInTheDocument();
  });
});
