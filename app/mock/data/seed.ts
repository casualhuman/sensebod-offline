/*
 * Seed data for the mock API, taken from the design boards and from
 * content/agriculture-videos.csv. Development and tests only.
 *
 * Where a board shows a placeholder ("[length]", "[pages] pages") the value
 * here is null, so screens draw the same placeholder. Text marked [Sample]
 * is sample content exactly as the handoff describes it.
 */
import type {
  AdminLesson,
  AudienceKey,
  Availability,
  ContentIconKey,
  GalleryPicture,
  GroupKind,
  Learner,
  LessonContent,
  LessonProgress,
  LessonSource,
  LessonType,
  Picture,
  PictureGroup,
  Portal,
  PortalId,
  ProgressState,
  QuizQuestion,
  ReadBlock,
  Upload,
  VideoQuestion,
} from '../../src/shared/api/types.ts';
import { AGRICULTURE_VIDEOS, ILLUSTRATION_ALTS } from './generated.ts';
import { SUBJECT_PICTURES } from './subjectPictures.ts';

export interface GroupRecord {
  id: string;
  portalId: PortalId;
  kind: GroupKind;
  title: string;
  description: string;
  picture: Picture | null;
  availability: Availability;
  icon?: ContentIconKey | null;
  audience?: AudienceKey | null;
}

export interface SeriesRecord {
  id: string;
  portalId: PortalId;
  groupId: string;
  title: string;
  description: string;
  picture: Picture | null;
  availability: Availability;
  listenUrl: string | null;
  icon?: ContentIconKey | null;
}

export interface LessonRecord extends AdminLesson {
  content: LessonContent;
  listenUrl: string | null;
}

export interface MockDb {
  portals: Portal[];
  groups: GroupRecord[];
  series: SeriesRecord[];
  lessons: LessonRecord[];
  learners: Learner[];
  progress: Record<string, LessonProgress[]>;
  uploads: Upload[];
  pictures: GalleryPicture[];
  /** Idempotency-Key → id of the thing it created. */
  idempotency: Record<string, string>;
  nextId: number;
}

export const SAMPLE_VIDEO = '/media/sample-video.mp4';
export const SAMPLE_AUDIO = '/media/sample-audio.m4a';
export const SAMPLE_VOICE = '/media/sample-voice.m4a';
export const SAMPLE_CAPTIONS = '/media/sample-captions.vtt';
export const SAMPLE_PACKAGE = '/media/tryit/sample/index.html';
const SEED_DATE = '2026-11-12T09:00:00.000Z';

/** Picture from the repository's illustrations/ folder, with the drawing's own description. */
export function pic(key: string): Picture {
  return { url: `/illustrations/${key}.svg`, alt: ILLUSTRATION_ALTS[key] ?? '' };
}

/** The collection of stand-in pictures for a school subject (see subjectPictures.ts). */
function subjectPics(title: string): Picture[] {
  return SUBJECT_PICTURES[title === 'Integrated Science' ? 'Science' : title] ?? [];
}

/** The subject's own picture: the first of its collection. */
function subjectPic(title: string): Picture | null {
  return subjectPics(title)[0] ?? null;
}

function portalPic(id: PortalId, alt: string): Picture {
  return { url: `/pictures/portals/${id}.svg`, alt };
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ------------------------------------------------------------------ */
/* lesson content samples                                              */
/* ------------------------------------------------------------------ */

function question(id: string, prompt: string, answers: [string, boolean, string][]): QuizQuestion {
  return {
    id,
    prompt,
    listenUrl: null,
    allowRetry: true,
    answers: answers.map(([text, correct, feedback], index) => ({ id: `${id}-a${index + 1}`, text, correct, feedback })),
  };
}

function watch(poster: Picture | null, questions: VideoQuestion[] = [], learningPoints: string[] = []): LessonContent {
  return {
    type: 'watch',
    sources: [{ url: SAMPLE_VIDEO, mimeType: 'video/mp4' }],
    poster,
    captions: [{ language: 'en', label: 'English', url: SAMPLE_CAPTIONS }],
    questions,
    learningPoints,
  };
}

function listen(cover: Picture | null, lines: string[]): LessonContent {
  return {
    type: 'listen',
    sources: [{ url: SAMPLE_AUDIO, mimeType: 'audio/mp4' }],
    cover,
    transcript: lines.map((text, index) => ({ start: index * 4, text })),
  };
}

function read(cover: Picture | null, blocks: ReadBlock[], withVoice = false): LessonContent {
  return { type: 'read', blocks, pageImages: [], audio: withVoice ? { url: SAMPLE_AUDIO, mimeType: 'audio/mp4' } : null, cover };
}

const NOT_MY_FAULT_QUESTIONS: VideoQuestion[] = [
  {
    ...question('cp-child-l4-q1', 'If an adult hurts a child, whose fault is it?', [
      ['It is never the child’s fault', true, 'The adult is always responsible. You did nothing wrong.'],
      ['It is the child’s fault', false, 'A child is never to blame. Tap the other answer.'],
    ]),
    atSeconds: 6,
    pauseUntilAnswered: true,
  },
  {
    ...question('cp-child-l4-q2', '[Sample] If something feels wrong, what can you do?', [
      ['Tell a grown-up you trust', true, 'Telling someone is brave. They can help you.'],
      ['Keep it a secret', false, 'You do not have to keep it a secret. Tap the other answer.'],
    ]),
    atSeconds: 14,
    pauseUntilAnswered: true,
  },
];

const PARENT_NOTE: ReadBlock[] = [
  { kind: 'heading', text: 'Talking about safety at home' },
  {
    kind: 'paragraph',
    text: '[Sample text] Children feel safe when they know they can talk to you about anything, big or small. This note gives you a few simple ways to start.',
  },
  {
    kind: 'paragraph',
    text: 'Choose a calm, ordinary moment to talk, for example while you cook or walk to the market. Short talks, often, work better than one big talk.',
  },
  { kind: 'paragraph', text: 'Get down to your child’s height. Look at them and listen.' },
  { kind: 'heading', text: 'Three things you can do this week' },
  {
    kind: 'list',
    ordered: true,
    items: [
      'Use the real names for parts of the body, so your child can tell you clearly if something is wrong.',
      'Agree on trusted adults. Your child can come to you, and to two more grown-ups you both trust.',
      'Listen calmly. If your child tells you something, stay calm and say: “Thank you for telling me. You did the right thing.”',
    ],
  },
  {
    kind: 'paragraph',
    text: 'If you are ever worried about a child, you do not have to handle it alone. The Get help page shows who you can talk to.',
  },
];

function cpQuiz(prefix: string): QuizQuestion[] {
  return [
    question(`${prefix}-q1`, '[Sample] Who can you tell if something feels wrong?', [
      ['A grown-up I trust', true, 'Yes. A parent, a teacher, a health worker or an elder can help.'],
      ['Nobody', false, 'You are not alone. There are grown-ups who will listen. Try again.'],
    ]),
    question(`${prefix}-q2`, '[Sample] Is it ever the child’s fault?', [
      ['No, never', true, 'That is right. The adult is always responsible.'],
      ['Yes, sometimes', false, 'A child is never to blame. Try again.'],
    ]),
  ];
}

const QUAIL_QUIZ: QuizQuestion[] = [
  question('agri-quail-q1', 'Why do we build the quail house off the ground?', [
    ['To keep the birds dry and safe', true, 'A raised house stays dry when it rains, and it is harder for rats and snakes to get in.'],
    ['So the quail can fly out', false, 'The house is raised to keep the birds dry and safe, not to let them out.'],
    ['To use less wood', false, 'A raised house uses more wood, but it keeps the birds dry and safe.'],
  ]),
  question('agri-quail-q2', 'What helps quail stay healthy in their house?', [
    ['Fresh air, shade and a dry floor', true, 'Fresh air, shade and a dry floor keep quail cool, clean and healthy.'],
    ['Full sun all day and no roof', false, 'Good try. Too much sun makes quail too hot. Think about what keeps them cool and dry.'],
    ['A wet floor and closed walls', false, 'Good try. A wet floor makes quail sick and closed walls stop fresh air.'],
  ]),
  question('agri-quail-q3', '[Sample] What should quail always have in their house?', [
    ['Clean water and feed', true, 'Clean water and feed every day keep the birds strong.'],
    ['Nothing. They find food by themselves', false, 'Quail in a house cannot look for food. They need you to bring it.'],
  ]),
];

/* ------------------------------------------------------------------ */
/* builders                                                            */
/* ------------------------------------------------------------------ */

interface LessonSpec {
  title: string;
  summary?: string;
  type: LessonType;
  interactive?: boolean;
  picture?: Picture | null;
  content?: LessonContent;
  language?: string;
  length?: number | null;
  pages?: number | null;
  fileName?: string;
  source?: LessonSource;
  status?: 'draft' | 'published';
  notes?: string[];
}

function defaultContent(spec: LessonSpec, picture: Picture | null, id: string): LessonContent {
  switch (spec.type) {
    case 'watch':
      return watch(picture);
    case 'listen':
      return listen(picture, ['[Sample] The words of the story appear here.', 'Each line is shown as it is read.', 'Nothing plays by itself.']);
    case 'read':
      return read(picture, [
        { kind: 'heading', text: spec.title },
        { kind: 'paragraph', text: '[Sample text] The words on this page show the layout only. They will be replaced by the note the admin uploads.' },
      ]);
    case 'try':
      return { type: 'try', mode: 'package', packageUrl: SAMPLE_PACKAGE };
    case 'check':
      return { type: 'check', questions: cpQuiz(id) };
  }
}

function buildDb(): MockDb {
  const db: MockDb = {
    portals: [],
    groups: [],
    series: [],
    lessons: [],
    learners: [],
    progress: {},
    uploads: [],
    pictures: [],
    idempotency: {},
    nextId: 1000,
  };

  const addGroup = (portalId: PortalId, kind: GroupKind, title: string, description: string, picture: Picture | null, availability: Availability = 'available', id?: string): GroupRecord => {
    const group: GroupRecord = { id: id ?? `${portalId}-${slug(title)}`, portalId, kind, title, description, picture, availability };
    db.groups.push(group);
    return group;
  };

  const addSeries = (group: GroupRecord, title: string, description: string, picture: Picture | null, specs: LessonSpec[], availability: Availability = 'available', id?: string): SeriesRecord => {
    const series: SeriesRecord = {
      id: id ?? `${group.id}-${slug(title)}`,
      portalId: group.portalId,
      groupId: group.id,
      title,
      description,
      picture,
      availability,
      listenUrl: null,
    };
    db.series.push(series);
    const portalTitle = db.portals.find((p) => p.id === group.portalId)?.title ?? group.portalId;
    let position = 0;
    for (const spec of specs) {
      const isCheck = spec.type === 'check';
      if (!isCheck) position += 1;
      const lessonId = isCheck ? `${series.id}-quiz` : `${series.id}-${position}`;
      const picture = spec.picture === undefined ? series.picture : spec.picture;
      const content = spec.content ?? defaultContent(spec, picture, lessonId);
      db.lessons.push({
        id: lessonId,
        seriesId: series.id,
        position: isCheck ? null : position,
        title: spec.title,
        summary: spec.summary ?? '',
        picture,
        language: spec.language ?? 'en',
        type: spec.type,
        interactive: spec.interactive ?? spec.type === 'try',
        captions: spec.type === 'watch' && group.portalId !== 'agriculture',
        readAlong: spec.type === 'listen' || (content.type === 'read' && content.audio !== null),
        needsSound: spec.type === 'watch' || spec.type === 'listen',
        length: spec.length ?? null,
        pages: spec.pages ?? null,
        status: spec.status ?? 'published',
        placement: { portalId: group.portalId, groupId: group.id, seriesId: series.id, position: isCheck ? specs.length : position },
        placementLabel: `${portalTitle} → ${group.title} → ${series.title}`,
        source: spec.source ?? (isCheck ? 'questions' : spec.type === 'try' ? 'animation' : spec.type === 'read' ? 'typed' : 'upload'),
        fileNames: spec.fileName ? [spec.fileName] : [],
        questionCount: content.type === 'check' ? content.questions.length : content.type === 'watch' && content.questions.length > 0 ? content.questions.length : null,
        pictureId: null,
        updatedAt: SEED_DATE,
        notes: spec.notes ?? [],
        content,
        listenUrl: null,
      });
    }
    return series;
  };

  /* ---- portals (Main board) ---- */
  db.portals = [
    { id: 'primary', title: 'Primary school', description: 'Class 1 to Class 6', theme: 'blue', groupKind: 'class', listenUrl: null, picture: portalPic('primary', 'A classroom: a teacher points at the blackboard and two children sit at their desks, one with a hand up') },
    { id: 'jss', title: 'Junior secondary', description: 'JSS 1 to JSS 3', theme: 'blue', groupKind: 'class', listenUrl: null, picture: portalPic('jss', 'A secondary school with a zinc roof and a flag; two students walk to class with their books') },
    { id: 'child-protection', title: 'Child protection', description: 'Stay safe and find help', theme: 'blue', groupKind: 'audience', listenUrl: null, picture: portalPic('child-protection', 'A mother and her child walk hand in hand towards their home; a heart above them') },
    { id: 'agriculture', title: 'Agriculture', description: 'Animals, crops and selling', theme: 'agriculture', groupKind: 'topic', listenUrl: null, picture: portalPic('agriculture', 'A farm: rows of crops, a maize plant, and a hen with her chicks') },
    { id: 'climate', title: 'Climate', description: 'Weather, floods and our land', theme: 'blue', groupKind: 'topic', listenUrl: null, picture: portalPic('climate', 'A village by a river: houses under a rain cloud, with the sun coming out') },
  ];

  /* ---- Primary and JSS (V3-Primary, V3-JSS): sample titles and counts ---- */
  const sampleLessons = (subject: string, count: number, named: Record<number, string> = {}): LessonSpec[] => {
    const types: LessonType[] = ['watch', 'listen', 'read'];
    const specs: LessonSpec[] = [];
    // Each lesson takes the next picture of the subject's collection, so a list does not repeat one picture.
    const pictures = subjectPics(subject);
    for (let n = 1; n <= count; n += 1) {
      specs.push({ title: named[n] ?? `[Sample] ${subject} lesson ${n}`, type: types[(n - 1) % types.length] as LessonType, picture: pictures.length > 0 ? pictures[(n - 1) % pictures.length] : null });
    }
    return specs;
  };
  for (let n = 1; n <= 6; n += 1) {
    const group = addGroup('primary', 'class', `Class ${n}`, `Lessons for Class ${n}`, null, 'available', `primary-class-${n}`);
    const board = n === 4;
    addSeries(group, 'English Language', '', subjectPic('English Language'), sampleLessons('English Language', board ? 8 : 3));
    addSeries(group, 'Mathematics', '', subjectPic('Mathematics'), sampleLessons('Mathematics', board ? 10 : 3, board ? { 3: 'Sharing equally' } : {}));
    addSeries(group, 'Science', '', subjectPic('Science'), sampleLessons('Science', board ? 9 : 3));
    if (board) addSeries(group, 'Social Studies', 'Not in this bag yet. Ask your teacher.', subjectPic('Social Studies'), [], 'not-in-bag');
  }
  for (let n = 1; n <= 3; n += 1) {
    const group = addGroup('jss', 'class', `JSS ${n}`, `Lessons for JSS ${n}`, null, 'available', `jss-${n}`);
    const board = n === 2;
    addSeries(group, 'English Language', '', subjectPic('English Language'), sampleLessons('English Language', board ? 10 : 3));
    addSeries(group, 'Mathematics', '', subjectPic('Mathematics'), sampleLessons('Mathematics', board ? 14 : 3));
    const science = sampleLessons('Integrated Science', board ? 12 : 3, board ? { 4: 'Kinds of matter' } : {});
    if (board) science.push({ title: 'Practice quiz', summary: 'Integrated Science · JSS 2', type: 'check' });
    addSeries(group, 'Integrated Science', '', subjectPic('Integrated Science'), science);
    addSeries(group, 'Social Studies', '', subjectPic('Social Studies'), sampleLessons('Social Studies', board ? 8 : 3));
    if (board) addSeries(group, 'Agricultural Science', 'Not in this bag yet. Ask your teacher.', subjectPic('Agricultural Science'), [], 'not-in-bag');
  }

  /* ---- Child protection (CPB-Who, CPB-Child, CPB-Parent, CPB-Elder) ---- */
  const cp = 'child-protection/scenes/';
  const child = addGroup('child-protection', 'audience', 'I am a child', 'Big pictures and stories to help you stay safe.', pic(`${cp}CPB-Who-children`), 'available', 'cp-child');
  const parent = addGroup('child-protection', 'audience', 'I am a parent or carer', 'How to keep your children safe and listen to them.', pic(`${cp}CPB-Who-parents`), 'available', 'cp-parent');
  const elder = addGroup('child-protection', 'audience', 'I am a community elder', 'Your role in keeping the children of your community safe.', pic(`${cp}CPB-Who-elders`), 'available', 'cp-elder');

  addSeries(
    child,
    'Staying safe',
    'For children. 4 short lessons to watch, listen to and try.',
    pic(`${cp}CPB-Child-header`),
    [
      { title: 'My body belongs to me', summary: 'You can say no.', type: 'watch', picture: pic(`${cp}CPB-Child-lesson1`), content: watch(pic(`${cp}CPB-Video-poster`), [], ['Your body belongs to you.', 'You can say no.']), fileName: 'My body belongs to me.mp4' },
      {
        title: 'Safe and unsafe touch',
        summary: 'A story to listen to.',
        type: 'listen',
        picture: pic(`${cp}CPB-Child-lesson2`),
        content: listen(pic(`${cp}CPB-Audio-cover`), [
          'Mariama’s aunty gives her a big hug. It feels good and safe.',
          'One day, someone touches her in a way that feels wrong.',
          'Mariama says “No!” She goes to tell her teacher.',
        ]),
        fileName: 'Safe and unsafe touch.m4a',
      },
      {
        title: 'Who can I tell?',
        summary: 'Tap the grown-ups who can help you.',
        type: 'try',
        interactive: true,
        picture: pic(`${cp}CPB-Child-lesson3`),
        fileName: 'Who can I tell — village.zip',
        content: {
          type: 'try',
          mode: 'hotspots',
          instruction: 'Tap each person you can tell.',
          scene: pic(`${cp}CPB-TryIt-village`),
          goal: 'all',
          finishMessage: 'Well done! You found 4 people you can tell.',
          gentleMovement: true,
          spots: [
            { id: 'spot-1', label: 'Mr Koroma', role: 'Teacher, at the school', says: 'You can tell me. I will listen and help.', audioUrl: SAMPLE_VOICE, portrait: pic('child-protection/cast/mr-koroma'), x: 20, y: 34, r: 12 },
            { id: 'spot-2', label: 'Nurse Aminata', role: 'Health worker, at the clinic', says: 'You can come to the clinic and tell me. I will help keep you safe.', audioUrl: SAMPLE_VOICE, portrait: pic('child-protection/cast/nurse-aminata'), x: 78, y: 34, r: 12 },
            { id: 'spot-3', label: 'Haja', role: 'Grandmother, at home', says: 'You can always tell me. It is never your fault.', audioUrl: SAMPLE_VOICE, portrait: pic('child-protection/cast/haja'), x: 22, y: 76, r: 12 },
            { id: 'spot-4', label: 'Officer Sesay', role: 'Family Support Unit, at the police post', says: 'You can tell me. My job is to help keep children safe.', audioUrl: null, portrait: pic('child-protection/cast/officer-sesay'), x: 78, y: 76, r: 12 },
          ],
        },
      },
      {
        title: 'It is not my fault',
        summary: 'You did nothing wrong.',
        type: 'watch',
        interactive: true,
        picture: pic(`${cp}CPB-Child-lesson4`),
        content: watch(pic(`${cp}CPB-WatchAnswer-frame`), NOT_MY_FAULT_QUESTIONS, ['It is never your fault.', 'Telling someone is brave.']),
        fileName: 'It is not my fault.mp4',
      },
      { title: 'Check what you learned', summary: 'A short quiz after the 4 lessons.', type: 'check', picture: pic(`${cp}CPB-Child-quiz`), content: { type: 'check', questions: cpQuiz('cp-child-quiz') } },
    ],
    'available',
    'cp-child-staying-safe',
  );

  addSeries(
    parent,
    'Keeping children safe',
    'For parents and carers. 5 short lessons to watch, listen to, read and try.',
    pic(`${cp}CPB-Parent-header`),
    [
      { title: 'Keeping children safe at home', type: 'watch', picture: pic(`${cp}CPB-Parent-l1`) },
      { title: 'Signs a child may need help', type: 'listen', picture: pic(`${cp}CPB-Parent-l2`) },
      { title: 'How to listen when a child tells you', type: 'watch', interactive: true, picture: pic(`${cp}CPB-Parent-l3`), content: watch(pic(`${cp}CPB-Parent-l3`), NOT_MY_FAULT_QUESTIONS.map((q) => ({ ...q, id: `cp-parent-l3-${q.id}` }))) },
      { title: 'Where to report [confirm local services]', type: 'try', interactive: true, picture: pic(`${cp}CPB-Parent-l4`) },
      {
        title: 'A note for parents: talking about safety at home',
        summary: 'Typed text · set to Read automatically.',
        type: 'read',
        picture: pic(`${cp}CPB-Parent-l5`),
        content: read(pic(`${cp}CPB-Read-cover`), PARENT_NOTE, true),
      },
      { title: 'Check what you learned', summary: 'A short quiz after the 5 lessons.', type: 'check', picture: pic(`${cp}CPB-Parent-quiz`), content: { type: 'check', questions: cpQuiz('cp-parent-quiz') } },
    ],
    'available',
    'cp-parent-keeping-children-safe',
  );

  addSeries(
    elder,
    'Protecting our children',
    'For community elders. You help keep every child safe.',
    pic(`${cp}CPB-Elder-header`),
    [
      { title: 'Your role in protecting children', type: 'watch', picture: pic(`${cp}CPB-Elder-l1`) },
      { title: 'Talking with families', type: 'listen', picture: pic(`${cp}CPB-Elder-l2`) },
      { title: 'How to refer a case [confirm local referral path]', type: 'try', interactive: true, picture: pic(`${cp}CPB-Elder-l3`) },
      { title: 'Child marriage and the law [confirm local guidance]', type: 'watch', interactive: true, picture: pic(`${cp}CPB-Elder-l4`), content: watch(pic(`${cp}CPB-Elder-l4`), NOT_MY_FAULT_QUESTIONS.map((q) => ({ ...q, id: `cp-elder-l4-${q.id}` }))) },
      { title: 'Check what you learned', summary: 'A short quiz after the 4 lessons.', type: 'check', picture: pic(`${cp}CPB-Elder-quiz`), content: { type: 'check', questions: cpQuiz('cp-elder-quiz') } },
    ],
    'available',
    'cp-elder-protecting-our-children',
  );

  /* ---- Agriculture (AGB-Agriculture + content/agriculture-videos.csv) ---- */
  const ag = 'agriculture/scenes/';
  const topics: { title: string; description: string; scene: string; first?: string[] }[] = [
    { title: 'Chickens and quail', description: 'Housing, feeding and keeping birds healthy.', scene: 'chickens-feeding', first: ['Feeding improved chickens', 'Quail housing', 'Taking care of local chickens'] },
    { title: 'Rabbits', description: 'Housing, breeding, feeding and young rabbits.', scene: 'rabbits-feeding' },
    { title: 'Milk and dairy cows', description: 'Milking, clean milk, yoghurt and cheese.', scene: 'hand-milking' },
    { title: 'Goats, snails and grasscutters', description: 'Feeding goats, snails and grasscutters.', scene: 'goats-snails' },
    { title: 'Feed and animal health', description: 'Feed, fodder, herbal remedies, pigs and pasture.', scene: 'feed-trough' },
  ];
  const lessonScenes: Record<string, string> = {
    'Quail housing': 'quail-house',
    'How to build a rabbit house': 'rabbit-house',
    'Making yoghurt at home': 'yoghurt',
    'Taking milk to the collection centre': 'milk-centre',
  };
  for (const topic of topics) {
    const picture = pic(`${ag}${topic.scene}`);
    const group = addGroup('agriculture', 'topic', topic.title, topic.description, picture);
    const videos = AGRICULTURE_VIDEOS.filter((video) => video.topic === topic.title);
    const order = topic.first ?? [];
    videos.sort((a, b) => {
      const ia = order.indexOf(a.title);
      const ib = order.indexOf(b.title);
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
    });
    const specs: LessonSpec[] = videos.map((video) => ({
      title: video.title,
      type: 'watch',
      language: video.language,
      fileName: video.file,
      picture: lessonScenes[video.title] ? pic(`${ag}${lessonScenes[video.title]}`) : picture,
    }));
    if (topic.title === 'Chickens and quail') {
      specs.push({ title: 'Quick quiz: keeping quail', summary: 'Mr Bangura asks. Tap your answer.', type: 'check', picture: pic(`${ag}quiz`), content: { type: 'check', questions: QUAIL_QUIZ } });
    }
    addSeries(group, topic.title, topic.description, picture, specs, 'available', `${group.id}-videos`);
  }
  const crops = addGroup('agriculture', 'topic', 'Crops', 'Not in this bag yet. Ask your facilitator.', pic(`${ag}crops-field`), 'not-in-bag');
  addSeries(crops, 'Crops', 'Not in this bag yet. Ask your facilitator.', crops.picture, [], 'not-in-bag', `${crops.id}-videos`);

  /* ---- Climate (CLB-Climate, CLB-Climate-Lesson) ---- */
  const cl = 'climate/scenes/';
  const pictureLesson = (title: string, frames: string[], lines: string[]): LessonSpec => ({
    title,
    type: 'read',
    picture: pic(`${cl}${frames[0]}`),
    content: read(
      pic(`${cl}${frames[0]}`),
      frames.map((frame, index): ReadBlock => ({ kind: 'picture', picture: pic(`${cl}${frame}`), caption: lines[index] ?? null })),
    ),
  });
  const climateTopics: { title: string; description: string; scene: string; lessons: LessonSpec[]; availability?: Availability }[] = [
    { title: 'Rainy and dry seasons', description: 'Picture lessons', scene: 'clb-climate-rainy', lessons: [pictureLesson('[Sample] The two seasons', ['clb-climate-rainy'], ['The rains come, then the dry season.'])] },
    {
      title: 'Floods: stay safe',
      description: 'Picture lessons',
      scene: 'clb-climate-floods',
      lessons: [
        pictureLesson('Move to high ground before the water rises', ['clb-lesson-frame1', 'clb-lesson-frame2', 'clb-lesson-frame3'], ['Rain falls', 'River rises', 'Walk uphill']),
        pictureLesson('[Sample] Keep your papers and water safe', ['clb-lesson-step'], ['Put important things up high.']),
        pictureLesson('[Sample] After the flood', ['clb-climate-continue'], ['Do not walk or drive through moving flood water.']),
        { title: 'Quick quiz: floods', summary: 'Check what you learned', type: 'check', picture: pic(`${cl}clb-climate-quiz`) },
      ],
    },
    { title: 'Keeping our land and water clean', description: 'Picture lessons', scene: 'clb-climate-clean', lessons: [pictureLesson('[Sample] Clean water, healthy village', ['clb-climate-clean'], ['Keep rubbish away from the water.'])] },
    { title: 'Heat and health', description: 'Picture lessons', scene: 'clb-climate-heat', lessons: [pictureLesson('[Sample] Staying cool in the heat', ['clb-climate-heat'], ['Drink water and rest in the shade.'])] },
    { title: 'Growing food when the weather changes', description: 'Not in this bag yet. Ask your facilitator.', scene: 'clb-climate-growing', lessons: [], availability: 'not-in-bag' },
  ];
  for (const topic of climateTopics) {
    const picture = pic(`${cl}${topic.scene}`);
    const group = addGroup('climate', 'topic', topic.title, topic.description, picture, topic.availability ?? 'available');
    addSeries(group, topic.title, topic.description, picture, topic.lessons, topic.availability ?? 'available', `${group.id}-lessons`);
  }

  /* ---- badge icons and audiences (set here by title: the seed is sample data) ---- */
  const subjectIcons: Record<string, ContentIconKey> = {
    'English Language': 'language',
    Mathematics: 'maths',
    Science: 'science',
    'Integrated Science': 'science',
    'Social Studies': 'social-studies',
    'Agricultural Science': 'crops',
    'Rainy and dry seasons': 'seasons',
    'Floods: stay safe': 'floods',
    'Keeping our land and water clean': 'clean-water',
    'Heat and health': 'heat',
    'Growing food when the weather changes': 'crops',
    Crops: 'crops',
  };
  for (const series of db.series) series.icon = subjectIcons[series.title] ?? null;
  for (const group of db.groups) group.icon = subjectIcons[group.title] ?? null;
  child.audience = 'child';
  parent.audience = 'parent';
  elder.audience = 'elder';

  /* ---- drafts waiting to be placed (ADM-M-Home) ---- */
  const draft = (id: string, title: string, type: LessonType, source: LessonSource, fileNames: string[], extra: Partial<LessonRecord>): LessonRecord => ({
    id,
    seriesId: '',
    position: null,
    title,
    summary: '',
    picture: null,
    language: 'en',
    type,
    interactive: false,
    captions: false,
    readAlong: false,
    needsSound: type === 'listen' || type === 'watch',
    length: null,
    pages: null,
    status: 'draft',
    placement: null,
    placementLabel: null,
    source,
    fileNames,
    questionCount: null,
    pictureId: null,
    updatedAt: SEED_DATE,
    notes: [],
    listenUrl: null,
    content: defaultContent({ title, type }, null, id),
    ...extra,
  });
  db.lessons.push(
    draft('draft-safe-touch-story', 'Safe and unsafe touch — story', 'listen', 'upload', ['PTT-[date].opus'], {
      length: 102,
      notes: ['Read along text not added. It helps learners who cannot hear well.'],
    }),
    draft('draft-fatmata-science-notes', 'Fatmata’s science notes', 'read', 'notes-photos', ['notes-1.jpg', 'notes-2.jpg', 'notes-3.jpg'], { pages: 3 }),
  );

  /* ---- picture gallery (ADM-M-Picture, ADM-Picture): every scene and portrait ---- */
  const groupOf = (key: string): PictureGroup => {
    if (key.indexOf('/cast/') !== -1) return 'people-places';
    if (/quiz|school|lesson3|teacher/i.test(key) && key.indexOf('child-protection') === 0) return 'school';
    if (key.indexOf('child-protection') === 0) return 'child-protection';
    if (key.indexOf('agriculture') === 0) return 'agriculture';
    return 'climate';
  };
  db.pictures = Object.keys(ILLUSTRATION_ALTS)
    .filter((key) => key.indexOf('-Tab-') === -1 && ILLUSTRATION_ALTS[key])
    .map((key) => ({ id: `pic-${slug(key)}`, group: groupOf(key), ...pic(key) }));
  // The school subject collections, for the admin to choose from under "School".
  for (const subject of Object.keys(SUBJECT_PICTURES)) {
    for (const picture of SUBJECT_PICTURES[subject] ?? []) {
      db.pictures.push({ id: `pic-${slug(picture.url.replace('/pictures/subjects/', '').replace('.svg', ''))}`, group: 'school', ...picture });
    }
  }

  /* ---- learners and progress (V3-SignIn, AGB-Agriculture, CPB-Child) ---- */
  db.learners = [
    { id: 'learner-aminata', name: 'Aminata Kamara', role: 'learner', roleLabel: 'Learner · JSS 2' },
    { id: 'learner-mohamed', name: 'Mohamed Sesay', role: 'other', roleLabel: 'Farmer' },
  ];
  const mark = (lessonId: string, state: ProgressState, positionSeconds: number | null = null): LessonProgress => {
    const lesson = db.lessons.find((l) => l.id === lessonId);
    return { lessonId, seriesId: lesson ? lesson.seriesId : '', lessonType: lesson ? lesson.type : 'watch', state, positionSeconds, correct: null, total: null, updatedAt: SEED_DATE };
  };
  const dairy = db.lessons.filter((l) => l.seriesId === 'agriculture-milk-and-dairy-cows-videos').map((l) => mark(l.id, 'finished'));
  db.progress = {
    'learner-aminata': [
      mark('cp-child-staying-safe-1', 'finished'),
      mark('cp-child-staying-safe-2', 'started', 8),
      mark('agriculture-chickens-and-quail-videos-1', 'finished'),
      mark('agriculture-chickens-and-quail-videos-2', 'started', 8),
      ...dairy,
    ],
    'learner-mohamed': [mark('agriculture-rabbits-videos-1', 'started', 5)],
  };

  return db;
}

/** A fresh database. Each test and each dev-server start gets its own. */
export function createDb(): MockDb {
  return buildDb();
}
