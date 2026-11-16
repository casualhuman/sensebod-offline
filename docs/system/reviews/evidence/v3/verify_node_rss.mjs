// V3: order-of-magnitude RSS of a bare Node process with an HTTP server and a synchronous SQLite connection,
// and of a forked child. Mac (arm64, macOS, Node v23) - NOT linux-arm64 on a Pi; no Express loaded.
import { fork } from 'node:child_process';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
const mb = (b) => (b / 1048576).toFixed(0) + ' MB';
if (process.argv[2] === 'child') {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE t(x)');
  process.send({ rss: process.memoryUsage().rss }); setTimeout(() => process.exit(0), 200);
} else {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE t(x)');
  const srv = http.createServer((q, r) => r.end('ok')).listen(0, () => {
    console.log('parent (http server + node:sqlite) rss', mb(process.memoryUsage().rss));
    const c = fork(new URL(import.meta.url).pathname, ['child']);
    c.on('message', (m) => { console.log('forked child (node:sqlite) rss', mb(m.rss)); srv.close(); });
  });
}
