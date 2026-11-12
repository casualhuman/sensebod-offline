// Reviewer B: parse every built script as a classic script at ES5 / ES2015 / ES2017
// (Chrome 58 parses ES2017; no object spread, optional catch binding, ?. or ??). Run from app/.
const fs = require('fs');
const path = require('path');
const acorn = require(require.resolve('acorn', { paths: [process.cwd()] }));
const dir = 'dist/assets';
let bad = 0;
let n = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  n += 1;
  const code = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const v of [5, 2015, 2017]) {
    try {
      acorn.parse(code, { ecmaVersion: v, sourceType: 'script' });
      console.log(f.padEnd(44), 'parses as ES' + v);
      break;
    } catch (e) {
      if (v === 2017) { bad += 1; console.log(f, 'FAILS ES2017:', e.message); }
    }
  }
}
console.log(n + ' scripts, ' + bad + ' not valid ES2017');
