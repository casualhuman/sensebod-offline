/*
 * Admin API calls (ADM-* boards). One function per endpoint in
 * docs/API-CONTRACT.md. The session is an HttpOnly cookie set by the Pi;
 * the client never sees or stores a token.
 */
import { api, newRequestKey, uploadFile, type RequestOptions, type UploadHandle } from './client';
import type {
  AdminCredentials,
  AdminLesson,
  AdminSeries,
  AdminSession,
  GalleryPicture,
  LessonPatch,
  LibraryPage,
  LibraryQuery,
  NewLesson,
  NewSeries,
  PicturePage,
  PictureQuery,
  PortalCount,
  QuestionSet,
  SeriesOrder,
  StorageInfo,
  TryItSetup,
  Upload,
  UploadOptions,
} from './types';

const enc = encodeURIComponent;

/* ---- session ---- */
export function signIn(credentials: AdminCredentials, options?: RequestOptions): Promise<AdminSession> {
  return api.post('/admin/session', credentials, options);
}
/** Resolves with the signed-in admin, or rejects with status 401. */
export function getSession(options?: RequestOptions): Promise<AdminSession> {
  return api.get('/admin/session', undefined, options);
}
export function signOut(options?: RequestOptions): Promise<void> {
  return api.delete('/admin/session', options);
}

/* ---- library ---- */
export function getLibrary(query?: LibraryQuery, options?: RequestOptions): Promise<LibraryPage> {
  return api.get('/admin/lessons', query as Record<string, string | number | boolean | undefined>, options);
}
export function getPortalCounts(options?: RequestOptions): Promise<PortalCount[]> {
  return api.get('/admin/portals', undefined, options);
}
export function getStorage(options?: RequestOptions): Promise<StorageInfo> {
  return api.get('/admin/storage', undefined, options);
}
export function getAdminLesson(lessonId: string, options?: RequestOptions): Promise<AdminLesson> {
  return api.get(`/admin/lessons/${enc(lessonId)}`, undefined, options);
}

/* ---- upload ---- */
/** Uploads one file. Call once per chosen file; show `onProgress` as "21 of 34 MB sent". */
export function uploadContent(
  file: File,
  uploadOptions?: UploadOptions,
  onProgress?: (sentBytes: number, totalBytes: number) => void,
): UploadHandle<Upload> {
  return uploadFile<Upload>('/admin/uploads', file, file.name, { smallerCopy: uploadOptions?.smallerCopy }, onProgress);
}
/** Poll while `processing.state` is "working" (every few seconds, not faster). */
export function getUpload(uploadId: string, options?: RequestOptions): Promise<Upload> {
  return api.get(`/admin/uploads/${enc(uploadId)}`, undefined, options);
}
/** "Remove" on a chosen file that was already sent. */
export function deleteUpload(uploadId: string, options?: RequestOptions): Promise<void> {
  return api.delete(`/admin/uploads/${enc(uploadId)}`, options);
}

/* ---- lessons: create, place, picture, publish ---- */
/** Creates a draft that is "Waiting to be placed". */
export function createLesson(input: NewLesson, options?: RequestOptions): Promise<AdminLesson> {
  return api.post('/admin/lessons', input, { idempotencyKey: newRequestKey(), ...options });
}
/** Title, placement ("Where does it go?"), picture choice, type override, text. */
export function updateLesson(lessonId: string, patch: LessonPatch, options?: RequestOptions): Promise<AdminLesson> {
  return api.patch(`/admin/lessons/${enc(lessonId)}`, patch, options);
}
export function publishLesson(lessonId: string, options?: RequestOptions): Promise<AdminLesson> {
  return api.post(`/admin/lessons/${enc(lessonId)}/publish`, undefined, options);
}
/** Back to draft: learners stop seeing it, it keeps its place. */
export function unpublishLesson(lessonId: string, options?: RequestOptions): Promise<AdminLesson> {
  return api.post(`/admin/lessons/${enc(lessonId)}/unpublish`, undefined, options);
}
export function deleteLesson(lessonId: string, options?: RequestOptions): Promise<void> {
  return api.delete(`/admin/lessons/${enc(lessonId)}`, options);
}

/* ---- pictures ---- */
export function getPictures(query?: PictureQuery, options?: RequestOptions): Promise<PicturePage> {
  return api.get('/admin/pictures', query as Record<string, string | number | undefined>, options);
}
/** "Take or upload your own photo": added to the gallery for next time. */
export function uploadPicture(file: File, alt: string, onProgress?: (sent: number, total: number) => void): UploadHandle<GalleryPicture> {
  return uploadFile<GalleryPicture>('/admin/pictures', file, file.name, { alt }, onProgress);
}

/* ---- series and order ---- */
export function getAdminSeries(seriesId: string, options?: RequestOptions): Promise<AdminSeries> {
  return api.get(`/admin/series/${enc(seriesId)}`, undefined, options);
}
/** "Start a new series". */
export function createSeries(input: NewSeries, options?: RequestOptions): Promise<AdminSeries> {
  return api.post('/admin/series', input, { idempotencyKey: newRequestKey(), ...options });
}
/** "Save order". Send every lesson id; the quiz stays last. */
export function saveSeriesOrder(seriesId: string, order: SeriesOrder, options?: RequestOptions): Promise<AdminSeries> {
  return api.put(`/admin/series/${enc(seriesId)}/order`, order, options);
}

/* ---- questions and Try it ---- */
export function getQuestions(lessonId: string, options?: RequestOptions): Promise<QuestionSet> {
  return api.get(`/admin/lessons/${enc(lessonId)}/questions`, undefined, options);
}
/** Replaces the whole set (add, edit, delete and reorder are all one save). */
export function saveQuestions(lessonId: string, set: QuestionSet, options?: RequestOptions): Promise<QuestionSet> {
  return api.put(`/admin/lessons/${enc(lessonId)}/questions`, set, options);
}
export function getTryItSetup(lessonId: string, options?: RequestOptions): Promise<TryItSetup> {
  return api.get(`/admin/lessons/${enc(lessonId)}/try-it`, undefined, options);
}
export function saveTryItSetup(lessonId: string, setup: TryItSetup, options?: RequestOptions): Promise<TryItSetup> {
  return api.put(`/admin/lessons/${enc(lessonId)}/try-it`, setup, options);
}
