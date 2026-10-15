import { cleanupIntegrationDatabase, integrationDatabases } from './integrationDatabases.mjs';
for (const suite of Object.keys(integrationDatabases)) {
  await cleanupIntegrationDatabase(suite);
  console.log(`Removed isolated fixture: ${integrationDatabases[suite]}`);
}
