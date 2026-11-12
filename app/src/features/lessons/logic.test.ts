/* Pure rules of the players: no rendering, no network. */
import type { QuizQuestion, ReadBlock } from '@shared/api';
import { describe, expect, it } from 'vitest';
import { isLocalUrl } from './media/localUrl';
import { clampTime, percentPlayed, spokenTime } from './media/time';
import { pickSource } from './media/useMedia';
import { describeSteps, seriesSteps, summariseSeries } from './parts/steps';
import { describeQuestions } from './players/CheckQuiz';
import { currentLine } from './players/ListenPlayer';
import { pictureFrames } from './players/PictureLesson';
import { blockBeingRead, readPages } from './players/ReadPlayer';
import { foundCount, freshHotspots, isComplete, nextSpot, tapSpot } from './players/TryItHotspots';
import { clearPick, FRESH, hasAnswered, isSettled, outcome, pickAnswer, questionDue, scoreQuiz } from './quiz/quizLogic';

const question = (allowRetry = true): QuizQuestion => ({
  id: 'q',
  prompt: 'Why?',
  listenUrl: null,
  allowRetry,
  answers: [
    { id: 'right', text: 'Because', correct: true, feedback: 'Yes, because.' },
    { id: 'wrong', text: 'No reason', correct: false, feedback: 'There is a reason.' },
  ],
});

describe('time words', () => {
  it('speaks times for screen readers', () => {
    expect(spokenTime(0)).toBe('0 seconds');
    expect(spokenTime(1)).toBe('1 second');
    expect(spokenTime(60)).toBe('1 minute');
    expect(spokenTime(84)).toBe('1 minute 24 seconds');
    expect(spokenTime(210)).toBe('3 minutes 30 seconds');
  });
  it('keeps a seek inside the media', () => {
    expect(clampTime(-4, 20)).toBe(0);
    expect(clampTime(25, 20)).toBe(20);
    expect(clampTime(25, null)).toBe(25);
    expect(percentPlayed(5, 20)).toBe(25);
    expect(percentPlayed(5, null)).toBe(0);
    expect(percentPlayed(50, 20)).toBe(100);
  });
});

describe('choosing a media file', () => {
  const can = (types: string[]) => ({ canPlayType: (type: string) => (types.indexOf(type) === -1 ? '' : 'maybe') }) as Pick<HTMLMediaElement, 'canPlayType'>;
  const sources = [
    { url: '/media/a.webm', mimeType: 'video/webm' },
    { url: '/media/a.mp4', mimeType: 'video/mp4' },
  ];
  it('takes the first file the browser can play', () => {
    expect(pickSource(can(['video/webm', 'video/mp4']), sources)).toBe(0);
    expect(pickSource(can(['video/mp4']), sources)).toBe(1);
    expect(pickSource(can([]), sources)).toBe(-1);
  });
  it('can move on to the next copy after a failed one', () => {
    expect(pickSource(can(['video/webm', 'video/mp4']), sources, 1)).toBe(1);
    expect(pickSource(can(['video/webm', 'video/mp4']), sources, 2)).toBe(-1);
  });
  it('never picks a file that is not served by the bag', () => {
    expect(pickSource(can(['video/mp4']), [{ url: 'https://example.org/a.mp4', mimeType: 'video/mp4' }])).toBe(-1);
    expect(isLocalUrl('/media/a.mp4')).toBe(true);
    expect(isLocalUrl('//example.org/a.mp4')).toBe(false);
    expect(isLocalUrl('http://example.org/a.mp4')).toBe(false);
    expect(isLocalUrl('')).toBe(false);
  });
});

describe('series steps', () => {
  it('shows every lesson of a short series', () => {
    const window = seriesSteps(2, 4, ['finished', 'started', 'not-started', 'not-started']);
    expect(window).toEqual({ first: 1, steps: ['finished', 'now', 'todo', 'todo'] });
    expect(describeSteps(window, 'listen')).toBe('Lesson 1 finished. Listening to lesson 2 now. Lesson 3 not started. Lesson 4 not started.');
  });
  it('shows five around the open lesson of a long series', () => {
    expect(seriesSteps(2, 12, ['finished']).steps).toEqual(['finished', 'now', 'todo', 'todo', 'todo']);
    expect(seriesSteps(7, 12, [])).toEqual({ first: 6, steps: ['todo', 'now', 'todo', 'todo', 'todo'] });
    expect(seriesSteps(12, 12, [])).toEqual({ first: 8, steps: ['todo', 'todo', 'todo', 'todo', 'now'] });
  });
  it('marks a lesson started earlier differently from the open one', () => {
    expect(seriesSteps(1, 3, ['finished', 'started', 'not-started']).steps).toEqual(['now', 'begun', 'todo']);
  });
  it('sums up the series in words', () => {
    expect(summariseSeries(2, 4, ['finished', 'started'], 'listen')).toBe('1 finished · listening now · 2 to go');
    expect(summariseSeries(1, 1, [], 'watch')).toBe('0 finished · watching now · 0 to go');
  });
});

describe('question rules', () => {
  it('a right answer settles the question', () => {
    const state = pickAnswer(question(), FRESH, 'right');
    expect(state).toEqual({ picked: 'right', solved: true, locked: true, attempts: 1 });
    expect(outcome(state)).toBe('right');
    expect(pickAnswer(question(), state, 'wrong')).toBe(state);
  });
  it('a wrong answer may be tried again, without limit and without penalty', () => {
    let state = pickAnswer(question(), FRESH, 'wrong');
    expect(outcome(state)).toBe('again');
    expect(isSettled(state)).toBe(false);
    expect(hasAnswered(state)).toBe(true);
    state = clearPick(state);
    expect(outcome(state)).toBe('none');
    expect(hasAnswered(state)).toBe(false);
    state = pickAnswer(question(), state, 'right');
    expect(state.solved).toBe(true);
    expect(state.attempts).toBe(2);
  });
  it('without retry the right answer is shown and the learner moves on', () => {
    const state = pickAnswer(question(false), FRESH, 'wrong');
    expect(outcome(state)).toBe('shown');
    expect(isSettled(state)).toBe(true);
    expect(clearPick(state)).toBe(state);
  });
  it('ignores an unknown answer id', () => {
    expect(pickAnswer(question(), FRESH, 'nope')).toBe(FRESH);
  });
  it('counts a question as correct when the learner ended on the right answer', () => {
    const q = question();
    const result = scoreQuiz([q, q, q], [pickAnswer(q, FRESH, 'right'), pickAnswer(q, FRESH, 'wrong'), undefined]);
    expect(result).toEqual({ correct: 1, total: 3, answers: [true, false, false] });
  });
  it('describes quiz progress in words', () => {
    expect(describeQuestions(1, 3)).toBe('Question 1 done. Now on question 2. Question 3 to go.');
  });
});

describe('questions in a video', () => {
  const questions = [{ atSeconds: 6 }, { atSeconds: 14 }];
  it('asks a question when its time is reached', () => {
    expect(questionDue(questions, [false, false], 5.9)).toBe(-1);
    expect(questionDue(questions, [false, false], 6)).toBe(0);
    expect(questionDue(questions, [true, false], 7)).toBe(-1);
    expect(questionDue(questions, [true, false], 14.2)).toBe(1);
    expect(questionDue(questions, [true, true], 19)).toBe(-1);
  });
  it('cannot be skipped by seeking forward: the earliest open one is asked', () => {
    expect(questionDue(questions, [false, false], 18)).toBe(0);
  });
});

describe('read along words (Listen)', () => {
  const lines = [
    { start: 0, text: 'a' },
    { start: 4, text: 'b' },
    { start: 8, text: 'c' },
  ];
  it('finds the line being spoken', () => {
    expect(currentLine(lines, 0)).toBe(0);
    expect(currentLine(lines, 5)).toBe(1);
    expect(currentLine(lines, 99)).toBe(2);
  });
  it('marks nothing when the words are not timed', () => {
    expect(currentLine([{ start: null, text: 'a' }], 5)).toBe(-1);
  });
});

describe('Read', () => {
  const blocks: ReadBlock[] = [
    { kind: 'heading', text: 'One two' },
    { kind: 'paragraph', text: 'three four five six seven eight' },
    { kind: 'picture', picture: { url: '/p.svg', alt: '' }, caption: null },
    { kind: 'list', ordered: true, items: ['nine ten', 'eleven twelve'] },
  ];
  it('typed text is one page; photos of notes are one page each', () => {
    expect(readPages({ blocks, pageImages: [] })).toHaveLength(1);
    const photos = [
      { url: '/1.jpg', alt: '' },
      { url: '/2.jpg', alt: '' },
    ];
    expect(readPages({ blocks: [], pageImages: photos }).map((page) => page.kind)).toEqual(['image', 'image']);
    expect(readPages({ blocks: [], pageImages: [] })).toEqual([]);
  });
  it('estimates the block being read from its share of the words', () => {
    // 12 words over 12 seconds: heading 0–2 s, paragraph 2–8 s, list 8–12 s.
    expect(blockBeingRead(blocks, 1, 12)).toBe(0);
    expect(blockBeingRead(blocks, 5, 12)).toBe(1);
    expect(blockBeingRead(blocks, 9, 12)).toBe(3);
    expect(blockBeingRead(blocks, 12, 12)).toBe(3);
  });
  it('marks nothing before the reading starts or when the length is unknown', () => {
    expect(blockBeingRead(blocks, 0, 12)).toBe(-1);
    expect(blockBeingRead(blocks, 3, null)).toBe(-1);
    expect(blockBeingRead([], 3, 12)).toBe(-1);
  });
  it('recognises a picture lesson: picture blocks only', () => {
    const picture: ReadBlock = { kind: 'picture', picture: { url: '/p.svg', alt: 'Rain' }, caption: 'Rain falls' };
    expect(pictureFrames({ blocks: [picture, picture], pageImages: [] })).toHaveLength(2);
    expect(pictureFrames({ blocks, pageImages: [] })).toBeNull();
    expect(pictureFrames({ blocks: [], pageImages: [] })).toBeNull();
  });
});

describe('Try it: tap the picture', () => {
  it('finds spots and counts them', () => {
    let state = freshHotspots(4);
    expect(foundCount(state)).toBe(0);
    state = tapSpot(state, 2);
    expect(state).toEqual({ found: [false, false, true, false], current: 2 });
    expect(tapSpot(state, 9)).toBe(state);
  });
  it('"Next person" goes to the next one not found yet, going round', () => {
    expect(nextSpot(freshHotspots(4))).toBe(0);
    expect(nextSpot({ found: [true, false, true, false], current: 2 })).toBe(3);
    expect(nextSpot({ found: [false, true, true, true], current: 3 })).toBe(0);
    expect(nextSpot({ found: [true, true, true, true], current: 3 })).toBe(0);
    expect(nextSpot(freshHotspots(0))).toBe(-1);
  });
  it('is complete by goal', () => {
    const one = tapSpot(freshHotspots(3), 0);
    expect(isComplete(one, 'any')).toBe(true);
    expect(isComplete(one, 'all')).toBe(false);
    expect(isComplete({ found: [true, true, true], current: 2 }, 'all')).toBe(true);
    expect(isComplete(freshHotspots(0), 'all')).toBe(false);
  });
});
