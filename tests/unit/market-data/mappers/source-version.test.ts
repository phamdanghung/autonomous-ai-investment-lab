import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MarketDataSourcePrismaMappers } from '../../../../src/infrastructure/mappers/MarketDataSourcePrismaMappers';
import { MarketDatasetKind, MarketAdapterKind, MarketPriceUnit, SourceEncoding } from '../../../../src/domain/contracts/MarketDataContracts';

describe('MarketDataSourcePrismaMappers timezone', () => {
  const originalEnv = process.env.TZ;

  const testTimezones = ['UTC', 'Asia/Ho_Chi_Minh'];

  for (const tz of testTimezones) {
    describe(`Timezone ${tz}`, () => {
      beforeAll(() => {
        process.env.TZ = tz;
      });

      afterAll(() => {
        process.env.TZ = originalEnv;
      });

      it(`should correctly map domain to prisma and back in ${tz}`, () => {
        const domain = {
          id: 'uuid-1',
          sourceKey: 'KEY',
          contractHash: 'hash',
          providerCode: 'TEST',
          datasetKind: "EOD_MARKET_DATA" as any,
          sealedAt: new Date('2023-01-01T00:00:00Z'),
          adapterKind: "REPOSITORY_CSV_FIXTURE" as any,
          adapterVersion: '1.0',
          schemaVersion: '1.0',
          canonicalizationVersion: '1.0',
          priceUnit: "VND_PER_SHARE" as any,
          encoding: "UTF8" as any,
        };

        const prismaInsert = MarketDataSourcePrismaMappers.toPrismaInsert(domain);
        expect(prismaInsert).toEqual(domain);

        const prismaEntity = {
          ...prismaInsert,
          createdAt: new Date('2023-01-01T00:00:00Z')
        } as any;

        const mappedDomain = MarketDataSourcePrismaMappers.toDomain(prismaEntity);
        expect(mappedDomain.sealedAt.toISOString()).toBe('2023-01-01T00:00:00.000Z');
      });
    });
  }
});
