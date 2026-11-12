import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import * as adminApi from '../src/shared/api/admin';
import type { ApiError } from '../src/shared/api/client';
import * as learnerApi from '../src/shared/api/learner';
import { classifyFile, getMockDb } from './handler';
import { installMockApi, type MockApiHandle } from './installMockFetch';

let mock: MockApiHandle;
beforeEach(() => {
  mock = installMockApi();
});

describe('seed data', () => {
  it('has the five portals and the board counts', async () => {
    const agriculture = await learnerApi.getPortal('agriculture');
    expect(agriculture.theme).toBe('agriculture');
    const counts = agriculture.groups.map((g) => [g.title, g.lessonCount, g.availability]);
    expect(counts).toEqual([
      ['Chickens and quail', 12, 'available'],
      ['Rabbits', 7, 'available'],
      ['Milk and dairy cows', 10, 'available'],
      ['Goats, snails and grasscutters', 8, 'available'],
      ['Feed and animal health', 27, 'available'],
      ['Crops', 0, 'not-in-bag'],
    ]);
    expect(counts.reduce((sum, c) => sum + (c[1] as number), 0)).toBe(64);
  });

  it('serves the Child protection series in learner order with the quiz last', async () => {
    const series = await learnerApi.getSeries('cp-child-staying-safe');
    expect(series.lessons.map((l) => `${l.type}${l.interactive ? '+' : ''}`)).toEqual(['watch', 'listen', 'try+', 'watch+', 'check']);
    expect(series.lessons.map((l) => l.position)).toEqual([1, 2, 3, 4, null]);
    expect(series.lessonCount).toBe(4);
    expect(series.hasQuiz).toBe(true);
  });

  it('gives each lesson its content and the next lesson', async () => {
    const lesson = await learnerApi.getLesson('cp-child-staying-safe-3');
    expect(lesson.content.type).toBe('try');
    expect(lesson.next?.title).toBe('It is not my fault');
    expect(lesson.portal.id).toBe('child-protection');
    const quail = await learnerApi.getLesson('agriculture-chickens-and-quail-videos-2');
    expect(quail.title).toBe('Quail housing');
    expect(quail.next?.title).toBe('Taking care of local chickens');
    expect(quail.series.lessonCount).toBe(12);
  });

  it('only points at pictures and media that exist in the repository', () => {
    const appDir = path.resolve(import.meta.dirname, '..');
    const missing = new Set<string>();
    const check = (url: string | undefined | null) => {
      if (!url) return;
      const clean = url.split('?')[0] as string;
      let file: string | null = null;
      if (clean.startsWith('/illustrations/')) file = path.join(appDir, '..', clean);
      else if (clean.startsWith('/media/')) file = path.join(appDir, 'mock', clean);
      else if (clean.startsWith('/pictures/')) file = path.join(appDir, 'public', clean);
      if (file && !existsSync(file)) missing.add(url);
    };
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        if (value.charAt(0) === '/') check(value);
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    const db = getMockDb();
    walk([db.portals, db.groups, db.series, db.lessons, db.pictures]);
    expect([...missing]).toEqual([]);
  });

  it('offers the lesson to continue with', async () => {
    const next = await learnerApi.getContinueLesson('learner-aminata', 'agriculture');
    expect(next?.lesson.title).toBe('Quail housing');
    expect(next?.lessonCount).toBe(12);
    expect(await learnerApi.getContinueLesson('learner-aminata', 'climate')).toBeNull();
  });
});

describe('fields added for the learner screens (fix round 1)', () => {
  it('names the quiz of a series, and of a group that holds one series', async () => {
    const group = await learnerApi.getGroup('cp-child');
    const series = group.series[0];
    expect(series?.hasQuiz).toBe(true);
    expect(series?.quiz).toMatchObject({ id: 'cp-child-staying-safe-quiz', type: 'check', position: null });
    expect(group.quiz?.id).toBe('cp-child-staying-safe-quiz');

    const agriculture = await learnerApi.getPortal('agriculture');
    const quizzes = agriculture.groups.map((g) => g.quiz?.title ?? null);
    expect(quizzes).toEqual(['Quick quiz: keeping quail', null, null, null, null, null]);

    // A class holds several series: the quiz is on the series, not on the group.
    const jss2 = await learnerApi.getGroup('jss-2');
    expect(jss2.quiz).toBeNull();
    expect(jss2.series.filter((s) => s.quiz).map((s) => [s.title, s.quiz?.title])).toEqual([['Integrated Science', 'Practice quiz']]);
    expect(jss2.series.every((s) => (s.quiz !== null) === s.hasQuiz)).toBe(true);
  });

  it('says how many series the group of a series holds', async () => {
    expect((await learnerApi.getSeries('cp-child-staying-safe')).group.seriesCount).toBe(1);
    expect((await learnerApi.getSeries('primary-class-4-mathematics')).group.seriesCount).toBe(4);
  });

  it('gives subjects and Climate topics an icon key, and null where the portal icon is used', async () => {
    const class4 = await learnerApi.getGroup('primary-class-4');
    expect(class4.series.map((s) => [s.title, s.icon])).toEqual([
      ['English Language', 'language'],
      ['Mathematics', 'maths'],
      ['Science', 'science'],
      ['Social Studies', 'social-studies'],
    ]);
    expect(class4.icon).toBeNull();
    const climate = await learnerApi.getPortal('climate');
    expect(climate.groups.map((g) => g.icon)).toEqual(['seasons', 'floods', 'clean-water', 'heat', 'crops']);
    const agriculture = await learnerApi.getPortal('agriculture');
    expect(agriculture.groups.map((g) => g.icon)).toEqual([null, null, null, null, null, 'crops']);
  });

  it('says who each Child protection audience is for, and null elsewhere', async () => {
    const cp = await learnerApi.getPortal('child-protection');
    expect(cp.groups.map((g) => [g.id, g.audience])).toEqual([
      ['cp-child', 'child'],
      ['cp-parent', 'parent'],
      ['cp-elder', 'elder'],
    ]);
    const primary = await learnerApi.getPortal('primary');
    expect(primary.groups.every((g) => g.audience === null)).toBe(true);
  });

  it('marks quiz entries in progress, so a finished quiz is not counted as a lesson', async () => {
    const learner = await learnerApi.createLearner({ name: 'Hawa', role: 'learner' });
    await learnerApi.saveLessonProgress(learner.id, 'cp-child-staying-safe-1', { state: 'finished' });
    const saved = await learnerApi.saveLessonProgress(learner.id, 'cp-child-staying-safe-quiz', { state: 'finished', correct: 2, total: 2 });
    expect(saved.lessonType).toBe('check');
    const progress = await learnerApi.getProgress(learner.id, { seriesId: 'cp-child-staying-safe' });
    expect(progress.lessons.map((p) => p.lessonType)).toEqual(['watch', 'check']);
    expect(progress.lessons.filter((p) => p.state === 'finished' && p.lessonType !== 'check')).toHaveLength(1);
    const seeded = await learnerApi.getProgress('learner-aminata');
    expect(seeded.lessons.every((p) => typeof p.lessonType === 'string')).toBe(true);
  });
});

describe('automatic type rule', () => {
  it('sets the lesson type from the file', () => {
    expect(classifyFile('Quail housing.mp4').becomes).toBe('watch');
    expect(classifyFile('PTT-20261112.opus')).toEqual({ kind: 'voice-note', becomes: 'listen' });
    expect(classifyFile('guide.PDF').becomes).toBe('read');
    expect(classifyFile('notes.jpg').becomes).toBe('read');
    expect(classifyFile('village.zip').becomes).toBe('try');
    expect(classifyFile('thing.exe').becomes).toBeNull();
  });
});

describe('admin', () => {
  it('refuses admin calls without a session', async () => {
    const error = (await adminApi.getLibrary().catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(401);
  });

  it('signs in and out', async () => {
    const bad = (await adminApi.signIn({ username: 'admin', password: 'wrong' }).catch((e: unknown) => e)) as ApiError;
    expect(bad.status).toBe(401);
    const session = await adminApi.signIn({ username: 'admin', password: 'sensebod' });
    expect(session.username).toBe('admin');
    expect((await adminApi.getSession()).username).toBe('admin');
    await adminApi.signOut();
    expect(((await adminApi.getSession().catch((e: unknown) => e)) as ApiError).status).toBe(401);
  });

  it('lists drafts waiting to be placed and filters the library', async () => {
    mock.signInAdmin();
    const waiting = await adminApi.getLibrary({ unplaced: true });
    expect(waiting.items.map((l) => l.title)).toEqual(['Safe and unsafe touch — story', 'Fatmata’s science notes']);
    const child = await adminApi.getLibrary({ seriesId: 'cp-child-staying-safe' });
    expect(child.total).toBe(5);
    const search = await adminApi.getLibrary({ search: 'quail' });
    expect(search.items.some((l) => l.title === 'Quail housing')).toBe(true);
  });

  it('runs the whole add-content journey: upload, place, picture, publish', async () => {
    mock.signInAdmin();
    const file = new File(['voice'], 'Safe and unsafe touch — story.opus', { type: 'audio/ogg' });
    const sent: number[] = [];
    const upload = await adminApi.uploadContent(file, undefined, (loaded) => sent.push(loaded)).promise;
    expect(upload.becomes).toBe('listen');
    expect(upload.processing.state).toBe('working');
    expect(sent.length).toBeGreaterThan(0);
    expect((await adminApi.getUpload(upload.id)).processing.state).toBe('ready');

    const draft = await adminApi.createLesson({ source: 'upload', title: 'A new story', uploadIds: [upload.id] });
    expect(draft).toMatchObject({ status: 'draft', type: 'listen', placement: null });
    const notYet = (await adminApi.publishLesson(draft.id).catch((e: unknown) => e)) as ApiError;
    expect(notYet.status).toBe(409);

    const pictures = await adminApi.getPictures({ suggestForLessonId: draft.id, group: 'child-protection' });
    expect(pictures.suggested).toHaveLength(3);
    const placed = await adminApi.updateLesson(draft.id, {
      placement: { portalId: 'child-protection', groupId: 'cp-child', seriesId: 'cp-child-staying-safe', position: 2 },
      pictureId: pictures.items[0]?.id,
    });
    expect(placed.position).toBe(2);
    expect(placed.placementLabel).toBe('Child protection → I am a child → Staying safe');

    // Learners do not see a draft.
    expect((await learnerApi.getSeries('cp-child-staying-safe')).lessons).toHaveLength(5);
    await adminApi.publishLesson(draft.id);
    const series = await learnerApi.getSeries('cp-child-staying-safe');
    expect(series.lessons.map((l) => l.title).slice(0, 3)).toEqual(['My body belongs to me', 'A new story', 'Safe and unsafe touch']);
    expect(series.lessons.map((l) => l.position)).toEqual([1, 2, 3, 4, 5, null]);
  });

  it('rejects files it cannot use', async () => {
    mock.signInAdmin();
    const error = (await adminApi.uploadContent(new File(['x'], 'virus.exe')).promise.catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(415);
  });

  it('saves a new series order and detects a stale one', async () => {
    mock.signInAdmin();
    const before = await adminApi.getAdminSeries('cp-child-staying-safe');
    const ids = before.lessons.filter((l) => l.type !== 'check').map((l) => l.id);
    const after = await adminApi.saveSeriesOrder('cp-child-staying-safe', { lessonIds: [ids[1], ids[0], ids[2], ids[3]] as string[] });
    expect(after.lessons[0]?.title).toBe('Safe and unsafe touch');
    expect(after.lessons[after.lessons.length - 1]?.type).toBe('check');
    const stale = (await adminApi.saveSeriesOrder('cp-child-staying-safe', { lessonIds: ids.slice(1) }).catch((e: unknown) => e)) as ApiError;
    expect(stale.status).toBe(409);
  });

  it('edits video questions and Try it setup', async () => {
    mock.signInAdmin();
    const set = await adminApi.getQuestions('cp-child-staying-safe-4');
    expect(set.kind).toBe('video');
    expect(set.questions).toHaveLength(2);
    const saved = await adminApi.saveQuestions('cp-child-staying-safe-4', { ...set, questions: set.questions.slice(0, 1) });
    expect(saved.questions).toHaveLength(1);
    const invalid = (await adminApi
      .saveQuestions('cp-child-staying-safe-4', { ...set, questions: [{ ...set.questions[0]!, answers: [] }] })
      .catch((e: unknown) => e)) as ApiError;
    expect(invalid.status).toBe(422);

    const setup = await adminApi.getTryItSetup('cp-child-staying-safe-3');
    expect(setup.mode).toBe('hotspots');
    if (setup.mode === 'hotspots') {
      expect(setup.spots).toHaveLength(4);
      await adminApi.saveTryItSetup('cp-child-staying-safe-3', { ...setup, goal: 'any' });
      const lesson = await learnerApi.getLesson('cp-child-staying-safe-3');
      expect(lesson.content.type === 'try' && lesson.content.mode === 'hotspots' && lesson.content.goal).toBe('any');
    }
  });
});
