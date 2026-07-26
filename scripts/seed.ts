import { PrismaClient } from '@prisma/client';
import { ConfigContentHashCalculator } from '../src/domain/hashing/calculators/OtherCalculators';
import { RunMode } from '../src/domain/types/RunMode';

const prisma = new PrismaClient();

async function main() {
  const replayConfigData = {
    mode: RunMode.HISTORICAL_REPLAY as any,
    initialCapital: BigInt(100000),
    codeVersion: '1.0.0',
    rngSeed: BigInt(1234567890),
    fillPolicyVersionKey: 'FILL_v1',
    orchestrationVersionKey: 'ORCH_v1',
  };
  const replayContentHash = ConfigContentHashCalculator.calculate(replayConfigData);
  
  await prisma.runCoreConfigVersion.upsert({
    where: { contentHash: replayContentHash },
    update: {},
    create: {
      contentHash: replayContentHash,
      mode: replayConfigData.mode,
      initialCapital: replayConfigData.initialCapital,
      codeVersion: replayConfigData.codeVersion,
      rngSeed: replayConfigData.rngSeed,
      fillPolicyVersionKey: replayConfigData.fillPolicyVersionKey,
      orchestrationVersionKey: replayConfigData.orchestrationVersionKey,
    }
  });

  const liveConfigData = {
    mode: RunMode.LIVE_FORWARD as any,
    initialCapital: BigInt(100000),
    codeVersion: '1.0.0',
    rngSeed: BigInt(9876543210),
    fillPolicyVersionKey: 'FILL_v1',
    orchestrationVersionKey: 'ORCH_v1',
  };
  const liveContentHash = ConfigContentHashCalculator.calculate(liveConfigData);

  await prisma.runCoreConfigVersion.upsert({
    where: { contentHash: liveContentHash },
    update: {},
    create: {
      contentHash: liveContentHash,
      mode: liveConfigData.mode,
      initialCapital: liveConfigData.initialCapital,
      codeVersion: liveConfigData.codeVersion,
      rngSeed: liveConfigData.rngSeed,
      fillPolicyVersionKey: liveConfigData.fillPolicyVersionKey,
      orchestrationVersionKey: liveConfigData.orchestrationVersionKey,
    }
  });

  // No manual log output as it is handled by the measuring wrapper
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
