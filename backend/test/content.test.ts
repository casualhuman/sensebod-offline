/* BE-5, BE-6: catalog (placement and renumbering property test DB-4, publish rules, questions), learners, anonymous Child protection counts (SEC-10), retention rules. */
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { buildConfig } from '../src/config.ts';
import { judge, planRetention, type Jump, type LearnerAge } from '../src/learners/retention.ts';
import { runRetention } from '../src/system/maint.ts';
import { ADMIN, Client, HUB, makeBag, signedIn, type Bag } from './harness.ts';

const SERIES = 'primary-class-1-english-language';
const PLACE = { portalId: 'primary', groupId: 'primary-class-1', seriesId: SERIES };
const CP_SERIES = 'cp-child-staying-safe';
const CP_LESSON = 'cp-child-staying-safe-1';

describe('catalog', () => {
  let bag: Bag;
  let admin: Client;
  let anon: Client;
  before(async () => {
    bag = await makeBag();
    admin = await signedIn(bag, ADMIN);
    anon = new Client(bag, '10.10.0.99');
  });
  after(() => bag.close());

  const draft = async (title: string): Promise<string> => {
    const r = await admin.post('/admin/lessons', { source: 'typed', title, blocks: [{ kind: 'paragraph', text: 'Words.' }] }, admin.key());
    assert.equal(r.status, 201, r.text);
    return r.body.id as string;
  };
  const numbered = (series: string): { id: string; position: number }[] => bag.ctx.db.all('SELECT id, position FROM lesson WHERE series_id = ? AND position IS NOT NULL ORDER BY position', series);
  const assertDense = (series: string): void => {
    const rows = numbered(series);
    assert.deepEqual(rows.map((r) => r.position), rows.map((_, i) => i + 1), `positions of ${series} are exactly 1..n`);
  };

  test('learner answers hold only published, placed lessons, with the quiz last', async () => {
    const series = await anon.get(`/series/${CP_SERIES}`);
    assert.equal(series.status, 200);
    const lessons = series.body.lessons as { position: number | null; type: string }[];
    assert.equal(lessons.at(-1)?.type, 'check');
    assert.equal(lessons.at(-1)?.position, null);
    assert.deepEqual(lessons.slice(0, -1).map((l) => l.position), lessons.slice(0, -1).map((_, i) => i + 1));
    assert.equal(series.body.lessonCount, lessons.length - 1);
    assert.equal(series.body.hasQuiz, true);
    const id = await draft('A hidden draft');
    assert.equal((await anon.get(`/lessons/${id}`)).status, 404);
    const lesson = await anon.get(`/lessons/${CP_LESSON}`);
    assert.equal(lesson.body.content.type, 'watch');
    assert.ok(Array.isArray(lesson.body.content.questions));
    assert.equal(lesson.body.next.position, 2);
    assert.ok(!('uploadIds' in lesson.body.content));
  });

  test('renumbering property (DB-4): after any mix of inserts, moves, removals, reorders and deletes, positions are 1..n', async () => {
    let seed = 20261113;
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const other = 'primary-class-1-mathematics';
    const mine: string[] = [];
    for (let step = 0; step < 60; step += 1) {
      const action = random(5);
      if (action === 0 || mine.length < 3) {
        const id = await draft(`Property ${step}`);
        mine.push(id);
        const r = await admin.patch(`/admin/lessons/${id}`, { placement: { ...PLACE, position: 1 + random(8) } });
        assert.equal(r.status, 200, r.text);
        assert.equal(r.body.placement.seriesId, SERIES);
      } else if (action === 1) {
        // move to the other series, or back
        const id = mine[random(mine.length)] as string;
        const target = random(2) === 0 ? { ...PLACE, position: 1 + random(8) } : { portalId: 'primary', groupId: 'primary-class-1', seriesId: other, position: 1 + random(4) };
        assert.equal((await admin.patch(`/admin/lessons/${id}`, { placement: target })).status, 200);
      } else if (action === 2) {
        const id = mine[random(mine.length)] as string;
        assert.equal((await admin.patch(`/admin/lessons/${id}`, { placement: null })).status, 200);
      } else if (action === 3) {
        const ids = numbered(SERIES).map((r) => r.id);
        for (let i = ids.length - 1; i > 0; i -= 1) {
          const j = random(i + 1);
          [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
        }
        const r = await admin.put(`/admin/series/${SERIES}/order`, { lessonIds: ids });
        assert.equal(r.status, 200, r.text);
        assert.deepEqual(numbered(SERIES).map((x) => x.id), ids);
      } else {
        const at = random(mine.length);
        assert.equal((await admin.delete(`/admin/lessons/${mine[at] as string}`)).status, 204);
        mine.splice(at, 1);
      }
      assertDense(SERIES);
      assertDense(other);
    }
    assert.equal(Number(bag.ctx.db.value("SELECT count(*) FROM lesson WHERE series_id IS NULL AND (position IS NOT NULL OR status = 'published')")), 0);
  });

  test('a stale order is refused and changes nothing; deleting twice is not an error', async () => {
    const before = numbered(SERIES);
    const ids = before.map((r) => r.id);
    const stale = await admin.put(`/admin/series/${SERIES}/order`, { lessonIds: ids.slice(1) });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'conflict');
    assert.equal((await admin.put(`/admin/series/${SERIES}/order`, { lessonIds: [...ids.slice(1), ids[1]] })).status, 409, 'a repeated id is not the same set');
    assert.deepEqual(numbered(SERIES), before);
    const id = await draft('Twice');
    assert.equal((await admin.delete(`/admin/lessons/${id}`)).status, 204);
    assert.equal((await admin.delete(`/admin/lessons/${id}`)).status, 204);
    assert.ok(bag.ctx.db.get("SELECT 1 FROM tombstone WHERE entity = 'lesson' AND entity_id = ?", id));
  });

  test('publish rules: placed first, something to open, idempotent; unpublish keeps the place', async () => {
    const id = await draft('To publish');
    const unplaced = await admin.post(`/admin/lessons/${id}/publish`);
    assert.equal(unplaced.status, 409);
    assert.equal(unplaced.body.error.code, 'not_placed');
    await admin.patch(`/admin/lessons/${id}`, { placement: { ...PLACE, position: 1 } });
    const published = await admin.post(`/admin/lessons/${id}/publish`);
    assert.equal(published.body.status, 'published');
    assert.equal((await admin.post(`/admin/lessons/${id}/publish`)).status, 200);
    assert.equal((await anon.get(`/lessons/${id}`)).status, 200);
    const back = await admin.post(`/admin/lessons/${id}/unpublish`);
    assert.equal(back.body.status, 'draft');
    assert.equal(back.body.placement.position, 1);
    assert.equal((await anon.get(`/lessons/${id}`)).status, 404);
    // A quiz without questions has nothing to open.
    const quiz = await admin.post('/admin/lessons', { source: 'questions', title: 'Quiz' }, admin.key());
    await admin.patch(`/admin/lessons/${quiz.body.id}`, { placement: { portalId: 'primary', groupId: 'primary-class-1', seriesId: 'primary-class-1-mathematics', position: 1 } });
    const empty = await admin.post(`/admin/lessons/${quiz.body.id}/publish`);
    assert.equal(empty.status, 409);
    // The series already has its quiz: the index "one quiz per series" is answered as a conflict, not a crash.
    const second = await admin.post('/admin/lessons', { source: 'questions', title: 'Second quiz' }, admin.key());
    const clash = await admin.patch(`/admin/lessons/${second.body.id}`, { placement: { portalId: 'child-protection', groupId: 'cp-child', seriesId: CP_SERIES, position: 1 } });
    assert.equal(clash.status, 409);
  });

  test('If-Match protects against a second editor; the version rises with every change', async () => {
    const id = await draft('Versioned');
    const first = await admin.get(`/admin/lessons/${id}`);
    assert.equal(first.headers.get('etag'), '"v1"');
    assert.equal((await admin.patch(`/admin/lessons/${id}`, { title: 'Changed' }, { 'If-Match': '"v1"' })).body.version, 2);
    const late = await admin.patch(`/admin/lessons/${id}`, { title: 'Too late' }, { 'If-Match': '"v1"' });
    assert.equal(late.status, 412);
    assert.equal((await admin.get(`/admin/lessons/${id}`)).body.title, 'Changed');
    assert.equal((await admin.patch(`/admin/lessons/${id}`, { title: '   ' })).status, 422);
    assert.equal((await admin.patch(`/admin/lessons/${id}`, { pictureId: 'no-such-picture' })).status, 422);
  });

  test('questions: whole set, one correct answer each, video questions sorted, wrong types refused', async () => {
    const quiz = (await admin.post('/admin/lessons', { source: 'questions', title: 'Check' }, admin.key())).body.id as string;
    const q = (prompt: string, correct: number, extra: object = {}) => ({ prompt, answers: [0, 1, 2].map((i) => ({ text: `Answer ${i}`, correct: i === correct, feedback: '' })), ...extra });
    assert.equal((await admin.put(`/admin/lessons/${quiz}/questions`, { questions: [q('', 0)] })).status, 422);
    assert.equal((await admin.put(`/admin/lessons/${quiz}/questions`, { questions: [{ prompt: 'One answer', answers: [{ text: 'a', correct: true }] }] })).status, 422);
    assert.equal((await admin.put(`/admin/lessons/${quiz}/questions`, { questions: [q('Two correct', 0, { answers: [{ text: 'a', correct: true }, { text: 'b', correct: true }] })] })).status, 422);
    const saved = await admin.put(`/admin/lessons/${quiz}/questions`, { questions: [q('First?', 1), q('Second?', 2)] });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.kind, 'check');
    assert.equal((await admin.get(`/admin/lessons/${quiz}`)).body.questionCount, 2);
    const read = await draft('Read only');
    assert.equal((await admin.get(`/admin/lessons/${read}/questions`)).body.error.code, 'wrong_type');
    const video = 'primary-class-1-english-language-1';
    const sorted = await admin.put(`/admin/lessons/${video}/questions`, { questions: [q('Late', 0, { atSeconds: 90 }), q('Early', 0, { atSeconds: 5 })] });
    assert.deepEqual(sorted.body.questions.map((x: { prompt: string }) => x.prompt), ['Early', 'Late']);
    assert.equal((await admin.get(`/admin/lessons/${video}`)).body.interactive, true);
    await admin.put(`/admin/lessons/${video}/questions`, { questions: [] });
    assert.equal((await admin.get(`/admin/lessons/${video}`)).body.interactive, false);
  });

  test('lessons from a content pack: only their place and picture may change (409 pack_owned)', async () => {
    const id = await draft('From a pack');
    bag.ctx.writeSync((tx) => tx.run("UPDATE lesson SET source = 'content-pack' WHERE id = ?", id));
    const refused = await admin.patch(`/admin/lessons/${id}`, { title: 'Mine now' });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'pack_owned');
    assert.equal((await admin.patch(`/admin/lessons/${id}`, { placement: { ...PLACE, position: 1 } })).status, 200);
  });

  test('placing a lesson into Child protection removes saved progress on it, with tombstones (V-014c)', async () => {
    const id = await draft('Will move');
    await admin.patch(`/admin/lessons/${id}`, { placement: { ...PLACE, position: 1 } });
    await admin.post(`/admin/lessons/${id}/publish`);
    const learner = (await anon.post('/learners', { name: 'Isatu', role: 'learner', pin: '1234' }, anon.key())).body.id as string;
    assert.equal((await anon.put(`/learners/${learner}/progress/${id}`, { state: 'started' })).status, 200);
    const moved = await admin.patch(`/admin/lessons/${id}`, { placement: { portalId: 'child-protection', groupId: 'cp-child', seriesId: CP_SERIES, position: 1 } });
    assert.equal(moved.status, 200);
    assert.equal(Number(bag.ctx.db.value('SELECT count(*) FROM lesson_progress WHERE lesson_id = ?', id)), 0);
    assert.ok(bag.ctx.db.get("SELECT 1 FROM tombstone WHERE entity = 'lesson_progress' AND entity_id = ?", `${learner}|${id}`));
    assert.equal((await anon.put(`/learners/${learner}/progress/${id}`, { state: 'started' })).body.error.code, 'sensitive_lesson');
    await admin.delete(`/admin/lessons/${id}`);
  });

  test('new series; the library filters, searches and pages', async () => {
    const hub = await signedIn(bag, HUB, '10.10.0.98');
    const made = await hub.post('/admin/series', { portalId: 'climate', groupId: 'climate-weather', title: 'Rain and floods' }, hub.key());
    const groups = (await anon.get('/portals/climate')).body.groups as { id: string }[];
    const group = groups[0]?.id as string;
    const real = made.status === 201 ? made : await hub.post('/admin/series', { portalId: 'climate', groupId: group, title: 'Rain and floods' }, hub.key());
    assert.equal(real.status, 201, real.text);
    assert.match(real.body.id, /^se-[a-z2-7]{26}$/);
    assert.equal((await hub.post('/admin/series', { portalId: 'primary', groupId: group, title: 'Wrong portal' }, hub.key())).status, 422);
    const page = await admin.get('/admin/lessons?portalId=agriculture&type=watch&pageSize=5&page=2');
    assert.equal(page.body.items.length, 5);
    assert.ok(page.body.total > 10);
    assert.ok(page.body.items.every((l: { type: string; placement: { portalId: string } }) => l.type === 'watch' && l.placement.portalId === 'agriculture'));
    const found = await admin.get('/admin/lessons?search=' + encodeURIComponent('belongs to me'));
    assert.ok(found.body.items.some((l: { id: string }) => l.id === CP_LESSON));
    assert.equal((await admin.get('/admin/lessons?search=' + encodeURIComponent("%' OR 1=1 --"))).body.total, 0, 'search text is data, never SQL');
    const waiting = await admin.get('/admin/lessons?unplaced=true');
    assert.ok(waiting.body.items.every((l: { placement: unknown }) => l.placement === null));
    assert.equal(waiting.body.total, waiting.body.draftCount);
    const counts = await admin.get('/admin/portals');
    assert.equal(counts.body.length, 5);
  });
});

describe('learners and Child protection', () => {
  let bag: Bag;
  let c: Client;
  const LESSON = 'primary-class-1-english-language-1';
  before(async () => {
    bag = await makeBag();
    c = new Client(bag);
  });
  after(() => bag.close());
  let nextPin = 1000;
  // Each learner gets a number of their own: the same name with the same number is one learner.
  const learner = async (name = 'Fatmata'): Promise<string> => (await c.post('/learners', { name, role: 'learner', pin: String((nextPin += 1)) }, c.key())).body.id as string;
  const progressRow = (id: string) => bag.ctx.db.get<{ state: string; position_seconds: number | null; seq: number }>('SELECT state, position_seconds, seq FROM lesson_progress WHERE learner_id = ? AND lesson_id = ?', id, LESSON);

  test('names are trimmed and cleaned; ids are unguessable; there is no list of learners', async () => {
    const made = await c.post('/learners', { name: '  Fatmata\u0007  Kamara ', role: 'teacher', pin: '1234' }, c.key());
    assert.equal(made.status, 201);
    assert.equal(made.body.name, 'Fatmata Kamara');
    assert.equal(made.body.roleLabel, 'Teacher');
    assert.match(made.body.id, /^lr-[a-z2-7]{26}$/);
    assert.equal((await c.post('/learners', { name: '   ', role: 'learner', pin: '1234' }, c.key())).status, 422);
    assert.equal((await c.post('/learners', { name: 'x'.repeat(41), role: 'learner', pin: '1234' }, c.key())).status, 422);
    assert.equal((await c.get('/learners')).status, 404);
    assert.equal((await c.get('/learners/lr-aaaaaaaaaaaaaaaaaaaaaaaaaa')).status, 404);
    assert.equal((await c.get("/learners/' OR 1=1 --")).status, 404);
  });

  test('the secret number: two learners with one name are told apart, and a learner can sign in again from another phone', async () => {
    // A number is required: 4 digits.
    for (const pin of [undefined, '', '12', '12345', 'abcd']) {
      const refused = await c.post('/learners', { name: 'Abdul', role: 'learner', pin }, c.key());
      assert.equal(refused.status, 422, `pin ${String(pin)}`);
      assert.ok(refused.body.error.fields.pin);
    }
    const first = await c.post('/learners', { name: 'Abdul', role: 'learner', pin: '2580' }, c.key());
    const second = await c.post('/learners', { name: 'abdul', role: 'teacher', pin: '1111' }, c.key());
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.body.id, second.body.id);
    assert.equal(JSON.stringify(first.body).includes('2580'), false, 'the number is never sent back');
    // The same name with the same number would be the same person: refused, whatever the capitals.
    const taken = await c.post('/learners', { name: 'ABDUL', role: 'learner', pin: '2580' }, c.key());
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, 'pin_taken');
    // Stored as a hash, never as typed.
    const stored = String(bag.ctx.db.value('SELECT pin_hash FROM learner WHERE id = ?', first.body.id));
    assert.match(stored, /^\$scrypt\$/);
    assert.equal(stored.includes('2580'), false);

    // Sign in: name + number finds the right one of the two.
    const one = await c.post('/learners/sign-in', { name: ' abdul ', pin: '2580' });
    assert.equal(one.status, 200);
    assert.deepEqual(one.body, first.body);
    assert.equal((await c.post('/learners/sign-in', { name: 'Abdul', pin: '1111' })).body.id, second.body.id);
    // Wrong number and unknown name answer the same way.
    const wrong = await c.post('/learners/sign-in', { name: 'Abdul', pin: '0000' });
    const nobody = await c.post('/learners/sign-in', { name: 'Nobody Here', pin: '0000' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, nobody.body);
    assert.equal((await c.post('/learners/sign-in', { name: 'Abdul', pin: '12' })).status, 422);
    // Five wrong tries for one name: a pause, even for the right number; other names are not held up.
    for (let i = 0; i < 4; i += 1) assert.equal((await c.post('/learners/sign-in', { name: 'Abdul', pin: '0000' })).status, 401);
    const held = await c.post('/learners/sign-in', { name: 'Abdul', pin: '2580' });
    assert.equal(held.status, 429);
    assert.equal(held.body.error.code, 'too_many_tries');
    const other = await c.post('/learners', { name: 'Zainab', role: 'learner', pin: '2580' }, c.key());
    assert.equal((await c.post('/learners/sign-in', { name: 'Zainab', pin: '2580' })).body.id, other.body.id);
  });

  test('progress is monotonic: finished never goes back; not-started never erases', async () => {
    const id = await learner();
    assert.equal((await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'not-started' })).body.state, 'not-started');
    assert.equal(progressRow(id), undefined, 'not-started is the absence of a row');
    assert.equal((await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'started', positionSeconds: 30 })).body.state, 'started');
    assert.equal((await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'finished', correct: 3, total: 4 })).body.state, 'finished');
    const again = await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'started', positionSeconds: 2 });
    assert.equal(again.body.state, 'finished');
    assert.equal(again.body.lessonType, 'watch');
    assert.equal(again.body.seriesId, 'primary-class-1-english-language');
    assert.equal((await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'not-started' })).body.state, 'finished');
    assert.equal((await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'finished', correct: 9, total: 4 })).status, 422);
    assert.equal((await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'paused' })).status, 422);
    assert.equal((await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'started', positionSeconds: -1 })).status, 422);
    assert.equal((await c.put(`/learners/${id}/progress/no-such-lesson`, { state: 'started' })).status, 404);
  });

  test('position-only updates close together are coalesced: no write, the stored row comes back', async () => {
    const id = await learner();
    await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'started', positionSeconds: 100 });
    const stored = progressRow(id);
    const seqBefore = bag.ctx.metaInt('change_seq');
    const small = await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'started', positionSeconds: 106 });
    assert.equal(small.body.positionSeconds, 100, 'within 10 s and 60 s: not written');
    assert.equal(bag.ctx.metaInt('change_seq'), seqBefore, 'no change sequence was used, so nothing was written');
    assert.deepEqual(progressRow(id), stored);
    const big = await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'started', positionSeconds: 140 });
    assert.equal(big.body.positionSeconds, 140, 'a real move is written');
    const finished = await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'finished', positionSeconds: 141 });
    assert.equal(finished.body.state, 'finished', 'a state change always writes');
    assert.ok((progressRow(id)?.seq ?? 0) > (stored?.seq ?? 0));
  });

  test('"Continue where you stopped" is the most recently changed started lesson, by sequence, not by clock', async () => {
    const id = await learner();
    await c.put(`/learners/${id}/progress/primary-class-1-english-language-2`, { state: 'started' });
    await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'started' });
    // A wrong clock must not change the answer.
    bag.ctx.writeSync((tx) => tx.run("UPDATE lesson_progress SET updated_at = '1999-01-01T00:00:00.000Z' WHERE learner_id = ? AND lesson_id = ?", id, LESSON));
    const next = await c.get(`/learners/${id}/continue`);
    assert.equal(next.body.lesson.id, LESSON);
    assert.equal((await c.get(`/learners/${id}/continue?portalId=agriculture`)).body, null);
  });

  test('Child protection is never stored per learner: 409 and nothing written, nothing listed, nothing offered (SEC-10)', async () => {
    const id = await learner();
    const refused = await c.put(`/learners/${id}/progress/${CP_LESSON}`, { state: 'finished' });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'sensitive_lesson');
    assert.equal(Number(bag.ctx.db.value('SELECT count(*) FROM lesson_progress lp JOIN lesson l ON l.id = lp.lesson_id JOIN series s ON s.id = l.series_id JOIN content_group g ON g.id = s.group_id JOIN portal p ON p.id = g.portal_id WHERE p.sensitive = 1')), 0);
    assert.deepEqual((await c.get(`/learners/${id}/progress?portalId=child-protection`)).body.lessons, []);
    assert.equal((await c.get(`/learners/${id}/continue?portalId=child-protection`)).body, null);
  });

  test('anonymous activity: 3 pauses and 2 finish retries in one view count once each; a guest is counted; nothing touches the main database', async () => {
    const counts = () => bag.ctx.counts.get<{ opened: number; finished: number }>('SELECT sum(opened) AS opened, sum(finished) AS finished FROM sensitive_activity_count WHERE lesson_id = ?', CP_LESSON) ?? { opened: 0, finished: 0 };
    const before = counts();
    const seq = bag.ctx.metaInt('change_seq');
    const mainSize = statSync(bag.ctx.paths.mainDb + '-wal').size;
    const view = 'f'.repeat(32);
    for (let i = 0; i < 4; i += 1) assert.equal((await c.post(`/lessons/${CP_LESSON}/activity`, { event: 'opened', viewId: view })).status, 204);
    for (let i = 0; i < 3; i += 1) assert.equal((await c.post(`/lessons/${CP_LESSON}/activity`, { event: 'finished', viewId: view })).status, 204);
    assert.equal((counts().opened ?? 0) - (before.opened ?? 0), 1);
    assert.equal((counts().finished ?? 0) - (before.finished ?? 0), 1);
    await c.post(`/lessons/${CP_LESSON}/activity`, { event: 'opened', viewId: 'e'.repeat(32) });
    assert.equal((counts().opened ?? 0) - (before.opened ?? 0), 2, 'another page view is another count');
    // V-019: no sequence number, no write to the personal database or its WAL.
    assert.equal(bag.ctx.metaInt('change_seq'), seq);
    assert.equal(statSync(bag.ctx.paths.mainDb + '-wal').size, mainSize);
    const columns = bag.ctx.counts.all<{ name: string }>("SELECT name FROM pragma_table_info('sensitive_activity_count')").map((r) => r.name);
    assert.deepEqual(columns, ['lesson_id', 'day', 'opened', 'finished'], 'no learner, no seq, no time of day');
    assert.equal((await c.post(`/lessons/primary-class-1-english-language-1/activity`, { event: 'opened', viewId: view })).body.error.code, 'not_sensitive');
    assert.equal((await c.post(`/lessons/${CP_LESSON}/activity`, { event: 'opened', viewId: 'short' })).status, 422);
    assert.equal((await c.post(`/lessons/${CP_LESSON}/activity`, { event: 'opened', viewId: view, learnerId: 'lr-x' })).status, 204, 'extra fields are ignored, never stored');
  });

  test('removing a learner: progress goes too, a tombstone stays, a repeat is 204, an unknown id is 404', async () => {
    const id = await learner('Mohamed');
    await c.put(`/learners/${id}/progress/${LESSON}`, { state: 'started' });
    assert.equal((await c.delete(`/learners/${id}`)).status, 204);
    assert.equal(Number(bag.ctx.db.value('SELECT count(*) FROM lesson_progress WHERE learner_id = ?', id)), 0);
    const stone = bag.ctx.db.get<Record<string, unknown>>("SELECT * FROM tombstone WHERE entity = 'learner' AND entity_id = ?", id);
    assert.ok(stone);
    assert.ok(!JSON.stringify(stone).includes('Mohamed'), 'the tombstone holds the id only');
    assert.equal((await c.delete(`/learners/${id}`)).status, 204);
    assert.equal((await c.delete('/learners/lr-bbbbbbbbbbbbbbbbbbbbbbbbbb')).status, 404);
    assert.equal((await c.get(`/learners/${id}`)).status, 404);
    assert.equal(bag.ctx.db.value('PRAGMA secure_delete'), 0, 'secure_delete is switched back off after the transaction');
  });
});

describe('retention of learner data (OWNER-5, O-16, V-033)', () => {
  const retention = buildConfig({}).retention;
  const learner = (last: string, seq = 10): LearnerAge => ({ id: 'lr-x', last_active_day: last, created_at: `${last}T00:00:00.000Z`, last_seq: seq });
  const jump = (to: string, days: number, confirmed = false): Jump => ({ id: 'cj-1', to_time: `${to}T00:00:00.000Z`, days, source: 'manual', confirmed_at: confirmed ? 'x' : null });

  test('exported data goes after 61 days; unexported data is held 60 more days, then goes anyway', () => {
    assert.equal(judge(learner('2026-01-01'), '2026-03-02', 100, [], retention)?.daysLeft, 1);
    assert.equal(judge(learner('2026-01-01'), '2026-03-03', 100, [], retention)?.daysLeft, 0);
    const held = judge(learner('2026-01-01'), '2026-03-03', 5, [], retention);
    assert.equal(held?.exported, false);
    assert.equal(held?.heldBack, true);
    assert.equal(held?.daysLeft, 60);
    assert.equal(judge(learner('2026-01-01'), '2026-05-02', 5, [], retention)?.daysLeft, 0, 'the hard stop: 121 days');
  });

  test('a clock that is behind never removes anyone', () => {
    assert.equal(judge(learner('2026-06-01'), '2026-01-01', 100, [], retention), null);
  });

  test('days inside a guarded jump never count for unexported data, and count for exported data only once confirmed', () => {
    const today = '2027-03-01';
    const unexported = judge(learner('2026-03-01'), today, 5, [jump('2027-02-20', 320, true)], retention);
    assert.equal(unexported?.countedDays, 45);
    assert.ok((unexported?.daysLeft ?? 0) > 0);
    const waiting = judge(learner('2026-03-01'), today, 100, [jump('2027-02-20', 320)], retention);
    assert.ok((waiting?.daysLeft ?? 0) > 0);
    assert.deepEqual(waiting?.blockedBy, ['cj-1'], 'the hub manager is asked "is the date right?"');
    assert.ok((judge(learner('2026-03-01'), today, 100, [jump('2027-02-20', 320, true)], retention)?.daysLeft ?? 1) <= 0);
    // A jump before the learner's last activity has nothing to do with them.
    assert.ok((judge(learner('2026-03-01'), today, 100, [jump('2026-02-01', 300)], retention)?.daysLeft ?? 1) <= 0);
  });

  test('the daily run: at most 10 % of the learners, never with an unsure clock, once a day, audited with counts only', async () => {
    const bag = await makeBag({ listen: false, role: 'batch' });
    try {
      const { ctx } = bag;
      ctx.writeSync((tx) => {
        for (let i = 0; i < 40; i += 1) {
          const id = `lr-${String(i).padStart(2, 'a').replace(/\d/g, (d) => 'abcdefghij'[Number(d)] as string)}${'a'.repeat(24)}`;
          tx.run("INSERT INTO learner (id, name, role, created_at, last_active_day, seq) VALUES (?, ?, 'learner', '2026-01-01T00:00:00.000Z', '2026-01-01', ?)", id, `Name ${i}`, tx.seq());
        }
        // Everything so far reached EasySTEM.
        tx.run("INSERT INTO export (id, kind, destination, state, created_by, created_at, size_bytes, sha256, snapshot_seq) VALUES ('ex-1', 'backup-records', 'usb', 'copied-to-usb', 'x', 'x', 1, ?, ?)", 'a'.repeat(64), tx.seq());
      });
      assert.equal(planRetention(ctx.db, ctx.config.retention, '2026-12-01').removable.length, 40);
      const first = await runRetention(ctx, '2026-12-01');
      assert.equal(first.removed, 4);
      assert.equal((await runRetention(ctx, '2026-12-01')).removed, 0, 'once a day');
      assert.equal((await runRetention(ctx, '2026-12-02')).removed, 3, '10 % of the 36 left');
      assert.equal(Number(ctx.db.value("SELECT count(*) FROM tombstone WHERE entity = 'learner'")), 7);
      const audit = ctx.db.all<{ detail_json: string }>("SELECT detail_json FROM audit_event WHERE action = 'learner.expire'");
      assert.equal(audit.length, 2);
      assert.ok(!JSON.stringify(audit).includes('Name') && !JSON.stringify(audit).includes('lr-'));
    } finally {
      await bag.close();
    }
  });
});

describe('cleaning learner data on demand (hub manager)', () => {
  test('re-authentication, typed CLEAN, and unexported data must be acknowledged', async () => {
    const bag = await makeBag();
    try {
      const anon = new Client(bag, '10.10.0.97');
      for (const name of ['A', 'B', 'C']) await anon.post('/learners', { name: `Learner ${name}`, role: 'learner', pin: '1234' }, anon.key());
      const admin = await signedIn(bag, ADMIN, '10.10.0.96');
      assert.equal((await admin.post('/admin/learner-data/clean', { scope: 'all', confirm: 'CLEAN' })).status, 403);
      const hub = await signedIn(bag, HUB, '10.10.0.95');
      assert.equal((await hub.post('/admin/learner-data/clean', { scope: 'all', confirm: 'CLEAN' })).body.error.code, 'reauth_required');
      await hub.confirm(HUB);
      assert.equal((await hub.post('/admin/learner-data/clean', { scope: 'all', confirm: 'clean' })).status, 422);
      const summary = await hub.get('/admin/learner-data/summary');
      assert.equal(summary.body.learners, 3);
      assert.equal(summary.body.unexportedLearners, 3);
      assert.equal(summary.body.lastExportAt, null);
      const warned = await hub.post('/admin/learner-data/clean', { scope: 'all', confirm: 'CLEAN' });
      assert.equal(warned.status, 409);
      assert.equal(warned.body.error.code, 'not_exported');
      const done = await hub.post('/admin/learner-data/clean', { scope: 'all', confirm: 'CLEAN', acknowledgeUnexported: true });
      assert.deepEqual(done.body, { learnersRemoved: 3, progressRemoved: 0 });
      assert.equal(Number(bag.ctx.db.value('SELECT count(*) FROM learner')), 0);
      const audit = bag.ctx.db.get<{ detail_json: string }>("SELECT detail_json FROM audit_event WHERE action = 'learner.clean' AND outcome = 'ok'");
      assert.ok(audit && JSON.parse(audit.detail_json).unexportedAcknowledged === true);
    } finally {
      await bag.close();
    }
  });
});
