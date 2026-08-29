import { PrismaClient, Prisma } from '@prisma/client';
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as process from 'process';

export interface IsolatedTestSchema {
  readonly schemaName: string;
  readonly databaseUrl: string;
  teardown(): Promise<void>;
}

const TEST_SCHEMA_PATTERN = /^tiso_[a-z0-9_]+$/;

function assertSafeTestSchemaName(schemaName: string): void {
  if (
    schemaName.length === 0 ||
    schemaName.length > 63 ||
    !TEST_SCHEMA_PATTERN.test(schemaName) ||
    schemaName === 'public' ||
    schemaName === 'pg_catalog' ||
    schemaName === 'information_schema'
  ) {
    throw new Error('Generated isolated test schema name is invalid.');
  }
}

function sanitizeSchemaComponent(
  value: string,
  fallback: string,
  maxLength: number,
): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);

  return sanitized || fallback;
}

function quotePgIdentifier(identifier: string): string {
  assertSafeTestSchemaName(identifier);
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function setupIsolatedTestSchema(
  testFileSlug: string,
): Promise<IsolatedTestSchema> {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL environment variable is missing.');
  }
  
  const testUrlObj = new URL(testDatabaseUrl);
  const testDbName = testUrlObj.pathname.slice(1);

  // 1. Base database guard
  const adminClient = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  try {
    const dbInfo = await adminClient.$queryRaw<{ databaseName: string }[]>`SELECT current_database() AS "databaseName";`;
    const dbName = dbInfo[0]?.databaseName;

    if (dbName !== 'autonomous_ai_lab_test') {
      throw new Error(`Base database guard failed. Expected 'autonomous_ai_lab_test' but connected to '${dbName}'.`);
    }
  } catch (err: any) {
    await adminClient.$disconnect();
    throw new Error(`Base database guard connection failed: ${err.message}`);
  }

  // 2. Unique schema name
  const slug = sanitizeSchemaComponent(testFileSlug, 'test', 20);
  const rawWorkerId = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0';
  const workerId = sanitizeSchemaComponent(rawWorkerId, '0', 12);
  const pid = process.pid.toString();
  const rand = randomBytes(4).toString('hex');
  const schemaName = `tiso_${slug}_${pid}_${workerId}_${rand}`;
  
  assertSafeTestSchemaName(schemaName);
  const quotedSchemaName = quotePgIdentifier(schemaName);

  // 3. Schema creation
  try {
    await adminClient.$executeRawUnsafe(`CREATE SCHEMA ${quotedSchemaName}`);
  } catch (err: any) {
    await adminClient.$disconnect();
    throw new Error(`Failed to create schema ${schemaName}: ${err.message}`);
  }

  await adminClient.$disconnect();

  // 4. Isolated Prisma URL
  const urlObj = new URL(testDatabaseUrl);
  urlObj.searchParams.set('schema', schemaName);
  const isolatedUrl = urlObj.toString();

  // 5. Migration deployment
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    shell: false,
    stdio: 'pipe'
  });

  const sanitizeErrorString = (str: string) => {
    return str.replace(new RegExp(testUrlObj.password, 'g'), '***').replace(new RegExp(testDatabaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***TEST_DATABASE_URL***').replace(new RegExp(isolatedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***ISOLATED_URL***');
  };

  const attemptCleanup = async (): Promise<string> => {
    const cleanupClient = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    try {
      await cleanupClient.$executeRawUnsafe(`DROP SCHEMA ${quotedSchemaName} CASCADE`);
      return 'Cleanup successful.';
    } catch (cleanupErr: any) {
      return `Cleanup failed: ${cleanupErr.message}`;
    } finally {
      await cleanupClient.$disconnect();
    }
  };

  if (result.status !== 0) {
    const cleanupMsg = await attemptCleanup();
    const sanitizedError = sanitizeErrorString(result.stderr?.toString('utf-8') || '');
    const sanitizedOut = sanitizeErrorString(result.stdout?.toString('utf-8') || '');
    throw new Error(`Migration deployment failed for schema ${schemaName} (Exit code: ${result.status}).\n${cleanupMsg}\nStdout: ${sanitizedOut}\nStderr: ${sanitizedError}`);
  }

  // 6. Post-migration schema verification
  const isolatedClient = new PrismaClient({ datasourceUrl: isolatedUrl });
  try {
    const verifiedDbInfo = await isolatedClient.$queryRaw<{ databaseName: string, schemaName: string }[]>`SELECT current_database() AS "databaseName", current_schema() AS "schemaName";`;
    if (verifiedDbInfo[0]?.databaseName !== 'autonomous_ai_lab_test' || verifiedDbInfo[0]?.schemaName !== schemaName) {
      throw new Error(`Verification failed. Connected to db: ${verifiedDbInfo[0]?.databaseName}, schema: ${verifiedDbInfo[0]?.schemaName}`);
    }

    const migrationsRows = await isolatedClient.$queryRaw<{ count: bigint }[]>`SELECT count(*) as count FROM _prisma_migrations;`;
    if (Number(migrationsRows[0].count) !== 14) {
      throw new Error(`Expected 14 migrations, found ${migrationsRows[0].count}`);
    }

    const tables = await isolatedClient.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = ${schemaName} AND tablename IN ('MarketInstrument', 'MarketDataSourceVersion');
    `;
    if (tables.length !== 2) {
      throw new Error('Required tables missing in isolated schema.');
    }

    const triggers = await isolatedClient.$queryRaw<{ tgname: string, enabled: string }[]>`
      SELECT tgname, tgenabled as enabled FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = ${schemaName} AND tgname IN ('trigger_market_instrument_mutation', 'trigger_market_data_source_version_mutation');
    `;
    if (triggers.length !== 2 || triggers.some(t => t.enabled === 'D')) {
      throw new Error('Immutable triggers missing or disabled.');
    }
  } catch (err: any) {
    await isolatedClient.$disconnect();
    const cleanupMsg = await attemptCleanup();
    throw new Error(`Post-migration verification failed: ${err.message}\n${cleanupMsg}`);
  } finally {
    await isolatedClient.$disconnect();
  }

  return {
    schemaName,
    databaseUrl: isolatedUrl,
    teardown: async () => {
      // 7. Teardown contract
      assertSafeTestSchemaName(schemaName);
      const quotedSchemaName = quotePgIdentifier(schemaName);
      const tdClient = new PrismaClient({ datasourceUrl: testDatabaseUrl });
      try {
        const tdDbInfo = await tdClient.$queryRaw<{ databaseName: string }[]>`SELECT current_database() AS "databaseName";`;
        if (tdDbInfo[0]?.databaseName !== 'autonomous_ai_lab_test') {
          throw new Error('Teardown database guard failed.');
        }
        
        const exists = await tdClient.$queryRaw<{ nspname: string }[]>`SELECT nspname FROM pg_namespace WHERE nspname = ${schemaName};`;
        if (exists.length > 0) {
          await tdClient.$executeRawUnsafe(`DROP SCHEMA ${quotedSchemaName} CASCADE`);
          const remaining = await tdClient.$queryRaw<{ nspname: string }[]>`SELECT nspname FROM pg_namespace WHERE nspname = ${schemaName};`;
          if (remaining.length > 0) {
            throw new Error(`Schema ${schemaName} still exists after drop.`);
          }
        }
      } finally {
        await tdClient.$disconnect();
      }
    }
  };
}
