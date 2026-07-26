import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { ConfigContentHashCalculator } from '../src/domain/hashing/calculators/OtherCalculators';
import { RunMode } from '../src/domain/types/RunMode';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});

async function main() {
  const replayConfigData = {
    mode: RunMode.HISTORICAL_REPLAY as any,
    initialCapital: BigInt(100000),
    codeVersion: '1.0.0',
    rngSeed: BigInt(1234567890),
    fillPolicyVersionKey: 'FILL_v1',
    orchestrationVersionKey: 'ORCH_v1',
  };
  const liveConfigData = {
    mode: RunMode.LIVE_FORWARD as any,
    initialCapital: BigInt(100000),
    codeVersion: '1.0.0',
    rngSeed: BigInt(9876543210),
    fillPolicyVersionKey: 'FILL_v1',
    orchestrationVersionKey: 'ORCH_v1',
  };

  const replayHash = ConfigContentHashCalculator.calculate(replayConfigData);
  const liveHash = ConfigContentHashCalculator.calculate(liveConfigData);

  async function getMetrics() {
    const configTotal = await prisma.runCoreConfigVersion.count();
    const runTotal = await prisma.simulationRun.count();
    const liveExactCount = await prisma.runCoreConfigVersion.count({ where: { contentHash: liveHash } });
    const replayExactCount = await prisma.runCoreConfigVersion.count({ where: { contentHash: replayHash } });
    return { configTotal, runTotal, liveExactCount, replayExactCount };
  }

  const m0 = await getMetrics();
  console.log(`Config total before: ${m0.configTotal}`);
  console.log(`SimulationRun total before: ${m0.runTotal}`);
  
  execSync(`npx tsx scripts/seed.ts`, { stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL } });
  
  const m1 = await getMetrics();
  console.log(`Config total after run 1: ${m1.configTotal}`);
  console.log(`SimulationRun total after run 1: ${m1.runTotal}`);
  
  execSync(`npx tsx scripts/seed.ts`, { stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL } });
  
  const m2 = await getMetrics();
  console.log(`Config total after run 2: ${m2.configTotal}`);
  console.log(`SimulationRun total after run 2: ${m2.runTotal}`);
  
  console.log(`LIVE_FORWARD exact hash count after run 1: ${m1.liveExactCount}`);
  console.log(`LIVE_FORWARD exact hash count after run 2: ${m2.liveExactCount}`);
  console.log(`HISTORICAL_REPLAY exact hash count after run 1: ${m1.replayExactCount}`);
  console.log(`HISTORICAL_REPLAY exact hash count after run 2: ${m2.replayExactCount}`);

  console.log(`Config delta run 1: ${m1.configTotal - m0.configTotal}`);
  console.log(`Config delta run 2: ${m2.configTotal - m1.configTotal}`);
  console.log(`SimulationRun delta run 1: ${m1.runTotal - m0.runTotal}`);
  console.log(`SimulationRun delta run 2: ${m2.runTotal - m1.runTotal}`);
  
  // Also check for any duplicates
  const duplicates: any[] = await prisma.$queryRaw`
    SELECT "contentHash", COUNT(*)::int
    FROM "RunCoreConfigVersion"
    GROUP BY "contentHash"
    HAVING COUNT(*) > 1;
  `;
  console.log(`Duplicate contentHashes in database: ${duplicates.length}`);

  // Unique constraint evidence
  const indexes: any[] = await prisma.$queryRaw`
    SELECT 
      t.relname AS table_name,
      i.relname AS index_name,
      a.attname AS column_name
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE t.relkind = 'r' AND t.relname = 'RunCoreConfigVersion' AND ix.indisunique = true;
  `;
  for (const idx of indexes) {
    if (idx.column_name === 'contentHash') {
      console.log(`TABLE | COLUMN | INDEX | UNIQUE | ENABLED`);
      console.log(`${idx.table_name} | ${idx.column_name} | ${idx.index_name} | TRUE | TRUE`);
    }
  }

}

main().catch(console.error).finally(() => prisma.$disconnect());
