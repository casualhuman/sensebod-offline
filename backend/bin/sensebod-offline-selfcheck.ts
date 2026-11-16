/* sensebod-offline-selfcheck: the release self-check (R-11). Exit 0 only when every check passes. */
import { configPathFromArgv, loadConfig } from '../src/config.ts';
import { selfCheck } from '../src/system/selfcheck.ts';

const report = selfCheck(loadConfig(configPathFromArgv()));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.ok ? 0 : 1);
