import fs from 'fs';
import { execSync } from 'child_process';

if (fs.existsSync('.env')) {
  const content = fs.readFileSync('.env', 'utf-8');
  const match = content.match(/postgres:([^@]+)@/);
  if (match) {
    const pwd = match[1];
    const env = { ...process.env, PGPASSWORD: pwd };
    const psql = `"C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe" -U postgres -c`;
    try {
      execSync(`${psql} "CREATE DATABASE autonomous_ai_lab_dev WITH TEMPLATE template0;"`, { env, stdio: 'inherit' });
    } catch (e) { console.log("Dev DB probably exists."); }
    try {
      execSync(`${psql} "CREATE DATABASE autonomous_ai_lab_test WITH TEMPLATE template0;"`, { env, stdio: 'inherit' });
    } catch (e) { console.log("Test DB probably exists."); }
    try {
      execSync(`${psql} "CREATE DATABASE autonomous_ai_lab_shadow WITH TEMPLATE template0;"`, { env, stdio: 'inherit' });
    } catch (e) { console.log("Shadow DB probably exists."); }
    console.log("Databases created successfully!");
  } else {
    console.log("Could not find password in .env");
  }
} else {
  console.log(".env file not found");
}
