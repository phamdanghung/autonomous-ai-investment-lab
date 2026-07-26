import fs from 'fs';
import path from 'path';

function pad(n) { return n < 10 ? '0' + n : n; }
const d = new Date();
const ts = `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
const dirName = `${ts}_phase_1a_closure_invariants`;
const dirPath = path.join(process.cwd(), 'prisma', 'migrations', dirName);

fs.mkdirSync(dirPath, { recursive: true });
fs.writeFileSync(path.join(dirPath, 'migration.sql'), '-- Empty migration for closure invariants\n');
console.log(`Created migration folder: ${dirName}`);
