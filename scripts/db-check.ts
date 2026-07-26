import { PrismaClient } from '@prisma/client';
import { ConfigLoader } from '../src/security/environment';

async function check(name: string, url: string | undefined) {
  if (!url) {
    console.error(`[FAIL] ${name} URL is missing!`);
    return false;
  }
  
  const client = new PrismaClient({
    datasources: { db: { url } }
  });
  
  try {
    await client.$connect();
    // Test a simple query to ensure connectivity
    await client.$queryRaw`SELECT 1`;
    console.log(`[PASS] ${name} connected successfully.`);
    return true;
  } catch (error: any) {
    console.error(`[FAIL] ${name} connection failed: ${error.message}`);
    return false;
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  ConfigLoader.load(); // Validate env schema
  
  let success = true;
  success = await check('Development DB', process.env.DATABASE_URL) && success;
  success = await check('Test DB', process.env.TEST_DATABASE_URL) && success;
  success = await check('Shadow DB', process.env.SHADOW_DATABASE_URL) && success;
  
  if (!success) {
    process.exit(1);
  }
}

main();
