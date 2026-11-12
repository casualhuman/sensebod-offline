import { describe, expect, it } from 'vitest';
import type { LessonProgress, ProgressState } from '@shared/api';
import { describeLessonTypes, firstName, returnToFromQuery, safeReturnTo, saveProgressPath, splitClassTitle } from './lib';
import { indexProgress, lessonState, listProgress } from './progress';

describe('where Save my progress returns to', () => {
  it('accepts paths inside the app only', () => {
    expect(safeReturnTo('/portal/agriculture')).toBe('/portal/agriculture');
    expect(safeReturnTo('//example.org')).toBe('/');
    expect(safeReturnTo('https://example.org')).toBe('/');
    expect(safeReturnTo('/\\example.org')).toBe('/');
    expect(safeReturnTo('javascript:alert(1)')).toBe('/');
    expect(safeReturnTo('/save-progress?from=%2F')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
  });

  it('round-trips through the link', () => {
    const link = saveProgressPath('/portal/jss/jss-2');
    expect(link).toBe('/save-progress?from=%2Fportal%2Fjss%2Fjss-2');
    expect(returnToFromQuery(new URLSearchParams(link.split('?')[1]))).toBe('/portal/jss/jss-2');
    expect(saveProgressPath('/')).toBe('/save-progress');
  });
});

describe('words built from data', () => {
  it('describes the lesson types of a list as on the boards', () => {
    expect(describeLessonTypes(['watch', 'listen', 'try'])).toBe('Watch a video, listen or try it yourself.');
    expect(describeLessonTypes(['watch', 'listen', 'read', 'try'])).toBe('Watch a video, listen, read or try it yourself.');
    expect(describeLessonTypes(['read'])).toBe('Read.');
    expect(describeLessonTypes([])).toBe('');
  });

  it('splits a class title into its word and number', () => {
    expect(splitClassTitle('Class 4')).toEqual({ word: 'Class', number: '4' });
    expect(splitClassTitle('JSS 2')).toEqual({ word: 'JSS', number: '2' });
    expect(splitClassTitle('Adult learners')).toEqual({ word: '', number: 'Adult learners' });
  });

  it('uses the first name in the chip', () => {
    expect(firstName('Aminata Kamara')).toBe('Aminata');
    expect(firstName('  Pa   Foday ')).toBe('Pa');
  });
});

describe('progress', () => {
  const entry = (lessonId: string, seriesId: string, state: ProgressState): LessonProgress => ({ lessonId, seriesId, state, positionSeconds: null, correct: null, total: null, updatedAt: '' });
  const index = indexProgress([entry('a-1', 'a', 'finished'), entry('a-2', 'a', 'started'), entry('b-1', 'b', 'finished'), entry('b-2', 'b', 'finished'), entry('b-quiz', 'b', 'finished')]);

  it('reads one lesson', () => {
    expect(lessonState(index, 'a-1')).toBe('finished');
    expect(lessonState(index, 'a-9')).toBe('not-started');
    expect(lessonState(null, 'a-1')).toBe('not-started');
  });

  it('gives a card its state, never counting more than the lessons there are', () => {
    expect(listProgress(index, 'a', 5, true)).toEqual({ state: 'started', done: 1, total: 5 });
    expect(listProgress(index, 'b', 2, true)).toEqual({ state: 'finished', done: 2, total: 2 });
    expect(listProgress(index, 'c', 3, true)).toEqual({ state: 'not-started', done: 0, total: 3 });
    expect(listProgress(index, 'a', 5, false).state).toBe('not-in-bag');
    expect(listProgress(null, 'a', 5, true).state).toBe('not-started');
  });
});
