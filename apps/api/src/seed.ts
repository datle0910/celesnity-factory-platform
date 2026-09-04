import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, SourceType } from '@prisma/client';
import { existsSync } from 'node:fs';

/**
 * Prepares a usable starting point: the seeded organisation, and the three
 * required sources registered against the local fixtures.
 *
 * Collection is deliberately *not* run here. The assessment asks for a manual
 * collection workflow, so the reviewer drives register → test → discover →
 * select → collect themselves; the seed only removes the tedium of retyping
 * connection settings. Selections are pre-filled but fully editable in the
 * interface, so changing what is collected is still a first-class action.
 *
 * Re-running is safe: everything is upserted by a natural key.
 */

for (const candidate of ['.env', '../../.env']) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const env = (name: string, fallback: string): string => process.env[name] || fallback;

async function main(): Promise<void> {
  const organizationId = env('SEED_ORGANIZATION_ID', 'org-celesnity-laundry');
  const organizationName = env('SEED_ORGANIZATION_NAME', 'Celesnity Industrial Laundry');

  await prisma.organization.upsert({
    where: { id: organizationId },
    create: { id: organizationId, name: organizationName },
    update: { name: organizationName },
  });

  const appApiUrl = env('FIXTURE_APP_API_URL', 'http://localhost:4001');
  const supplierPortalUrl = env('FIXTURE_SUPPLIER_PORTAL_URL', 'http://localhost:4002');

  const sources = [
    {
      name: 'Internal application API',
      type: SourceType.APPLICATION_API,
      config: {
        baseUrl: appApiUrl,
        datasets: ['work-orders', 'batches', 'receiving', 'dispatch'],
        // Small on purpose: the fixture holds ten batches, so a page size of
        // three means pagination is genuinely exercised on every run.
        pageSize: 3,
        timeoutMs: 5_000,
        maxRetries: 3,
      },
      secretEnvVar: null,
    },
    {
      name: 'Supplier delivery portal',
      type: SourceType.CRAWLER,
      config: {
        startUrl: `${supplierPortalUrl}/deliveries?page=1`,
        maxPages: 20,
        timeoutMs: 5_000,
        maxRetries: 2,
      },
      secretEnvVar: null,
    },
    {
      name: 'Factory production database',
      type: SourceType.DATABASE,
      config: {
        host: env('PRODUCTION_DB_HOST', 'localhost'),
        port: Number(env('PRODUCTION_DB_PORT', '5433')),
        database: env('PRODUCTION_DB_NAME', 'production'),
        user: env('PRODUCTION_DB_USER', 'factory_reader'),
        schema: 'factory',
        table: 'production_events',
        columnMapping: {
          sourceRecordId: 'event_id',
          batchId: 'batch_ref',
          station: 'station',
          quantity: 'quantity',
          occurredAt: 'occurred_at',
          recordedAt: 'recorded_at',
        },
      },
      // Supplied by reference: the password is read from this environment
      // variable at connect time and never stored by the platform.
      secretEnvVar: 'PRODUCTION_DB_PASSWORD',
    },
  ];

  for (const source of sources) {
    await prisma.source.upsert({
      where: { organizationId_name: { organizationId, name: source.name } },
      create: {
        organizationId,
        name: source.name,
        type: source.type,
        config: source.config,
        secretEnvVar: source.secretEnvVar,
      },
      update: {
        type: source.type,
        config: source.config,
        secretEnvVar: source.secretEnvVar,
      },
    });
    console.log(`registered source: ${source.name}`);
  }

  console.log(`\nSeed complete for organisation "${organizationName}".`);
  console.log('Open the Data Sources view and run a collection to populate the production board.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
