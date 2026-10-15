import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupIntegrationDatabase, integrationDatabases } from './integrationDatabases.mjs';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const suites = Object.keys(integrationDatabases);
for (const suite of suites) {
  console.log(`\nRunning ${suite}`);
  const result = spawnSync(process.execPath, [`tests/${suite}`], { cwd, stdio: 'inherit', env: { ...process.env, PLATFORM_TEST_DB: integrationDatabases['platform.mjs'], KEEP_TEST_DB: '0' } });
  await cleanupIntegrationDatabase(suite);
  if (result.status !== 0) process.exit(result.status || 1);
}
