// Lint probes for A-07: snippets are linted through ESLint's API with a virtual
// file path, so nothing is written into app/. Run from app/: node <this file>
import { createRequire } from 'node:module';
import path from 'node:path';

// This file lives outside app/, so eslint is resolved from app/node_modules.
const { ESLint } = createRequire(path.join(process.cwd(), 'package.json'))('eslint');

const probes = [
  ['1 useEffect with a missing dependency (feature file)', 'src/features/learner/__probe.tsx', `import { useEffect, useState } from 'react';\nexport function P({ id }: { id: string }) { const [n, setN] = useState(0); useEffect(() => { setN(id.length); }, []); return <p>{n}</p>; }\n`],
  ['2 useApi with a missing dependency', 'src/features/learner/__probe.tsx', `import { learnerApi, useApi } from '@shared/api';\nexport function P({ id }: { id: string }) { const { data } = useApi((signal) => learnerApi.getSeries(id, { signal }), []); return <p>{data ? data.id : ''}</p>; }\n`],
  ['3 shared code importing a feature', 'src/shared/components/__probe.ts', `import { routes } from '../../features/learner/routes';\nexport const r = routes;\n`],
  ['4 cross-feature import, and a floating promise', 'src/features/learner/__probe.ts', `import { x } from '../lessons/routes';\nexport function f() { fetch('/x'); return x; }\n`],
  ['5 React.lazy in a feature routes file (not lazyScreen)', 'src/features/learner/__probe.tsx', `import { lazy } from 'react';\nexport const S = lazy(() => import('./screens/Help'));\n`],
];

const eslint = new ESLint({ cwd: process.cwd() });
for (const [label, filePath, code] of probes) {
  const [result] = await eslint.lintText(code, { filePath });
  console.log(`--- ${label}: ${result.errorCount} error(s), ${result.warningCount} warning(s)`);
  for (const m of result.messages) console.log(`    ${m.severity === 2 ? 'error' : 'warn'} ${m.ruleId}: ${m.message.slice(0, 150)}`);
}
