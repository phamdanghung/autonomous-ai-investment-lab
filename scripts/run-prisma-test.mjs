import { execSync } from 'child_process';
import { env } from 'process';
import fs from 'fs';

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

function runPrismaTestCommand() {
  const testDbUrl = env.TEST_DATABASE_URL;
  const shadowDbUrl = env.SHADOW_DATABASE_URL;

  if (!testDbUrl) {
    console.error("ERROR: TEST_DATABASE_URL is not set.");
    process.exit(1);
  }

  // Basic validation that it's postgres and doesn't look like prod
  if (!testDbUrl.startsWith('postgresql://') && !testDbUrl.startsWith('postgres://')) {
    console.error("ERROR: TEST_DATABASE_URL must be a PostgreSQL connection.");
    process.exit(1);
  }

  if (testDbUrl.includes('prod') || testDbUrl.includes('production')) {
    console.error("ERROR: TEST_DATABASE_URL contains production keywords.");
    process.exit(1);
  }

  if (shadowDbUrl && shadowDbUrl === testDbUrl) {
    console.error("ERROR: SHADOW_DATABASE_URL cannot be the same as TEST_DATABASE_URL.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const command = `npx prisma ${args.join(' ')}`;

  const envOverrides = {
    ...env,
    DATABASE_URL: testDbUrl,
    NODE_ENV: 'test'
  };

  if (shadowDbUrl) {
    envOverrides.SHADOW_DATABASE_URL = shadowDbUrl;
  }

  console.log(`Running Prisma command on isolated TEST_DATABASE_URL...`);
  
  try {
    execSync(command, { env: envOverrides, stdio: 'inherit' });
  } catch (error) {
    process.exit(error.status || 1);
  }
}

runPrismaTestCommand();
