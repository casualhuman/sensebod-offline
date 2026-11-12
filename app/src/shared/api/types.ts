/*
 * Shared data types: the agreement between the four frontend streams and the
 * future backend. Documented field by field in docs/API-CONTRACT.md.
 * Change only through stream 1 (see docs/TEAM.md).
 *
 * Conventions
 *  - ids are URL-safe slugs (strings), stable once published
 *  - every URL is root-relative and served by the Pi ("/media/…", "/illustrations/…")
 *  - `null` means "not known" and shows the board placeholder ("[length]");
 *    never invent a value on the client
 *  - times are seconds (numbers); dates are ISO 8601 strings
 */

/* ------------------------------------------------------------------ */
/* Content model: Portal → group (class / audience / topic) → series → lessons */
/* ------------------------------------------------------------------ */

export type PortalId = 'primary' | 'jss' | 'child-protection' | 'agriculture' | 'climate';

/** Which colour roles a screen uses. Everything is blue except Agriculture. */
export type ThemeName = 'blue' | 'agriculture';

/** What the second level is called in a portal. */
export type GroupKind = 'class' | 'audience' | 'topic';

/** Tag by what the learner does. `try` is shown as "Try it", `check` as "Check". */
export type LessonType = 'watch' | 'listen' | 'read' | 'try' | 'check';

/** The four types offered in the learner filter (Check is never in the filter). */
export type FilterableLessonType = Exclude<LessonType, 'check'>;

export type ProgressState = 'not-started' | 'started' | 'finished';

/** `not-in-bag`: listed so learners know it exists, but the content is not on this Pi. */
export type Availability = 'available' | 'not-in-bag';

export type LanguageCode = 'en' | 'kri';

/** A picture with its text alternative. `url` is root-relative. */
export interface Picture {
  url: string;
  /** Describes the scene for screen readers; empty string if purely decorative. */
  alt: string;
}

export interface Portal {
  id: PortalId;
  title: string;
  /** Short line under the title, e.g. "Class 1 to Class 6". */
  description: string;
  theme: ThemeName;
  groupKind: GroupKind;
  /** Scene for the portal card and the portal header. Null: draw the tint only. */
  picture: Picture | null;
  /** Page narration for the Listen button, if recorded. */
  listenUrl: string | null;
}

export interface Group {
  id: string;
  portalId: PortalId;
  kind: GroupKind;
  /** "Class 4", "I am a child", "Chickens and quail". */
  title: string;
  description: string;
  picture: Picture | null;
  availability: Availability;
  /** Published lessons in the group, quizzes not counted. */
  lessonCount: number;
  /** The lesson types present, for lines such as "Watch · 12 videos". */
  lessonTypes: LessonType[];
  /** Number of series inside; when 1 the UI may skip straight to the lesson list. */
  seriesCount: number;
  /** Set when seriesCount is 1, so the list can link directly. */
  onlySeriesId: string | null;
}

export interface PortalDetail extends Portal {
  groups: Group[];
}

export interface SeriesSummary {
  id: string;
  portalId: PortalId;
  groupId: string;
  title: string;
  description: string;
  picture: Picture | null;
  availability: Availability;
  /** Published lessons, the Check quiz not counted. */
  lessonCount: number;
  hasQuiz: boolean;
}

export interface GroupDetail extends Group {
  portal: Pick<Portal, 'id' | 'title' | 'theme' | 'groupKind'>;
  series: SeriesSummary[];
}

/**
 * The "data tag" from the component library: card, filter, header and button
 * are all drawn from these fields. Nobody types the words by hand.
 */
export interface LessonTag {
  type: LessonType;
  /** true shows "You take part"; on a Watch lesson the button reads "Watch and answer". */
  interactive: boolean;
  /** Watch: adds "Captions" to the facts row. */
  captions: boolean;
  /** Listen, and Read when the admin recorded their voice: adds "Read along". */
  readAlong: boolean;
  /** Watch and Listen: adds "Needs sound". */
  needsSound: boolean;
  /** Seconds. null shows "[length]". */
  length: number | null;
  /** Read lessons. null shows "[pages] pages". Counted from the file, never typed. */
  pages: number | null;
}

export interface LessonSummary extends LessonTag {
  id: string;
  seriesId: string;
  /** 1-based place in the series. null for the Check quiz, which is always last. */
  position: number | null;
  title: string;
  /** One short line under the title. */
  summary: string;
  picture: Picture | null;
  language: string;
}

export interface SeriesDetail extends SeriesSummary {
  portal: Pick<Portal, 'id' | 'title' | 'theme' | 'groupKind'>;
  group: Pick<Group, 'id' | 'title' | 'kind'>;
  /** In learner order; the Check quiz, if any, is the last item. */
  lessons: LessonSummary[];
  listenUrl: string | null;
}

/* ---- lesson content, one shape per type ---- */

export interface MediaSource {
  url: string;
  /** e.g. "video/mp4", "audio/mp4". */
  mimeType: string;
}

export interface QuizAnswer {
  id: string;
  text: string;
  correct: boolean;
  /** Always says why ("Right and wrong always say why"). */
  feedback: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  /** Recorded reading of the question for the Listen button, if any. */
  listenUrl: string | null;
  answers: QuizAnswer[];
  /** After a wrong answer the learner may choose again. No timers, ever. */
  allowRetry: boolean;
}

/** A question shown over a paused video ("Watch and answer"). */
export interface VideoQuestion extends QuizQuestion {
  /** Where the video stops, in seconds. */
  atSeconds: number;
  pauseUntilAnswered: boolean;
}

export interface CaptionTrack {
  language: string;
  label: string;
  /** WebVTT file. */
  url: string;
}

export interface WatchContent {
  type: 'watch';
  /** First source is the default; a "smaller copy for old phones" comes second if made. */
  sources: MediaSource[];
  poster: Picture | null;
  captions: CaptionTrack[];
  /** Empty unless the lesson is interactive. Sorted by atSeconds. */
  questions: VideoQuestion[];
  /** "What you will learn" lines under the player, if written. */
  learningPoints: string[];
}

export interface TranscriptLine {
  /** Seconds from the start of the audio; null when the text is not timed. */
  start: number | null;
  text: string;
}

export interface ListenContent {
  type: 'listen';
  sources: MediaSource[];
  cover: Picture | null;
  /** Read along. Empty when the admin has not added the words. */
  transcript: TranscriptLine[];
}

export type ReadBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'picture'; picture: Picture; caption: string | null };

export interface ReadContent {
  type: 'read';
  /** Typed text or text taken from a document. Empty for photo-only lessons. */
  blocks: ReadBlock[];
  /** Photos of notes or rendered PDF/Word pages, in order. Empty for typed lessons. */
  pageImages: Picture[];
  /** Read along: the admin's recorded voice, if any. */
  audio: MediaSource | null;
  cover: Picture | null;
}

export interface TryItSpot {
  id: string;
  /** "Mr Koroma". */
  label: string;
  /** "Teacher, at the school". */
  role: string;
  /** What they say when tapped. */
  says: string;
  audioUrl: string | null;
  portrait: Picture | null;
  /** Centre and radius of the tappable circle, in percent of the scene's width / height. */
  x: number;
  y: number;
  r: number;
}

export type TryItContent =
  | {
      type: 'try';
      mode: 'package';
      /** index.html of an animation package unpacked on the Pi; shown in a sandboxed iframe. */
      packageUrl: string;
    }
  | {
      type: 'try';
      mode: 'hotspots';
      instruction: string;
      scene: Picture;
      spots: TryItSpot[];
      goal: 'all' | 'any';
      finishMessage: string;
      /** Gentle movement, always off when the device asks for reduced motion. */
      gentleMovement: boolean;
    };

export interface CheckContent {
  type: 'check';
  questions: QuizQuestion[];
}

export type LessonContent = WatchContent | ListenContent | ReadContent | TryItContent | CheckContent;

export interface Lesson extends LessonSummary {
  portal: Pick<Portal, 'id' | 'title' | 'theme' | 'groupKind'>;
  group: Pick<Group, 'id' | 'title' | 'kind'>;
  series: Pick<SeriesSummary, 'id' | 'title' | 'lessonCount'>;
  /** The lesson after this one in the series (the quiz after the last lesson), or null. */
  next: LessonSummary | null;
  listenUrl: string | null;
  content: LessonContent;
}

/* ------------------------------------------------------------------ */
/* Save my progress (optional; name + who you are, no password)        */
/* ------------------------------------------------------------------ */

export type LearnerRole = 'learner' | 'teacher' | 'other';

export interface Learner {
  id: string;
  name: string;
  role: LearnerRole;
  /** Shown under the name in the list, e.g. "Learner · JSS 2" or "Farmer". */
  roleLabel: string;
}

export interface NewLearner {
  name: string;
  role: LearnerRole;
}

export interface LessonProgress {
  lessonId: string;
  seriesId: string;
  state: ProgressState;
  /** Where a video or audio stopped, in seconds. */
  positionSeconds: number | null;
  /** Check lessons and interactive videos. */
  correct: number | null;
  total: number | null;
  updatedAt: string;
}

export interface ProgressUpdate {
  state: ProgressState;
  positionSeconds?: number | null;
  correct?: number | null;
  total?: number | null;
}

/** Everything a learner has touched, plus the lesson to offer under "Continue where you stopped". */
export interface LearnerProgress {
  learnerId: string;
  lessons: LessonProgress[];
}

export interface ContinueLesson {
  lesson: LessonSummary;
  seriesTitle: string;
  /** "Lesson 2 of 12". */
  lessonCount: number;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export type PublishStatus = 'draft' | 'published';

export interface AdminSession {
  username: string;
  displayName: string;
}

export interface AdminCredentials {
  username: string;
  password: string;
}

/** Where a lesson sits. Null placement = "Waiting to be placed" (a draft on no portal yet). */
export interface Placement {
  portalId: PortalId;
  groupId: string;
  seriesId: string;
  /** 1-based. The lessons after it are renumbered by the server. */
  position: number;
}

/** Where the content came from: the four sources on ADM-M-Home plus questions. */
export type LessonSource = 'upload' | 'notes-photos' | 'typed' | 'animation' | 'questions';

export interface AdminLesson extends LessonSummary {
  status: PublishStatus;
  placement: Placement | null;
  /** "Child protection → Child → Staying safe", ready to display; null when unplaced. */
  placementLabel: string | null;
  source: LessonSource;
  /** Original file name(s), for search and for the draft list. */
  fileNames: string[];
  /** Check lessons and interactive videos. */
  questionCount: number | null;
  pictureId: string | null;
  updatedAt: string;
  /** Things the admin should know before publishing, e.g. "Read along text not added". */
  notes: string[];
}

export interface LibraryQuery {
  portalId?: PortalId;
  groupId?: string;
  seriesId?: string;
  type?: LessonType;
  status?: PublishStatus;
  /** true: only drafts that are not on a portal yet ("Waiting to be placed"). */
  unplaced?: boolean;
  /** Title, series or file name. */
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface LibraryPage {
  items: AdminLesson[];
  page: number;
  pageSize: number;
  total: number;
  publishedCount: number;
  draftCount: number;
}

export interface PortalCount {
  portalId: PortalId;
  title: string;
  description: string;
  lessonCount: number;
}

export interface StorageInfo {
  /** null until the Pi has measured it; show the "[used] of [total] GB" placeholder. */
  usedBytes: number | null;
  totalBytes: number | null;
  breakdown: { label: string; bytes: number | null }[];
}

export type UploadKind = 'video' | 'audio' | 'voice-note' | 'pdf' | 'word' | 'photo' | 'animation' | 'h5p' | 'unknown';

export interface PackageCheck {
  id: 'offline' | 'index' | 'size' | 'player';
  ok: boolean;
  title: string;
  detail: string;
}

export interface Upload {
  id: string;
  fileName: string;
  sizeBytes: number;
  kind: UploadKind;
  /** The automatic type rule. null when the file kind is not accepted. */
  becomes: LessonType | null;
  durationSeconds: number | null;
  pages: number | null;
  /**
   * Server-side work after the bytes arrive (voice note conversion, the
   * smaller video copy, PDF pages). Poll `GET /admin/uploads/{id}` while "working".
   */
  processing: { state: 'working' | 'ready' | 'failed'; note: string | null };
  /** Animation packages only. */
  checks: PackageCheck[];
}

export interface UploadOptions {
  /** Videos: also make a smaller copy for old phones. */
  smallerCopy?: boolean;
}

/** Create a draft lesson from what was added. Exactly one of the content fields is used per source. */
export interface NewLesson {
  source: LessonSource;
  title: string;
  /** source upload / animation: one upload id. source notes-photos: the photo upload ids, in page order. */
  uploadIds?: string[];
  /** source typed: the lesson text. */
  blocks?: ReadBlock[];
  /** source typed: optional recorded voice (an audio upload id) for Read along. */
  readAlongUploadId?: string;
}

export interface LessonPatch {
  title?: string;
  summary?: string;
  placement?: Placement | null;
  pictureId?: string | null;
  /** Override of the automatic type (the "Change" link). */
  type?: LessonType;
  interactive?: boolean;
  blocks?: ReadBlock[];
  /** Read along words for a Listen lesson. */
  transcript?: TranscriptLine[];
}

export type PictureGroup = 'child-protection' | 'agriculture' | 'climate' | 'school' | 'people-places' | 'own';

export interface GalleryPicture extends Picture {
  id: string;
  group: PictureGroup;
}

export interface PictureQuery {
  group?: PictureGroup;
  /** Returns the pictures matched to this lesson's title and portal first. */
  suggestForLessonId?: string;
  page?: number;
  pageSize?: number;
}

export interface PicturePage {
  suggested: GalleryPicture[];
  items: GalleryPicture[];
  page: number;
  pageSize: number;
  total: number;
}

export interface NewSeries {
  portalId: PortalId;
  groupId: string;
  title: string;
}

export interface SeriesOrder {
  /** Every lesson id of the series in the new order. The Check quiz is not included: it stays last. */
  lessonIds: string[];
}

export interface AdminSeries extends SeriesSummary {
  lessons: AdminLesson[];
}

/** Questions of an interactive video (with stop times) or of a Check quiz (without). */
export interface QuestionSet {
  lessonId: string;
  kind: 'video' | 'check';
  questions: (QuizQuestion & { atSeconds?: number; pauseUntilAnswered?: boolean })[];
}

/** Try it setup: an uploaded package, or a picture with tappable spots. */
export type TryItSetup =
  | { lessonId: string; mode: 'package'; uploadId: string | null; packageUrl: string | null; checks: PackageCheck[] }
  | {
      lessonId: string;
      mode: 'hotspots';
      instruction: string;
      scene: Picture | null;
      sceneUploadId?: string;
      spots: (Omit<TryItSpot, 'audioUrl'> & { audioUrl: string | null; audioUploadId?: string })[];
      goal: 'all' | 'any';
      finishMessage: string;
      gentleMovement: boolean;
    };

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Body of every non-2xx JSON response. */
export interface ApiErrorBody {
  error: {
    /** Machine code, e.g. "not_found", "validation", "unauthorised", "conflict". */
    code: string;
    /** Plain-English sentence that can be shown to the user. */
    message: string;
    /** Field name → problem, for form validation. */
    fields?: Record<string, string>;
  };
}
