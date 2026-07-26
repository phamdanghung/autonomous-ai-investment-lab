import { execSync } from 'child_process';
import { env } from 'process';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

if (fs.existsSync('.env')) {
  const content = fs.readFileSync('.env', 'utf-8');
  content.split('\n').forEach(line => {
    if (line.match(/^[A-Za-z_][A-Za-z0-9_]*=/)) {
      const parts = line.split('=');
      const key = parts[0];
      const val = parts.slice(1).join('=').trim().replace(/^"|"$/g, '');
      env[key] = val;
    }
  });
}

const envOverrides = {
  ...env,
  DATABASE_URL: env.TEST_DATABASE_URL,
};

async function getMetrics(prisma) {
  const configTotal = await prisma.runCoreConfigVersion.count();
  const runTotal = await prisma.simulationRun.count();
  const liveCount = await prisma.runCoreConfigVersion.count({ where: { mode: 'LIVE_FORWARD' } });
  const replayCount = await prisma.runCoreConfigVersion.count({ where: { mode: 'HISTORICAL_REPLAY' } });
  return { configTotal, runTotal, liveCount, replayCount };
}

async function main() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const prisma = new PrismaClient();
  
  const m0 = await getMetrics(prisma);
  console.log(`Config total before: ${m0.configTotal}`);
  console.log(`SimulationRun total before: ${m0.runTotal}`);
  console.log(`LIVE_FORWARD expected-hash row count before: ${m0.liveCount}`);
  console.log(`HISTORICAL_REPLAY expected-hash row count before: ${m0.replayCount}`);
  
  execSync(`npx tsx scripts/seed.ts`, { env: envOverrides, stdio: 'inherit' });
  const m1 = await getMetrics(prisma);
  console.log(`Config total after run 1: ${m1.configTotal}`);
  console.log(`SimulationRun total after run 1: ${m1.runTotal}`);
  console.log(`LIVE_FORWARD expected-hash row count: ${m1.liveCount}`);
  console.log(`HISTORICAL_REPLAY expected-hash row count: ${m1.replayCount}`);
  
  execSync(`npx tsx scripts/seed.ts`, { env: envOverrides, stdio: 'inherit' });
  const m2 = await getMetrics(prisma);
  console.log(`Config total after run 2: ${m2.configTotal}`);
  console.log(`SimulationRun total after run 2: ${m2.runTotal}`);
  console.log(`LIVE_FORWARD expected-hash row count: ${m2.liveCount}`);
  console.log(`HISTORICAL_REPLAY expected-hash row count: ${m2.replayCount}`);
  
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
