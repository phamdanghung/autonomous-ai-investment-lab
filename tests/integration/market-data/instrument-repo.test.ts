import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaMarketInstrumentAdapters, PrismaTransactionContext } from '../../../src/infrastructure/repositories/market-data/PrismaMarketInstrumentRepository';
import { IMarketInstrumentTransactionPort } from '../../../src/application/ports/market-data/IMarketInstrumentTransactionPort';
import { IMarketInstrumentQueryRepository } from '../../../src/application/ports/market-data/IMarketInstrumentQueryRepository';
import { IMarketInstrumentTransactionalRepository } from '../../../src/application/ports/market-data/IMarketInstrumentTransactionalRepository';
import { RegisterMarketInstrumentService } from '../../../src/application/services/market-data/RegisterMarketInstrumentService';
import { CloseMarketInstrumentListingService } from '../../../src/application/services/market-data/CloseMarketInstrumentListingService';
import { ListMarketInstrumentsService } from '../../../src/application/services/market-data/ListMarketInstrumentsService';
import { GetMarketInstrumentService } from '../../../src/application/services/market-data/GetMarketInstrumentService';
import { MarketInstrumentOverlapError, MarketInstrumentNotFoundError, MarketInstrumentAlreadyClosedError, MarketInstrumentInvalidError, MarketDataIntegrityError, MarketDataConcurrencyConflictError } from '../../../src/domain/market-data/MarketDataErrors';
import { MarketInstrumentDomain } from '../../../src/domain/market-data/MarketInstrument';

describe('MarketInstrument Integration Tests', () => {
  let prisma: PrismaClient;
  let txRunner: IMarketInstrumentTransactionPort;
  let qRepo: IMarketInstrumentQueryRepository;
  let txRepo: IMarketInstrumentTransactionalRepository;

  let registerService: RegisterMarketInstrumentService;
  let closeService: CloseMarketInstrumentListingService;
  let getService: GetMarketInstrumentService;
  let listService: ListMarketInstrumentsService;

  beforeAll(async () => {
    prisma = new PrismaClient();

    const adapters = createPrismaMarketInstrumentAdapters(prisma);
    txRunner = adapters.transactionRunner;
    qRepo = adapters.queryRepository;
    txRepo = adapters.transactionalRepository;

    registerService = new RegisterMarketInstrumentService(txRunner, txRepo);
    closeService = new CloseMarketInstrumentListingService(txRunner, qRepo, txRepo);
    getService = new GetMarketInstrumentService(qRepo);
    listService = new ListMarketInstrumentsService(qRepo);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const getTestSymbol = () => `TST${Math.random().toString(36).substring(7).toUpperCase()}`;

  it('1. Insert valid instrument', async () => {
    const symbol = getTestSymbol();
    const res = await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-01-01'
    });

    expect(res.outcome).toBe('CREATED');
    expect(res.instrument.effectiveTo).toBeNull();
    expect(res.instrument.canonicalSymbol).toBe(symbol);

    const fetched = await getService.execute({ id: res.instrument.id });
    expect(fetched.id).toBe(res.instrument.id);
  });

  it('2. Exact replay returns same database row (REPLAYED)', async () => {
    const symbol = getTestSymbol();
    const payload = {
      exchange: 'HNX' as const,
      canonicalSymbol: symbol,
      securityType: 'EQUITY' as const,
      effectiveFrom: '2023-01-01'
    };

    const first = await registerService.execute(payload);
    expect(first.outcome).toBe('CREATED');

    const second = await registerService.execute(payload);
    expect(second.outcome).toBe('REPLAYED');
    expect(second.instrument.id).toBe(first.instrument.id);
  });

  it('3. Duplicate business key with conflicting payload rejects', async () => {
    const symbol = getTestSymbol();
    await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-01-01',
      effectiveTo: '2023-12-31'
    });

    await expect(registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-01-01',
      effectiveTo: null // conflict
    })).rejects.toThrowError(MarketInstrumentOverlapError);
  });

  it('4. Open-ended overlap rejects', async () => {
    const symbol = getTestSymbol();
    await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-01-01',
      effectiveTo: null
    });

    await expect(registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-06-01',
      effectiveTo: null
    })).rejects.toThrowError(MarketInstrumentOverlapError);
  });

  it('5. Historical non-overlap succeeds', async () => {
    const symbol = getTestSymbol();
    await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-01-01',
      effectiveTo: '2023-05-31'
    });

    const res = await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-06-01',
      effectiveTo: null
    });

    expect(res.outcome).toBe('CREATED');
  });

  it('6. Boundary-touch overlap rejects', async () => {
    const symbol = getTestSymbol();
    await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-01-01',
      effectiveTo: '2023-06-01' // Inclusive boundary
    });

    await expect(registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-06-01', // Inclusive boundary overlap
      effectiveTo: null
    })).rejects.toThrowError(MarketInstrumentOverlapError);
  });

  it('7. Close only changes effectiveTo', async () => {
    const symbol = getTestSymbol();
    const res = await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-01-01'
    });

    const closed = await closeService.execute({
      businessKey: res.instrument.businessKey,
      effectiveTo: '2023-12-31'
    });

    expect(closed.effectiveTo).toBe('2023-12-31');
    expect(closed.effectiveFrom).toBe(res.instrument.effectiveFrom);
    expect(closed.sealedAt).toBe(res.instrument.sealedAt);
  });

  it('8. Second close rejected by service/database invariant', async () => {
    const symbol = getTestSymbol();
    const res = await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-01-01'
    });

    await closeService.execute({
      businessKey: res.instrument.businessKey,
      effectiveTo: '2023-12-31'
    });

    await expect(closeService.execute({
      businessKey: res.instrument.businessKey,
      effectiveTo: '2023-12-31'
    })).rejects.toThrowError(MarketInstrumentAlreadyClosedError);
  });

  it('9. Invalid close date rejected', async () => {
    const symbol = getTestSymbol();
    const res = await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-05-01'
    });

    await expect(closeService.execute({
      businessKey: res.instrument.businessKey,
      effectiveTo: '2023-01-01' // before effectiveFrom
    })).rejects.toThrowError(MarketInstrumentInvalidError);
  });

  it('10. Restrictive/immutability trigger remains effective', async () => {
    // Phase 1A setup an immutable trigger.
    // Try to update exchange directly should fail.
    const symbol = getTestSymbol();
    const res = await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-05-01'
    });

    await expect(prisma.$executeRaw`
      UPDATE "MarketInstrument" SET "exchange" = 'HNX' WHERE id = ${res.instrument.id}
    `).rejects.toThrow();
  });

  it('11. Mapper date-only round-trip', async () => {
    const symbol = getTestSymbol();
    const res = await registerService.execute({
      exchange: 'HOSE',
      canonicalSymbol: symbol,
      securityType: 'EQUITY',
      effectiveFrom: '2023-05-05'
    });

    // Check application DTO returns string YYYY-MM-DD
    expect(res.instrument.effectiveFrom).toBe('2023-05-05');
  });

  it('12. List stable ordering & 13. Cursor next page has no duplicate/missing records', async () => {
    const symbol = getTestSymbol();
    // Insert 5 episodes for the same symbol
    for (let i = 1; i <= 5; i++) {
      await registerService.execute({
        exchange: 'HOSE',
        canonicalSymbol: symbol,
        securityType: 'EQUITY',
        effectiveFrom: `2020-0${i}-01`,
        effectiveTo: `2020-0${i}-15`
      });
    }

    // List with limit 2
    const page1 = await listService.execute({
      canonicalSymbol: symbol,
      limit: 2
    });
    expect(page1.items.length).toBe(2);
    expect(page1.items[0].effectiveFrom).toBe('2020-01-01');
    expect(page1.items[1].effectiveFrom).toBe('2020-02-01');
    expect(page1.nextCursor).toBeDefined();

    // List next page
    const page2 = await listService.execute({
      canonicalSymbol: symbol,
      limit: 2,
      cursor: page1.nextCursor!
    });
    expect(page2.items.length).toBe(2);
    expect(page2.items[0].effectiveFrom).toBe('2020-03-01');
    expect(page2.items[1].effectiveFrom).toBe('2020-04-01');
    expect(page2.nextCursor).toBeDefined();

    // List final page
    const page3 = await listService.execute({
      canonicalSymbol: symbol,
      limit: 2,
      cursor: page2.nextCursor!
    });
    expect(page3.items.length).toBe(1);
    expect(page3.items[0].effectiveFrom).toBe('2020-05-01');
    expect(page3.nextCursor).toBeNull();
  });

  it('14. Transaction rollback leaves no partially created record', async () => {
    const symbol = getTestSymbol();

    await expect(txRunner.runInTransaction(async (ctx) => {
      await txRepo.insertListing(ctx, {
        businessKey: MarketInstrumentDomain.buildBusinessKey('HOSE', symbol, 'EQUITY', '2023-01-01'),
        exchange: 'HOSE',
        canonicalSymbol: symbol,
        securityType: 'EQUITY',
        effectiveFrom: '2023-01-01',
        effectiveTo: null
      });

      throw new Error('Simulated Rollback');
    })).rejects.toThrow('Simulated Rollback');

    // Verify it doesn't exist
    const res = await qRepo.list({ canonicalSymbol: symbol, limit: 10 });
    expect(res.length).toBe(0);
  });

  it('15. Context isolation: Plain fake context rejected', async () => {
    const fakeCtx = { [Symbol('MARKET_INSTRUMENT_TX_CONTEXT')]: true } as any;
    await expect(txRepo.findById(fakeCtx, 'some-id')).rejects.toThrowError(MarketDataIntegrityError);
  });

  it('16. Context isolation: Context adapter A rejected by adapter B', async () => {
    const tokenA = Symbol('AdapterA');
    const tokenB = Symbol('AdapterB');

    const adaptersA = createPrismaMarketInstrumentAdapters(prisma, tokenA);
    const runnerA = adaptersA.transactionRunner;
    const repoA = adaptersA.transactionalRepository;
    const repoB = createPrismaMarketInstrumentAdapters(prisma, tokenB).transactionalRepository;

    await runnerA.runInTransaction(async (ctxA) => {
      // Prove ctxA is active and accepted by repoA
      const resA = await repoA.findByBusinessKey(ctxA, 'some-key');
      expect(resA).toBeNull();

      // Prove ctxA is rejected by repoB
      await expect(repoB.findByBusinessKey(ctxA, 'some-key'))
        .rejects.toThrowError('Cross-adapter transaction context usage detected');
    });
  });

  it('17. Context isolation: Context invalid after commit', async () => {
    let capturedCtx: any;
    await txRunner.runInTransaction(async (ctx) => {
      capturedCtx = ctx;
    });
    // Context is deactivated after finally
    await expect(txRepo.findById(capturedCtx, 'some-id')).rejects.toThrowError('Transaction context has expired and cannot be used');
  });

  it('18. Context isolation: Context invalid after rollback', async () => {
    let capturedCtx: any;
    await expect(txRunner.runInTransaction(async (ctx) => {
      capturedCtx = ctx;
      throw new Error('Simulated Rollback');
    })).rejects.toThrow('Simulated Rollback');
    await expect(txRepo.findById(capturedCtx, 'some-id')).rejects.toThrowError('Transaction context has expired and cannot be used');
  });

  describe('P2034 Error Mapping Verification', () => {
    const rawPrismaError = Object.assign(
      new Error("RAW PRISMA ENGINE MESSAGE WITH CONNECTION DETAILS"),
      {
        code: "P2034",
        clientVersion: "6.19.3",
      }
    );

    it('19. P2034 in runInTransaction boundary maps safely', async () => {
      const mockPrisma = {
        $transaction: () => Promise.reject(rawPrismaError)
      } as any;
      const testAdapters = createPrismaMarketInstrumentAdapters(mockPrisma);

      let caughtError: any;
      try {
        await testAdapters.transactionRunner.runInTransaction(async () => {});
      } catch (e) {
        caughtError = e;
      }

      expect(caughtError).toBeInstanceOf(MarketDataConcurrencyConflictError);
      expect(caughtError.code).toBe('MARKET_DATA_CONCURRENCY_CONFLICT');
      expect(caughtError.category).toBe('CONCURRENCY');
      expect(caughtError.retryable).toBe(true);
      expect(caughtError.safeMessage).toBe('The operation could not be completed due to a concurrent update. Please try again.');
      expect(caughtError.message).toBe('Concurrent market-data operation conflict.');
      expect(caughtError.message).not.toContain('RAW PRISMA ENGINE MESSAGE');
      expect(caughtError.message).not.toContain('P2034');
      expect(caughtError.message).not.toContain('clientVersion');
    });

    it('20. P2034 in insertListing maps safely', async () => {
      const mockTx = {
        marketInstrument: {
          create: () => Promise.reject(rawPrismaError)
        }
      } as any;

      const testToken = Symbol('P2034Insert');
      const testAdapters = createPrismaMarketInstrumentAdapters(prisma, testToken);
      const fakeCtx = new PrismaTransactionContext(testToken, mockTx);

      let caughtError: any;
      try {
        await testAdapters.transactionalRepository.insertListing(fakeCtx, {
          businessKey: 'TEST',
          exchange: 'HOSE',
          canonicalSymbol: 'TEST',
          securityType: 'EQUITY',
          effectiveFrom: '2023-01-01',
          effectiveTo: null
        });
      } catch (e) {
        caughtError = e;
      }

      expect(caughtError).toBeInstanceOf(MarketDataConcurrencyConflictError);
      expect(caughtError.code).toBe('MARKET_DATA_CONCURRENCY_CONFLICT');
      expect(caughtError.category).toBe('CONCURRENCY');
      expect(caughtError.retryable).toBe(true);
      expect(caughtError.safeMessage).toBe('The operation could not be completed due to a concurrent update. Please try again.');
      expect(caughtError.message).toBe('Concurrent market-data operation conflict.');
      expect(caughtError.message).not.toContain('RAW PRISMA ENGINE MESSAGE');
    });

    it('21. P2034 in closeOpenListing maps safely', async () => {
      const mockTx = {
        $executeRaw: () => Promise.reject(rawPrismaError)
      } as any;

      const testToken = Symbol('P2034Close');
      const testAdapters = createPrismaMarketInstrumentAdapters(prisma, testToken);
      const fakeCtx = new PrismaTransactionContext(testToken, mockTx);

      let caughtError: any;
      try {
        await testAdapters.transactionalRepository.closeOpenListing(fakeCtx, {
          id: 'TEST_ID',
          effectiveTo: '2023-12-31'
        });
      } catch (e) {
        caughtError = e;
      }

      expect(caughtError).toBeInstanceOf(MarketDataConcurrencyConflictError);
      expect(caughtError.code).toBe('MARKET_DATA_CONCURRENCY_CONFLICT');
      expect(caughtError.category).toBe('CONCURRENCY');
      expect(caughtError.retryable).toBe(true);
      expect(caughtError.safeMessage).toBe('The operation could not be completed due to a concurrent update. Please try again.');
      expect(caughtError.message).toBe('Concurrent market-data operation conflict.');
      expect(caughtError.message).not.toContain('RAW PRISMA ENGINE MESSAGE');
    });

    it('22. Existing MarketInstrumentOverlapError is rethrown unchanged', async () => {
      const originalError = new MarketInstrumentOverlapError('TEST_OVERLAP');
      const mockPrisma = {
        $transaction: () => Promise.reject(originalError)
      } as any;
      const testAdapters = createPrismaMarketInstrumentAdapters(mockPrisma);

      await expect(testAdapters.transactionRunner.runInTransaction(async () => {})).rejects.toBe(originalError);
    });

    it('23. Existing MarketDataConcurrencyConflictError is not wrapped again', async () => {
      const originalError = new MarketDataConcurrencyConflictError('TEST_CONCURRENCY');
      const mockTx = {
        marketInstrument: {
          create: () => Promise.reject(originalError)
        }
      } as any;

      const testToken = Symbol('P2034InsertDomain');
      const testAdapters = createPrismaMarketInstrumentAdapters(prisma, testToken);
      const fakeCtx = new PrismaTransactionContext(testToken, mockTx);

      await expect(testAdapters.transactionalRepository.insertListing(fakeCtx, {
        businessKey: 'TEST',
        exchange: 'HOSE',
        canonicalSymbol: 'TEST',
        securityType: 'EQUITY',
        effectiveFrom: '2023-01-01',
        effectiveTo: null
      })).rejects.toBe(originalError);
    });

    it('24. Unknown ordinary error is rethrown unchanged', async () => {
      const originalError = new Error('Unknown plain error');
      const mockTx = {
        $executeRaw: () => Promise.reject(originalError)
      } as any;

      const testToken = Symbol('P2034CloseUnknown');
      const testAdapters = createPrismaMarketInstrumentAdapters(prisma, testToken);
      const fakeCtx = new PrismaTransactionContext(testToken, mockTx);

      await expect(testAdapters.transactionalRepository.closeOpenListing(fakeCtx, {
        id: 'TEST_ID',
        effectiveTo: '2023-12-31'
      })).rejects.toBe(originalError);
    });

    it('25. Other P2* error is mapped to MarketDataIntegrityError', async () => {
      const genericPrismaError = Object.assign(new Error('Generic P2 error'), { code: 'P2003' });
      const mockTx = {
        $executeRaw: () => Promise.reject(genericPrismaError)
      } as any;

      const testToken = Symbol('P2*Integrity');
      const testAdapters = createPrismaMarketInstrumentAdapters(prisma, testToken);
      const fakeCtx = new PrismaTransactionContext(testToken, mockTx);

      await expect(testAdapters.transactionalRepository.closeOpenListing(fakeCtx, {
        id: 'TEST_ID',
        effectiveTo: '2023-12-31'
      })).rejects.toThrowError(MarketDataIntegrityError);
    });
  });
});
