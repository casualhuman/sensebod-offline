/* Content packs from a stick (SYSTEM-ARCHITECTURE §8.3): real OpenSSH signatures, namespace-restricted keys (T-9, SEC-5 on a laptop). */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { contentPackInstall } from '../src/catalog/pack.ts';
import { seriesDetail, lessonDetail } from '../src/catalog/model.ts';
import { sha256Hex } from '../src/core/ids.ts';
import type { JobRow } from '../src/worker/queue.ts';
import { JobFailure } from '../src/worker/types.ts';
import { makeBag } from './harness.ts';

describe('content pack install', () => {
  test('a signed pack installs in one transaction and resumes; a pack signed for another purpose, or changed after signing, is refused', async () => {
    const bag = await makeBag({ listen: false, role: 'batch' });
    try {
      const { ctx } = bag;
      // EasySTEM's content key, restricted to its namespace, as shipped in /etc/sensebod-offline/allowed_signers.
      const key = join(bag.dir, 'content_key');
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'content@easystem', '-f', key]);
      const publicKey = execFileSync('cat', [`${key}.pub`], { encoding: 'utf8' }).trim().split(' ').slice(0, 2).join(' ');
      writeFileSync(bag.config.paths.allowedSignersFile, `content@easystem namespaces="sensebod-offline-content" ${publicKey}\n`);

      const video = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(500, 3)]);
      const sha = sha256Hex(video);
      const name = 'sensebod-offline-pack-agriculture-livestock-1';
      mkdirSync(ctx.paths.usbMount, { recursive: true });
      const dir = join(ctx.paths.usbMount, name);
      mkdirSync(join(dir, 'files'), { recursive: true });
      writeFileSync(join(dir, 'files', `${sha}.mp4`), video);
      const manifest = {
        format: 'sensebod-offline-pack/1',
        id: 'agriculture-livestock',
        version: '1',
        files: [{ sha256: sha, size: video.length, ext: 'mp4' }],
        groups: [{ id: 'agri-pack-goats', portalId: 'agriculture', kind: 'topic', title: 'Goats' }],
        series: [{ id: 'agri-pack-goats-feeding', groupId: 'agri-pack-goats', title: 'Feeding goats' }],
        lessons: [
          { id: 'agri-pack-goats-feeding-1', seriesId: 'agri-pack-goats-feeding', type: 'watch', title: 'What goats eat', lengthSeconds: 300, assets: [{ role: 'source', sha256: sha }] },
          { id: 'agri-pack-goats-feeding-2', seriesId: 'agri-pack-goats-feeding', type: 'watch', title: 'Clean water', assets: [{ role: 'source', sha256: sha }] },
        ],
      };
      const sign = (namespace: string): void => {
        rmSync(join(dir, 'manifest.json.sig'), { force: true });
        execFileSync('ssh-keygen', ['-q', '-Y', 'sign', '-f', key, '-n', namespace, join(dir, 'manifest.json')], { stdio: 'ignore' });
      };
      const run = () => contentPackInstall.run({ config: bag.config, paths: ctx.paths, job: { id: 'jb-pack', kind: 'content_pack_install', payload: { name } }, workDir: join(bag.dir, 'work'), progress() {} });
      const job = { id: 'jb-pack', kind: 'content_pack_install', lane: 'usb', payload_json: JSON.stringify({ name }) } as JobRow;

      // Signed with the right key but for another purpose (a release): refused.
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
      sign('sensebod-offline-release');
      await assert.rejects(run(), (error: unknown) => error instanceof JobFailure && error.code === 'bad_signature');
      // Changed after signing: refused.
      sign('sensebod-offline-content');
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, version: '1 ' }));
      await assert.rejects(run(), (error: unknown) => error instanceof JobFailure && error.code === 'bad_signature');
      // A damaged file inside a correctly signed pack: refused, nothing activated.
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
      sign('sensebod-offline-content');
      writeFileSync(join(dir, 'files', `${sha}.mp4`), Buffer.concat([video.subarray(0, 100), Buffer.alloc(video.length - 100, 9)]));
      await assert.rejects(run(), (error: unknown) => error instanceof JobFailure && error.code === 'bad_pack');
      assert.equal(ctx.db.get("SELECT 1 FROM lesson WHERE source = 'content-pack'"), undefined);

      writeFileSync(join(dir, 'files', `${sha}.mp4`), video);
      const rev = ctx.metaInt('content_rev');
      const first = (await run()) as { copied: number };
      assert.equal(first.copied, 1);
      ctx.writeSync((tx) => contentPackInstall.finalize(ctx, tx, job, first));
      assert.equal(ctx.metaInt('content_rev'), rev + 1);
      const series = seriesDetail(ctx.db, 'agri-pack-goats-feeding');
      assert.deepEqual(series.lessons.map((l) => [l.position, l.title]), [[1, 'What goats eat'], [2, 'Clean water']]);
      const lesson = lessonDetail(ctx.db, 'agri-pack-goats-feeding-1');
      assert.deepEqual(lesson.content.sources, [{ url: `/media/c/${sha.slice(0, 2)}/${sha}.mp4`, mimeType: 'video/mp4' }]);
      assert.equal(ctx.db.value("SELECT state FROM content_pack WHERE id = 'agriculture-livestock'"), 'installed');
      assert.equal(ctx.db.value('SELECT origin FROM blob WHERE sha256 = ?', sha), 'content-pack');

      // "Install again": files already in the store are skipped, and lessons are updated, not duplicated.
      const second = (await run()) as { copied: number };
      assert.equal(second.copied, 0);
      ctx.writeSync((tx) => contentPackInstall.finalize(ctx, tx, job, second));
      assert.equal(Number(ctx.db.value("SELECT count(*) FROM lesson WHERE source = 'content-pack'")), 2);
    } finally {
      await bag.close();
    }
  });
});
