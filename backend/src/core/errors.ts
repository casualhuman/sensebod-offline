/* The error model: every failure leaves the API as `ApiErrorBody` with a plain sentence that may be shown as it is. */

export interface ApiErrorOptions {
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.details = options.details;
    this.headers = options.headers;
  }

  body(): { error: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, unknown> } } {
    const error: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, unknown> } = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    if (this.details) error.details = this.details;
    return { error };
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} is not in this bag.`);
export const invalid = (message: string, fields?: Record<string, string>) => new ApiError(422, 'validation', message, fields ? { fields } : {});
export const conflict = (code: string, message: string, details?: Record<string, unknown>) => new ApiError(409, code, message, details ? { details } : {});
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const unauthorised = (message = 'Sign in to use the admin.') => new ApiError(401, 'unauthorised', message);
export const rateLimited = (retryAfterSeconds: number, message = 'Too many tries. Wait a little, then try again.', details?: Record<string, unknown>) =>
  new ApiError(429, 'rate_limited', message, { headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) }, ...(details ? { details } : {}) });
export const busy = () => new ApiError(503, 'busy', 'The bag is busy. Try again in a moment.', { headers: { 'Retry-After': '2' } });
export const maintenance = () => new ApiError(503, 'maintenance', 'The bag is being looked after. Please try again later.', { headers: { 'Retry-After': '30' } });
export const storageFull = (neededBytes: number, availableBytes: number) =>
  new ApiError(507, 'storage_full', 'There is not enough space left on the bag.', { details: { neededBytes, availableBytes } });
export const tooLarge = (message = 'This file is too large.') => new ApiError(413, 'too_large', message);
export const unsupportedFile = (message = 'This kind of file cannot be added. Use video, audio, PDF, Word (.docx), photos or an animation package.') =>
  new ApiError(415, 'unsupported_file', message);

/** Narrow an unknown JSON value to an object, or answer 422. */
export function asObject(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  throw invalid('The request had no readable content.');
}
