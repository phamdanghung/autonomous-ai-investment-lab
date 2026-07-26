import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient();

async function main() {
  const triggers: any[] = await prisma.$queryRaw`
    SELECT 
        c.relname AS table_name,
        t.tgname AS trigger_name,
        p.proname AS function_name,
        pg_get_functiondef(p.oid) AS function_def
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE NOT t.tgisinternal
    ORDER BY c.relname, t.tgname;
  `;
  for (const t of triggers) {
    console.log('--------------------------------------------------');
    console.log(`TABLE: ${t.table_name} | TRIGGER: ${t.trigger_name} | FUNCTION: ${t.function_name}`);
    console.log(t.function_def);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
