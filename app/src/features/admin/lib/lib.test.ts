import type { AdminLesson, LessonType } from '@shared/api';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminPaths, safeNextPath } from '../adminPaths';
import { sortChosenFiles } from './chosenFiles';
import { ACCEPT, classifyFileName, fileIdentity, formatBytes, formatProgress, percent, titleFromFileName, titleProblem } from './files';
import { flowSteps, forgetPublished, recentPublishedIds, rememberPublished } from './flow';
import {
  chooseGroup,
  choosePortal,
  chooseSeries,
  clampPosition,
  defaultPosition,
  EMPTY_CHOICE,
  groupQuestion,
  moveItem,
  placementProblem,
  positionCount,
  positionHint,
  previewSeries,
  sameOrder,
  seriesCountLabel,
  toPlacement,
} from './placement';
import { addAnswer, firstInvalid, formatTime, fromQuestionSet, newQuestion, parseTime, questionProblems, removeAnswer, sortByTime, toQuestionSet } from './questions';
import { nextRotation, rotatedName, rotatedSize } from './rotateImage';
import { clearTypedDraft, countWords, emptyDraft, loadTypedDraft, saveTypedDraft, toReadBlocks, typedProblem } from './typedLesson';

function lesson(id: string, type: LessonType, position: number | null): AdminLesson {
  return {
    id,
    seriesId: 's',
    position,
    title: `Title ${id}`,
    summary: '',
    picture: null,
    language: 'en',
    type,
    interactive: false,
    captions: false,
    readAlong: false,
    needsSound: false,
    length: null,
    pages: null,
    status: 'published',
    placement: null,
    placementLabel: null,
    source: 'upload',
    fileNames: [],
    questionCount: null,
    pictureId: null,
    updatedAt: '2026-11-12T09:00:00.000Z',
    notes: [],
  };
}

const series = [lesson('a', 'watch', 1), lesson('b', 'listen', 2), lesson('c', 'try', 3), lesson('quiz', 'check', null)];

describe('placement', () => {
  it('clears everything below when a higher choice changes', () => {
    const full = { portalId: 'agriculture' as const, groupId: 'g', seriesId: 's', position: 2 };
    expect(choosePortal(full, 'climate')).toEqual({ portalId: 'climate', groupId: null, seriesId: null, position: null });
    expect(chooseGroup(full, 'g2')).toEqual({ portalId: 'agriculture', groupId: 'g2', seriesId: null, position: null });
    expect(chooseSeries(full, 's2')).toEqual({ portalId: 'agriculture', groupId: 'g', seriesId: 's2', position: null });
    // Choosing the same thing again keeps the choices under it.
    expect(choosePortal(full, 'agriculture')).toBe(full);
    expect(chooseGroup(full, 'g')).toBe(full);
    expect(chooseSeries(full, 's')).toBe(full);
  });

  it('asks the second question in the words of the portal', () => {
    expect(groupQuestion('class').title).toBe('Which class?');
    expect(groupQuestion('topic').title).toBe('Which topic?');
    expect(groupQuestion('audience').title).toBe('Who is it for?');
  });

  it('offers one more position than the lessons there, the quiz not counted', () => {
    expect(positionCount(series, 'new')).toBe(4);
    expect(defaultPosition(series, 'new')).toBe(4);
    // A lesson that is already in the series only moves among the existing places.
    expect(positionCount(series, 'b')).toBe(3);
    expect(defaultPosition(series, 'b')).toBe(2);
    expect(positionCount([], 'new')).toBe(1);
  });

  it('keeps a position inside the series', () => {
    expect(clampPosition(0, 4)).toBe(1);
    expect(clampPosition(9, 4)).toBe(4);
    expect(clampPosition(2.7, 4)).toBe(2);
    expect(clampPosition(NaN, 4)).toBe(4);
  });

  it('previews the series with the new lesson in place and the quiz last', () => {
    const rows = previewSeries(series, { id: 'new', type: 'listen', title: 'Story' }, 2);
    expect(rows.map((row) => `${row.number ?? 'quiz'}:${row.id}`)).toEqual(['1:a', '2:new', '3:b', '4:c', 'quiz:quiz']);
    expect(rows.filter((row) => row.isNew).map((row) => row.id)).toEqual(['new']);
  });

  it('moves a lesson that is already in the series instead of adding it twice', () => {
    const rows = previewSeries(series, { id: 'c', type: 'try', title: 'Title c' }, 1);
    expect(rows.map((row) => row.id)).toEqual(['c', 'a', 'b', 'quiz']);
  });

  it('does not change the series it was given', () => {
    const before = series.map((entry) => entry.id);
    previewSeries(series, { id: 'new', type: 'read', title: 'x' }, 1);
    expect(series.map((entry) => entry.id)).toEqual(before);
  });

  it('says what is still missing, in order', () => {
    expect(placementProblem(EMPTY_CHOICE)).toBe('Choose a portal first');
    expect(placementProblem({ ...EMPTY_CHOICE, portalId: 'primary' })).toBe('Choose who it is for first');
    expect(placementProblem({ portalId: 'primary', groupId: 'g', seriesId: null, position: null })).toBe('Choose a series first');
    expect(placementProblem({ portalId: 'primary', groupId: 'g', seriesId: 's', position: 1 })).toBeNull();
    expect(toPlacement({ portalId: 'primary', groupId: 'g', seriesId: 's', position: null })).toBeNull();
    expect(toPlacement({ portalId: 'primary', groupId: 'g', seriesId: 's', position: 3 })).toEqual({ portalId: 'primary', groupId: 'g', seriesId: 's', position: 3 });
  });

  it('words positions and counts plainly', () => {
    expect(positionHint(1)).toBe('First in the series');
    expect(positionHint(2)).toBe('Place after Lesson 1');
    expect(seriesCountLabel(4, true)).toBe('4 lessons and a quiz');
    expect(seriesCountLabel(1, false)).toBe('1 lesson');
    expect(seriesCountLabel(0, false)).toBe('No lessons yet');
  });

  it('moves items one place and never past the ends', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveItem(ids, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(ids, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(ids, 0, -1)).toBe(ids);
    expect(moveItem(ids, 2, 1)).toBe(ids);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});

describe('files', () => {
  it('applies the automatic type rule', () => {
    expect(classifyFileName('Quail housing.MP4')).toMatchObject({ kind: 'video', becomes: 'watch' });
    expect(classifyFileName('PTT-2026.opus')).toMatchObject({ kind: 'voice-note', becomes: 'listen' });
    expect(classifyFileName('talk.mp3').becomes).toBe('listen');
    expect(classifyFileName('guide.pdf').becomes).toBe('read');
    expect(classifyFileName('notes.docx').becomes).toBe('read');
    expect(classifyFileName('page.jpeg').becomes).toBe('read');
    expect(classifyFileName('village.zip')).toMatchObject({ kind: 'animation', becomes: 'try' });
    expect(classifyFileName('virus.exe')).toMatchObject({ kind: 'unknown', becomes: null });
    expect(classifyFileName('no-extension').becomes).toBeNull();
  });

  it('formats sizes and progress', () => {
    expect(formatBytes(34 * 1024 * 1024)).toBe('34 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(null)).toBe('[size] MB');
    expect(formatProgress(21.4 * 1024 * 1024, 34 * 1024 * 1024)).toBe('21 of 34 MB sent');
    expect(percent(21, 34)).toBe(61);
    expect(percent(5, 0)).toBe(0);
    expect(percent(50, 34)).toBe(100);
  });

  it('makes a first title from a file name and checks titles', () => {
    expect(titleFromFileName('Quail_housing.mp4')).toBe('Quail housing');
    expect(titleFromFileName('.mp4')).toBe('Untitled lesson');
    expect(titleFromFileName('x'.repeat(300) + '.pdf').length).toBe(120);
    expect(titleProblem('   ')).toBe('Type a title first.');
    expect(titleProblem('x'.repeat(121))).toMatch(/shorter/);
    expect(titleProblem('Fine')).toBeNull();
  });

  it('refuses unusable, empty and repeated files before anything is sent', () => {
    const video = new File(['abc'], 'a.mp4');
    const empty = new File([], 'b.mp4');
    const zip = new File(['z'], 'c.zip');
    const exe = new File(['z'], 'd.exe');
    const sorted = sortChosenFiles([video, video, empty, zip, exe], {
      accept: ACCEPT.uploadFiles,
      already: [],
      room: 20,
      wrongKind: (kind) => (kind === 'animation' ? 'Use Upload an animation.' : null),
    });
    expect(sorted.accepted).toEqual([video]);
    expect(sorted.rejected.map((file) => file.reason)).toEqual(['Already on the list.', expect.stringMatching(/empty/), 'Use Upload an animation.', 'This kind of file cannot be added here.']);
    expect(sortChosenFiles([video], { accept: ACCEPT.uploadFiles, already: [fileIdentity(video)], room: 5 }).accepted).toEqual([]);
    expect(sortChosenFiles([video, new File(['q'], 'e.mp4')], { accept: ACCEPT.uploadFiles, already: [], room: 1 }).rejected).toHaveLength(1);
  });
});

describe('admin paths', () => {
  it('only returns to a page inside the admin after sign-in', () => {
    expect(safeNextPath('/admin/library?portalId=climate')).toBe('/admin/library?portalId=climate');
    expect(safeNextPath('/admin')).toBe('/admin');
    expect(safeNextPath('//evil.example/admin')).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('/administrator')).toBeNull();
    expect(safeNextPath('/portal/climate')).toBeNull();
    expect(safeNextPath('/admin\\..')).toBeNull();
    expect(safeNextPath('/admin/sign-in')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });

  it('encodes ids in paths', () => {
    expect(adminPaths.place('a/b')).toBe('/admin/lessons/a%2Fb/place');
    expect(adminPaths.picture('x', 'check')).toBe('/admin/lessons/x/picture?from=check');
    expect(adminPaths.library({ portalId: 'climate' })).toBe('/admin/library?portalId=climate');
  });

  it('counts three steps on a phone and four on a laptop', () => {
    expect(flowSteps('place', false)).toMatchObject({ current: 2 });
    expect(flowSteps('place', true)).toMatchObject({ current: 3 });
    expect(flowSteps('source', false)).toBeUndefined();
  });
});

describe('questions', () => {
  it('reads and writes times', () => {
    expect(parseTime('1:42')).toBe(102);
    expect(parseTime('45')).toBe(45);
    expect(parseTime('1:75')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('')).toBeNull();
    expect(formatTime(102)).toBe('1:42');
  });

  it('finds every problem the bag would refuse, before sending', () => {
    const question = newQuestion(8);
    expect(Object.keys(questionProblems(question, 'video')).sort()).toEqual(['answers', 'feedbackRight', 'feedbackWrong', 'prompt']);
    const filled = { ...question, prompt: 'Whose fault is it?', feedbackRight: 'Right.', feedbackWrong: 'Try again.', answers: question.answers.map((answer, index) => ({ ...answer, text: `Answer ${index}` })) };
    expect(questionProblems(filled, 'video')).toEqual({});
    expect(questionProblems({ ...filled, correctId: null }, 'check').correct).toBeDefined();
    expect(questionProblems({ ...filled, time: 'soon' }, 'video').time).toBeDefined();
    expect(questionProblems({ ...filled, time: '9:00' }, 'video', 60).time).toMatch(/only 1:00/);
    expect(questionProblems({ ...filled, time: '' }, 'check')).toEqual({});
    const same = { ...filled, answers: filled.answers.map((answer) => ({ ...answer, text: 'Same' })) };
    expect(questionProblems(same, 'check').answers).toMatch(/same/);
    expect(firstInvalid([filled, question], 'video')).toBe(1);
    expect(firstInvalid([filled], 'video')).toBe(-1);
  });

  it('keeps between two and four answers and never an orphan correct answer', () => {
    let question = newQuestion(null);
    expect(removeAnswer(question, question.answers[0]!.id)).toBe(question);
    question = addAnswer(addAnswer(question));
    expect(question.answers).toHaveLength(4);
    expect(addAnswer(question)).toBe(question);
    const withoutCorrect = removeAnswer(question, question.correctId as string);
    expect(withoutCorrect.answers).toHaveLength(3);
    expect(withoutCorrect.correctId).toBeNull();
  });

  it('turns the editor model into the contract and back', () => {
    const question = { ...newQuestion(30), prompt: ' Q ', feedbackRight: 'Yes', feedbackWrong: 'No' };
    question.answers = question.answers.map((answer, index) => ({ ...answer, text: `A${index}` }));
    const set = toQuestionSet('lesson-1', 'video', [question]);
    expect(set.questions[0]).toMatchObject({ prompt: 'Q', atSeconds: 30, pauseUntilAnswered: true });
    expect(set.questions[0]!.answers.map((answer) => [answer.correct, answer.feedback])).toEqual([
      [true, 'Yes'],
      [false, 'No'],
    ]);
    expect(toQuestionSet('lesson-1', 'check', [question]).questions[0]).not.toHaveProperty('atSeconds');
    const back = fromQuestionSet(set)[0]!;
    expect(back).toMatchObject({ prompt: 'Q', time: '0:30', feedbackRight: 'Yes', feedbackWrong: 'No', correctId: question.answers[0]!.id });
  });

  it('orders video questions by time', () => {
    const late = { ...newQuestion(50), id: 'late' };
    const early = { ...newQuestion(5), id: 'early' };
    expect(sortByTime([late, early]).map((question) => question.id)).toEqual(['early', 'late']);
  });
});

describe('typed lesson', () => {
  beforeEach(() => window.localStorage.clear());

  it('turns editor blocks into the contract, dropping what is empty', () => {
    const blocks = toReadBlocks([
      { id: '1', kind: 'heading', text: ' Clean water ' },
      { id: '2', kind: 'paragraph', text: '   ' },
      { id: '3', kind: 'list', text: 'Boil it\n\n Cover it ', ordered: true },
      { id: '4', kind: 'picture', picture: { url: '/pictures/x.svg', alt: 'A pot' }, caption: ' ' },
    ]);
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Clean water' },
      { kind: 'list', ordered: true, items: ['Boil it', 'Cover it'] },
      { kind: 'picture', picture: { url: '/pictures/x.svg', alt: 'A pot' }, caption: null },
    ]);
    expect(countWords([{ id: '1', kind: 'paragraph', text: 'Dirty water can make people sick.' }])).toBe(6);
  });

  it('needs a title and some text', () => {
    const draft = emptyDraft();
    expect(typedProblem(draft)?.field).toBe('title');
    expect(typedProblem({ ...draft, title: 'T' })?.field).toBe('blocks');
    expect(typedProblem({ ...draft, title: 'T', blocks: [{ id: '1', kind: 'paragraph', text: 'Words' }] })).toBeNull();
  });

  it('keeps the draft on this phone across a refresh, with the same request key', () => {
    const draft = { ...emptyDraft(), title: 'Keeping water clean', blocks: [{ id: 'b1', kind: 'paragraph' as const, text: 'Boil it.' }], voice: { uploadId: 'upload-1', fileName: 'me.m4a' } };
    expect(saveTypedDraft(draft)).toBe(true);
    expect(loadTypedDraft()).toEqual(draft);
    clearTypedDraft();
    expect(loadTypedDraft()).toBeNull();
  });

  it('treats what is in storage as untrusted', () => {
    window.localStorage.setItem('sensebod.admin.typed-draft.v1', 'not json');
    expect(loadTypedDraft()).toBeNull();
    window.localStorage.setItem(
      'sensebod.admin.typed-draft.v1',
      JSON.stringify({
        title: 42,
        blocks: [{ kind: 'script', text: 'x' }, { kind: 'picture', picture: { url: 'https://evil.example/x.png', alt: '' } }, { kind: 'picture', picture: { url: '//evil.example/x.png', alt: '' } }, { kind: 'paragraph', text: 'kept' }],
      }),
    );
    const loaded = loadTypedDraft();
    expect(loaded?.title).toBe('');
    expect(loaded?.blocks).toHaveLength(1);
    expect(loaded?.blocks[0]).toMatchObject({ kind: 'paragraph', text: 'kept' });
    expect(loaded?.requestKey).toBeTruthy();
  });

  it('refuses a draft too large to keep', () => {
    expect(saveTypedDraft({ ...emptyDraft(), title: 'x'.repeat(250000) })).toBe(false);
  });
});

describe('recently published and rotation', () => {
  beforeEach(() => window.localStorage.clear());

  it('remembers the last five published ids, newest first, without repeats', () => {
    ['a', 'b', 'c', 'd', 'e', 'f', 'b'].forEach(rememberPublished);
    expect(recentPublishedIds()).toEqual(['b', 'f', 'e', 'd', 'c']);
    forgetPublished('f');
    expect(recentPublishedIds()).toEqual(['b', 'e', 'd', 'c']);
    window.localStorage.setItem('sensebod.admin.recent-published.v1', '{"not":"a list"}');
    expect(recentPublishedIds()).toEqual([]);
  });

  it('sizes a turned photo and caps it for low-memory phones', () => {
    expect(rotatedSize(1000, 500, 90)).toEqual({ width: 500, height: 1000, scale: 1 });
    expect(rotatedSize(1000, 500, 180)).toEqual({ width: 1000, height: 500, scale: 1 });
    expect(rotatedSize(4000, 3000, 90)).toEqual({ width: 1500, height: 2000, scale: 0.5 });
    expect(nextRotation(270)).toBe(0);
    expect(rotatedName('IMG_1.PNG')).toBe('IMG_1.jpg');
  });
});
