// V4: throughput of the PoC's WinZip-AES CTR routine (ctrLE copied verbatim from poc/poc_ae2.mjs at run time)
// versus a batched keystream (many counter blocks per ecb.update call). Equality of outputs is checked.
// Mac M-series, Node v23; the Pi 5 (Cortex-A76, AES instructions) will be slower. Run: node verify_ae2_ctr_speed.mjs <poc dir>
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[2] + '/poc_ae2.mjs', 'utf8');
const m = src.match(/function ctrLE\(key, data\) \{[\s\S]*?\n\}/)[0];
const ctrLE = new Function('crypto', 'Buffer', m + '; return ctrLE;')(crypto, Buffer);
function ctrBatched(key, data) {
  const ecb = crypto.createCipheriv('aes-256-ecb', key, null); ecb.setAutoPadding(false);
  const out = Buffer.alloc(data.length), B = 4096; let n = 1;
  for (let off = 0; off < data.length; off += 16 * B) {
    const blocks = Math.min(B, Math.ceil((data.length - off) / 16)), ctr = Buffer.alloc(16 * blocks);
    for (let b = 0; b < blocks; b++, n++) ctr.writeUIntLE(n, b * 16, 6);
    const ks = ecb.update(ctr);
    for (let i = 0; i < blocks * 16 && off + i < data.length; i++) out[off + i] = data[off + i] ^ ks[i];
  }
  return out;
}
const key = crypto.randomBytes(32), data = crypto.randomBytes(20 * 1048576);
let t = performance.now(); const a = ctrLE(key, data); const tA = performance.now() - t;
t = performance.now(); const b = ctrBatched(key, data); const tB = performance.now() - t;
console.log(`20 MiB: PoC ctrLE ${tA.toFixed(0)} ms (${(20000 / tA).toFixed(0)} MB/s); batched keystream ${tB.toFixed(0)} ms (${(20000 / tB).toFixed(0)} MB/s); outputs equal=${a.equals(b)}`);
