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

const args = process.argv.slice(2);
const projects = args.length > 0 ? args : ['integration'];
const targetDirs = projects.map(p => p === 'all' ? 'tests' : `tests/${p}`).join(' ');

const envOverrides = {
  ...env,
  DATABASE_URL: env.TEST_DATABASE_URL,
  NODE_ENV: 'test'
};

console.log(`Running tests for projects: ${projects.join(', ')} on isolated TEST_DATABASE_URL...`);

try {
  execSync(`npx vitest run ${targetDirs}`, { env: envOverrides, stdio: 'inherit' });
} catch (error) {
  process.exit(error.status || 1);
}
