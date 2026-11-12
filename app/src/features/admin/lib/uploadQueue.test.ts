import { ApiError, type Upload, type UploadHandle } from '@shared/api';
import { describe, expect, it, vi } from 'vitest';
import { summariseQueue, UploadQueue, type QueueItem } from './uploadQueue';

function uploadFor(item: QueueItem, working = false): Upload {
  return {
    id: `upload-${item.name}`,
    fileName: item.name,
    sizeBytes: item.sizeBytes,
    kind: item.info.kind,
    becomes: item.info.becomes,
    durationSeconds: null,
    pages: null,
    processing: working ? { state: 'working', note: 'Converting.' } : { state: 'ready', note: null },
    checks: [],
  };
}

interface Pending {
  item: QueueItem;
  onProgress: (sent: number, total: number) => void;
  resolve: (upload: Upload) => void;
  reject: (error: unknown) => void;
  aborted: boolean;
}

/** A sender whose uploads finish only when the test says so. */
function manualSender() {
  const pending: Pending[] = [];
  const send = (item: QueueItem, onProgress: (sent: number, total: number) => void): UploadHandle<Upload> => {
    let entry!: Pending;
    const promise = new Promise<Upload>((resolve, reject) => {
      entry = { item, onProgress, resolve, reject, aborted: false };
    });
    pending.push(entry);
    return {
      promise,
      abort: () => {
        entry.aborted = true;
        entry.reject(new ApiError('aborted', 'Cancelled.'));
      },
    };
  };
  return { send: vi.fn(send), pending };
}

const file = (name: string, size = 4) => ({ file: new File(['x'.repeat(size)], name), name });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const states = (queue: UploadQueue) => queue.getItems().map((item) => item.state);

describe('UploadQueue', () => {
  it('sends one file at a time, in order, and reports progress', async () => {
    const sender = manualSender();
    const queue = new UploadQueue({ send: sender.send });
    queue.add([file('a.mp4', 10), file('b.opus'), file('c.pdf')]);
    expect(states(queue)).toEqual(['waiting', 'waiting', 'waiting']);

    expect(queue.start()).toBe(true);
    expect(sender.pending).toHaveLength(1);
    expect(states(queue)).toEqual(['uploading', 'waiting', 'waiting']);

    sender.pending[0]!.onProgress(6, 10);
    expect(queue.getItems()[0]).toMatchObject({ sentBytes: 6, totalBytes: 10 });
    expect(summariseQueue(queue.getItems())).toMatchObject({ activeNumber: 1, done: 0, waiting: 2, allDone: false });

    sender.pending[0]!.resolve(uploadFor(sender.pending[0]!.item));
    await tick();
    expect(states(queue)).toEqual(['done', 'uploading', 'waiting']);
    sender.pending[1]!.resolve(uploadFor(sender.pending[1]!.item));
    await tick();
    sender.pending[2]!.resolve(uploadFor(sender.pending[2]!.item));
    await tick();
    expect(states(queue)).toEqual(['done', 'done', 'done']);
    expect(queue.isRunning).toBe(false);
    expect(summariseQueue(queue.getItems()).allDone).toBe(true);
    expect(sender.send).toHaveBeenCalledTimes(3);
  });

  it('ignores a second start while running, so a double tap cannot send a file twice', async () => {
    const sender = manualSender();
    const queue = new UploadQueue({ send: sender.send });
    queue.add([file('a.mp4')]);
    expect(queue.start()).toBe(true);
    expect(queue.start()).toBe(false);
    expect(queue.start()).toBe(false);
    expect(sender.send).toHaveBeenCalledTimes(1);
    sender.pending[0]!.resolve(uploadFor(sender.pending[0]!.item));
    await tick();
    // Starting again when everything is done sends nothing.
    queue.start();
    await tick();
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it('keeps going after a failure and retries only what failed', async () => {
    const sender = manualSender();
    const queue = new UploadQueue({ send: sender.send });
    queue.add([file('a.mp4'), file('b.mp4')]);
    queue.start();
    sender.pending[0]!.reject(new ApiError('network', 'Could not reach the bag.'));
    await tick();
    expect(states(queue)).toEqual(['failed', 'uploading']);
    expect(queue.getItems()[0]).toMatchObject({ retryable: true, error: expect.stringContaining('cannot reach the bag') });
    sender.pending[1]!.resolve(uploadFor(sender.pending[1]!.item));
    await tick();
    expect(states(queue)).toEqual(['failed', 'done']);
    expect(queue.isRunning).toBe(false);

    // "Try again": only the failed file goes out again.
    queue.start();
    expect(sender.send).toHaveBeenCalledTimes(3);
    expect(sender.pending[2]!.item.name).toBe('a.mp4');
    sender.pending[2]!.resolve(uploadFor(sender.pending[2]!.item));
    await tick();
    expect(states(queue)).toEqual(['done', 'done']);
  });

  it('does not retry a file the bag refused', async () => {
    const sender = manualSender();
    const queue = new UploadQueue({ send: sender.send });
    queue.add([file('a.mp4')]);
    queue.start();
    sender.pending[0]!.reject(new ApiError('http', 'This kind of file cannot be added.', 415, 'unsupported_file'));
    await tick();
    expect(queue.getItems()[0]).toMatchObject({ state: 'failed', retryable: false, error: 'This kind of file cannot be added.' });
    queue.start();
    await tick();
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it('stops on request, keeps finished files, and can carry on', async () => {
    const sender = manualSender();
    const queue = new UploadQueue({ send: sender.send });
    queue.add([file('a.mp4'), file('b.mp4')]);
    queue.start();
    sender.pending[0]!.resolve(uploadFor(sender.pending[0]!.item));
    await tick();
    queue.stop();
    await tick();
    expect(sender.pending[1]!.aborted).toBe(true);
    expect(states(queue)).toEqual(['done', 'waiting']);
    expect(queue.isRunning).toBe(false);

    queue.start();
    await tick();
    expect(sender.send).toHaveBeenCalledTimes(3);
    sender.pending[2]!.resolve(uploadFor(sender.pending[2]!.item));
    await tick();
    expect(states(queue)).toEqual(['done', 'done']);
  });

  it('never runs two uploads at once when stop is followed at once by start', async () => {
    const sender = manualSender();
    const queue = new UploadQueue({ send: sender.send });
    queue.add([file('a.mp4'), file('b.mp4')]);
    queue.start();
    queue.stop();
    queue.start();
    await tick();
    await tick();
    const inFlight = sender.pending.filter((entry) => !entry.aborted);
    expect(inFlight).toHaveLength(1);
    expect(states(queue).filter((state) => state === 'uploading')).toHaveLength(1);
  });

  it('cancels the upload in flight when its file is removed', async () => {
    const sender = manualSender();
    const queue = new UploadQueue({ send: sender.send });
    const [first] = queue.add([file('a.mp4'), file('b.mp4')]);
    queue.start();
    queue.remove(first as string);
    await tick();
    expect(sender.pending[0]!.aborted).toBe(true);
    expect(queue.getItems().map((item) => item.name)).toEqual(['b.mp4']);
    expect(states(queue)).toEqual(['uploading']);
  });

  it('makes the draft after the upload and repeats that step with the same key, without sending the file again', async () => {
    const sender = manualSender();
    const keys: string[] = [];
    let fail = true;
    const afterUpload = vi.fn(async (item: QueueItem) => {
      keys.push(item.requestKey);
      if (fail) {
        fail = false;
        throw new ApiError('timeout', 'The bag took too long to answer.');
      }
      return 'lesson-1';
    });
    const queue = new UploadQueue({ send: sender.send, afterUpload });
    queue.add([file('a.mp4')]);
    queue.start();
    sender.pending[0]!.resolve(uploadFor(sender.pending[0]!.item));
    await tick();
    expect(queue.getItems()[0]).toMatchObject({ state: 'failed', retryable: true });
    expect(queue.getItems()[0]!.upload).not.toBeNull();

    queue.start();
    await tick();
    expect(queue.getItems()[0]).toMatchObject({ state: 'done', resultId: 'lesson-1' });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(afterUpload).toHaveBeenCalledTimes(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('reports an ended session once', async () => {
    const sender = manualSender();
    const onUnauthorised = vi.fn();
    const queue = new UploadQueue({ send: sender.send, onUnauthorised });
    queue.add([file('a.mp4')]);
    queue.start();
    sender.pending[0]!.reject(new ApiError('http', 'Sign in to use the admin.', 401, 'unauthorised'));
    await tick();
    expect(onUnauthorised).toHaveBeenCalledTimes(1);
    expect(queue.getItems()[0]).toMatchObject({ state: 'failed', retryable: true });
  });

  it('follows the work the bag does afterwards, and stops asking when the screen goes away', async () => {
    vi.useFakeTimers();
    try {
      const sender = manualSender();
      const poll = vi.fn(async (id: string): Promise<Upload> => ({ ...uploadFor(queue.getItems()[0]!), id, processing: { state: 'ready', note: 'Converted.' } }));
      const queue = new UploadQueue({ send: sender.send, poll, pollIntervalMs: 3000 });
      queue.add([file('voice.opus')]);
      queue.start();
      sender.pending[0]!.resolve(uploadFor(sender.pending[0]!.item, true));
      await vi.advanceTimersByTimeAsync(0);
      // The file counts as done at once; the conversion is followed in the background.
      expect(queue.getItems()[0]).toMatchObject({ state: 'done' });
      expect(queue.getItems()[0]!.upload!.processing.state).toBe('working');
      expect(poll).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3000);
      expect(poll).toHaveBeenCalledTimes(1);
      expect(queue.getItems()[0]!.upload!.processing).toEqual({ state: 'ready', note: 'Converted.' });
      await vi.advanceTimersByTimeAsync(10000);
      expect(poll).toHaveBeenCalledTimes(1);

      const other = new UploadQueue({ send: sender.send, poll, pollIntervalMs: 3000 });
      other.add([file('voice2.opus')]);
      other.start();
      sender.pending[1]!.resolve(uploadFor(sender.pending[1]!.item, true));
      await vi.advanceTimersByTimeAsync(0);
      other.dispose();
      await vi.advanceTimersByTimeAsync(10000);
      expect(poll).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves pages and gives subscribers a new list each time', () => {
    const queue = new UploadQueue({ send: manualSender().send });
    const [a, , c] = queue.add([file('1.jpg'), file('2.jpg'), file('3.jpg')]);
    const seen = vi.fn();
    queue.subscribe(seen);
    const before = queue.getItems();
    queue.move(c as string, -1);
    expect(queue.getItems().map((item) => item.name)).toEqual(['1.jpg', '3.jpg', '2.jpg']);
    expect(queue.getItems()).not.toBe(before);
    queue.move(a as string, -1);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
