/*
 * Sends chosen files to the bag one at a time and keeps what the screen
 * needs to show: progress, waiting, failed, done.
 *
 * Rules it enforces (ENGINEER-INSTRUCTIONS section 13, and the Pi's limits):
 *  - one upload at a time: twenty phones share one Pi and one Wi-Fi radio
 *  - a file is handed to XMLHttpRequest as it is (a File is a reference to
 *    the phone's storage), so a 34 MB video is streamed, never read into
 *    JavaScript memory
 *  - `start()` while already running does nothing, so a double tap can never
 *    send a file twice
 *  - a finished file is never sent again: "Try again" continues with the
 *    files that are left
 *  - the follow-up step (making the draft lesson) keeps one request key per
 *    file, so repeating it after a dropped answer cannot create two lessons
 *  - nothing retries by itself
 *
 * Plain class, no React: the screens subscribe with `useUploadQueue`.
 */
import { ApiError, describeError, newRequestKey, type Upload, type UploadHandle } from '@shared/api';
import { classifyFileName, type FileKindInfo } from './files';

export type QueueItemState = 'waiting' | 'uploading' | 'saving' | 'done' | 'failed';

export interface QueueItem {
  key: string;
  /** A File from an input, or a Blob made from one (a rotated photo). */
  file: Blob;
  name: string;
  sizeBytes: number;
  info: FileKindInfo;
  state: QueueItemState;
  sentBytes: number;
  totalBytes: number;
  /** Set once the bytes are on the bag. */
  upload: Upload | null;
  /** What `afterUpload` produced (the draft lesson id), if it ran. */
  resultId: string | null;
  /** Plain sentence for the row, when failed. */
  error: string | null;
  /** False when trying again cannot help (file kind refused). */
  retryable: boolean;
  /** Sent as Idempotency-Key by `afterUpload`; stays the same across retries. */
  requestKey: string;
}

export interface UploadQueueOptions {
  /** Starts the upload of one item. Usually `adminApi.uploadContent`. */
  send: (item: QueueItem, onProgress: (sent: number, total: number) => void) => UploadHandle<Upload>;
  /** Runs after the bytes arrived, before the item counts as done (create the draft). Resolves with an id. */
  afterUpload?: (item: QueueItem, upload: Upload) => Promise<string | null>;
  /** Asks the bag how the server-side work on an upload is going. */
  poll?: (uploadId: string) => Promise<Upload>;
  /** Milliseconds between polls. The contract says "every few seconds, not faster". */
  pollIntervalMs?: number;
  /** Stop asking after this many polls; the work goes on in the bag regardless. */
  maxPolls?: number;
  /** A call answered 401: the session ended. */
  onUnauthorised?: () => void;
}

export interface NewQueueFile {
  file: Blob;
  name: string;
}

let nextKey = 0;

export class UploadQueue {
  private items: QueueItem[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly options: UploadQueueOptions;
  private current: { key: string; abort: () => void } | null = null;
  private running = false;
  /** Increases with every start(), so a pump left over from before a stop can never run beside a new one. */
  private runId = 0;
  /** Increases when the screen goes away, so answers that arrive later are dropped. */
  private epoch = 0;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: UploadQueueOptions) {
    this.options = options;
  }

  /* ---- reading ---- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** A new array whenever anything changed (safe for useSyncExternalStore). */
  getItems = (): readonly QueueItem[] => this.items;

  get isRunning(): boolean {
    return this.running;
  }

  /* ---- changing the list ---- */

  add(files: readonly NewQueueFile[]): string[] {
    const added: QueueItem[] = files.map(({ file, name }) => {
      nextKey += 1;
      return {
        key: `file-${nextKey}`,
        file,
        name,
        sizeBytes: file.size,
        info: classifyFileName(name),
        state: 'waiting',
        sentBytes: 0,
        totalBytes: file.size,
        upload: null,
        resultId: null,
        error: null,
        retryable: true,
        requestKey: newRequestKey(),
      };
    });
    if (added.length > 0) this.commit(this.items.concat(added));
    return added.map((item) => item.key);
  }

  /** Takes a file off the list. An upload in flight is cancelled first. Returns the removed item. */
  remove(key: string): QueueItem | null {
    const item = this.find(key);
    if (!item) return null;
    if (this.current && this.current.key === key) this.current.abort();
    this.clearTimer(key);
    this.commit(this.items.filter((other) => other.key !== key));
    return item;
  }

  /** Moves an item one place earlier (-1) or later (+1). Order matters for photo pages. */
  move(key: string, delta: -1 | 1): void {
    const index = this.items.findIndex((item) => item.key === key);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= this.items.length) return;
    const next = this.items.slice();
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    this.commit(next);
  }

  /** Replaces the bytes of a file that has not been sent yet (a rotated photo). */
  replaceFile(key: string, file: Blob): void {
    this.patch(key, (item) => (item.upload ? item : { ...item, file, sizeBytes: file.size, totalBytes: file.size }));
  }

  /* ---- running ---- */

  /**
   * Starts sending everything that is waiting or failed. Returns false, and
   * does nothing, when the queue is already running.
   */
  start(): boolean {
    if (this.running) return false;
    this.items = this.items.map((item) => (item.state === 'failed' && item.retryable ? { ...item, state: 'waiting', error: null } : item));
    this.running = true;
    this.runId += 1;
    this.emit();
    void this.pump(this.runId);
    return true;
  }

  /** "Stop uploading": cancels the file in flight. Finished files stay finished. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.current) this.current.abort();
    this.touch();
  }

  /**
   * Call when the screen goes away. Cancels the upload in flight and every
   * timer. The queue stays usable (React may mount an effect twice in
   * development), it just stops doing anything by itself.
   */
  dispose(): void {
    this.epoch += 1;
    this.running = false;
    if (this.current) this.current.abort();
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }

  /* ---- internals ---- */

  private async pump(runId: number): Promise<void> {
    const mine = () => this.running && this.runId === runId;
    while (mine()) {
      const item = this.items.find((candidate) => candidate.state === 'waiting');
      if (!item) break;
      await this.process(item.key);
    }
    if (mine()) {
      this.running = false;
      this.touch();
    }
  }

  private async process(key: string): Promise<void> {
    let item = this.find(key);
    if (!item) return;
    try {
      let upload = item.upload;
      if (!upload) {
        this.patch(key, (it) => ({ ...it, state: 'uploading', sentBytes: 0, error: null }));
        item = this.find(key) ?? item;
        const handle = this.options.send(item, (sent, total) => {
          this.patch(key, (it) => (it.state === 'uploading' ? { ...it, sentBytes: sent, totalBytes: total > 0 ? total : it.totalBytes } : it));
        });
        this.current = { key, abort: handle.abort };
        try {
          upload = await handle.promise;
        } finally {
          if (this.current && this.current.key === key) this.current = null;
        }
        const arrived = upload;
        this.patch(key, (it) => ({ ...it, upload: arrived, sentBytes: it.totalBytes }));
        this.watch(key, arrived);
      }
      let resultId: string | null = null;
      if (this.options.afterUpload) {
        this.patch(key, (it) => ({ ...it, state: 'saving' }));
        resultId = await this.options.afterUpload(this.find(key) ?? item, upload);
      }
      this.patch(key, (it) => ({ ...it, state: 'done', resultId, error: null }));
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'aborted') {
        // Stopped or removed by the person: back to waiting, nothing to report.
        this.patch(key, (it) => ({ ...it, state: 'waiting', sentBytes: 0, error: null }));
        return;
      }
      if (error instanceof ApiError && error.status === 401 && this.options.onUnauthorised) this.options.onUnauthorised();
      const retryable = !(error instanceof ApiError) || error.retryable || error.status === 401 || error.status === 409;
      this.patch(key, (it) => ({ ...it, state: 'failed', sentBytes: 0, error: describeError(error), retryable }));
    }
  }

  /** Follows the bag's work on an upload (conversion, smaller copy, pages) without holding up the queue. */
  private watch(key: string, upload: Upload, polls = 0): void {
    const { poll } = this.options;
    if (!poll || upload.processing.state !== 'working') return;
    if (polls >= (this.options.maxPolls ?? 60)) return;
    const epoch = this.epoch;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      poll(upload.id).then(
        (latest) => {
          if (this.epoch !== epoch || !this.find(key)) return;
          this.patch(key, (it) => ({ ...it, upload: latest }));
          this.watch(key, latest, polls + 1);
        },
        (error: unknown) => {
          if (error instanceof ApiError && error.status === 401 && this.options.onUnauthorised) this.options.onUnauthorised();
          // Leave the last known state on screen; the bag carries on by itself.
        },
      );
    }, this.options.pollIntervalMs ?? 3000);
    this.timers.set(key, timer);
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  private find(key: string): QueueItem | undefined {
    return this.items.find((item) => item.key === key);
  }

  private patch(key: string, change: (item: QueueItem) => QueueItem): void {
    let changed = false;
    const next = this.items.map((item) => {
      if (item.key !== key) return item;
      const updated = change(item);
      if (updated !== item) changed = true;
      return updated;
    });
    if (changed) this.commit(next);
  }

  private commit(items: QueueItem[]): void {
    this.items = items;
    this.emit();
  }

  /** `running` changed: hand subscribers a new snapshot so they render again. */
  private touch(): void {
    this.commit(this.items.slice());
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export interface QueueSummary {
  total: number;
  done: number;
  failed: number;
  waiting: number;
  /** 1-based number of the file being sent, or 0. */
  activeNumber: number;
  active: QueueItem | null;
  allDone: boolean;
  totalBytes: number;
}

export function summariseQueue(items: readonly QueueItem[]): QueueSummary {
  let done = 0;
  let failed = 0;
  let waiting = 0;
  let totalBytes = 0;
  let active: QueueItem | null = null;
  let activeNumber = 0;
  items.forEach((item, index) => {
    totalBytes += item.sizeBytes;
    if (item.state === 'done') done += 1;
    else if (item.state === 'failed') failed += 1;
    else if (item.state === 'waiting') waiting += 1;
    else if (!active) {
      active = item;
      activeNumber = index + 1;
    }
  });
  return { total: items.length, done, failed, waiting, activeNumber, active, allDone: items.length > 0 && done === items.length, totalBytes };
}
