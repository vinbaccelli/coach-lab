// Runs every *.e2e.mjs in this folder against the local stack (start.sh + dev.sh must be running).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.e2e.mjs')).sort()) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} e2e file(s) failed` : '\nall e2e files passed');
process.exit(failed ? 1 : 0);
