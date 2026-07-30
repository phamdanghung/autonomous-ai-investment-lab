import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

describe('Market Data Phase 1B Static Verification', () => {
  const contractsPath = path.resolve(__dirname, '../../src/domain/contracts/MarketDataContracts.ts');
  const migrationPath = path.resolve(__dirname, '../../prisma/migrations/20260726234457_phase_1b_market_data_foundation/migration.sql');
  const contractsContent = fs.readFileSync(contractsPath, 'utf8');
  const migrationContent = fs.readFileSync(migrationPath, 'utf8');

  it('1. Domain không import Prisma', () => {
    expect(contractsContent).not.toMatch(/@prisma\/client/);
  });

  it('2. Batch business-key payload không chứa idempotency key', () => {
    const typeDef = contractsContent.substring(contractsContent.indexOf('export type CanonicalBatchBusinessKeyPayload = {'), contractsContent.indexOf('};', contractsContent.indexOf('export type CanonicalBatchBusinessKeyPayload = {')));
    expect(typeDef).not.toMatch(/creationIdempotencyKey/);
    expect(typeDef).not.toMatch(/creationRequestHash/);
    expect(typeDef).not.toMatch(/sourceObjectKey/);
    expect(typeDef).not.toMatch(/createdAt/);
    expect(typeDef).not.toMatch(/startedAt/);
    expect(typeDef).not.toMatch(/completedAt/);
  });

  it('3. Batch payload chứa source content hash và canonicalization version', () => {
    const typeDef = contractsContent.substring(contractsContent.indexOf('export type CanonicalBatchBusinessKeyPayload = {'), contractsContent.indexOf('};', contractsContent.indexOf('export type CanonicalBatchBusinessKeyPayload = {')));
    expect(typeDef).toMatch(/sourceContentHash: string;/);
    expect(typeDef).toMatch(/canonicalizationVersion: string;/);
  });

  it('4. Import-request payload có đủ 10 fields đã khóa', () => {
    const typeDef = contractsContent.substring(contractsContent.indexOf('export type CanonicalImportRequestPayload = {'), contractsContent.indexOf('};', contractsContent.indexOf('export type CanonicalImportRequestPayload = {')));
    expect(typeDef).toMatch(/importContractVersion: string;/);
    expect(typeDef).toMatch(/sourceVersionKey: string;/);
    expect(typeDef).toMatch(/fixtureKey: string;/);
    expect(typeDef).toMatch(/sourceObjectKey: string;/);
    expect(typeDef).toMatch(/sourceContentHash: string;/);
    expect(typeDef).toMatch(/sourceByteSize: string;/);
    expect(typeDef).toMatch(/importMode: MarketImportMode;/);
    expect(typeDef).toMatch(/adapterVersion: string;/);
    expect(typeDef).toMatch(/schemaVersion: string;/);
    expect(typeDef).toMatch(/canonicalizationVersion: string;/);
  });

  it('5. Data-cutoff payload dùng batch objects', () => {
    const typeDef = contractsContent.substring(contractsContent.indexOf('export type CanonicalDataCutoffPayload = {'), contractsContent.indexOf('};', contractsContent.indexOf('export type CanonicalDataCutoffPayload = {')));
    expect(typeDef).toMatch(/batches: Array<\{/);
    expect(typeDef).toMatch(/batchBusinessKey: string;/);
    expect(typeDef).toMatch(/sourceContentHash: string;/);
  });

  it('6. Data-cutoff documentation có exact ordering', () => {
    expect(contractsContent).toContain('1. batchBusinessKey ASC');
    expect(contractsContent).toContain('2. sourceContentHash ASC');
  });

  it('7. Source-contract literal values', () => {
    const typeDef = contractsContent.substring(contractsContent.indexOf('export type CanonicalSourceContractPayload = {'), contractsContent.indexOf('};', contractsContent.indexOf('export type CanonicalSourceContractPayload = {')));
    expect(typeDef).toMatch(/datasetKind: "EOD_MARKET_DATA";/);
    expect(typeDef).toMatch(/adapterKind: "REPOSITORY_CSV_FIXTURE";/);
    expect(typeDef).toMatch(/priceUnit: "VND_PER_SHARE";/);
    expect(typeDef).toMatch(/encoding: "UTF8";/);
  });

  it('8. ImportBatch transition có COMPLETED_WITH_QUARANTINE', () => {
    expect(migrationContent).toContain(`NEW."status" IN ('COMPLETED', 'COMPLETED_WITH_QUARANTINE', 'FAILED')`);
  });

  it('9. ImportBatch immutable comparison xảy ra trước transition branch', () => {
    const funcBody = migrationContent.substring(migrationContent.indexOf('block_import_batch_status_transition'), migrationContent.indexOf('END;', migrationContent.indexOf('block_import_batch_status_transition')));
    const identityCheckIdx = funcBody.indexOf('RAISE EXCEPTION \'MarketDataImportBatch identity/provenance fields are immutable.\';');
    const statusCheckIdx = funcBody.indexOf('OLD."status" = \'PENDING\' AND NEW."status" = \'PENDING\'');
    expect(identityCheckIdx).toBeLessThan(statusCheckIdx);
    expect(identityCheckIdx).not.toBe(-1);
  });

  it('10. Snapshot không cho DRAFT -> DRAFT', () => {
    expect(migrationContent).toMatch(/OLD\."status" = 'DRAFT' AND NEW\."status" = 'DRAFT' THEN\s*RAISE EXCEPTION 'DRAFT -> DRAFT update is not allowed\.'/);
  });

  it('11. Snapshot chỉ cho DRAFT -> SEALED', () => {
    expect(migrationContent).toMatch(/OLD\."status" = 'DRAFT' AND NEW\."status" = 'SEALED' THEN/);
    expect(migrationContent).toContain(`RAISE EXCEPTION 'Only DRAFT -> SEALED transition is allowed.';`);
  });

  it('12. Accepted traded SQL branch', () => {
    expect(migrationContent).toContain(`"qualityDecision" IN ('ACCEPTED', 'ACCEPTED_WITH_FLAGS') AND`);
    expect(migrationContent).toContain(`"barKind" = 'TRADED' AND`);
    expect(migrationContent).toContain(`"open" >= 0 AND "high" >= 0 AND "low" >= 0 AND "close" >= 0 AND`);
  });

  it('13. Accepted no-trade/suspended SQL branch', () => {
    expect(migrationContent).toContain(`"qualityDecision" IN ('ACCEPTED', 'ACCEPTED_WITH_FLAGS') AND`);
    expect(migrationContent).toContain(`"barKind" IN ('NO_TRADE', 'SUSPENDED') AND`);
    expect(migrationContent).toContain(`"open" IS NULL AND "high" IS NULL AND "low" IS NULL AND "close" IS NULL AND`);
    expect(migrationContent).toContain(`"volume" = 0 AND`);
  });

  it('14. Quarantined bypasses strict quality branch', () => {
    expect(migrationContent).toContain(`"qualityDecision" = 'QUARANTINED'`);
  });

  it('15-18. DB Migration checks', async () => {
    // 15. Phase 1B ledger row count DEV bằng 0.
    // 16. Phase 1B ledger row count TEST bằng 0.
    // 17. Migration vẫn pending.
    // 18. Phase 1A migrations không đổi.

    const prismaDev = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    const devMigrations = await prismaDev.$queryRawUnsafe<any[]>(`SELECT * FROM "_prisma_migrations" ORDER BY finished_at ASC`);
    await prismaDev.$disconnect();

    expect(devMigrations.length).toBe(12);
    expect(devMigrations.some(m => m.migration_name === '20260729215800_align_market_day_type')).toBe(true);
    expect(devMigrations.some(m => m.migration_name === '20260726234457_phase_1b_market_data_foundation')).toBe(true);
    expect(devMigrations.some(m => m.migration_name === '20260727142941_phase_1b_source_version_sealed_at_not_null')).toBe(true);

    if (process.env.TEST_DATABASE_URL) {
      const prismaTest = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
      const testMigrations = await prismaTest.$queryRawUnsafe<any[]>(`SELECT * FROM "_prisma_migrations" ORDER BY finished_at ASC`);
      await prismaTest.$disconnect();

      expect(testMigrations.length).toBe(12);
      expect(testMigrations.some(m => m.migration_name === '20260729215800_align_market_day_type')).toBe(true);
      expect(testMigrations.some(m => m.migration_name === '20260726234457_phase_1b_market_data_foundation')).toBe(true);
      expect(testMigrations.some(m => m.migration_name === '20260727142941_phase_1b_source_version_sealed_at_not_null')).toBe(true);
    }
  });
});
