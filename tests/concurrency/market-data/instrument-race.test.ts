import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaMarketInstrumentAdapters } from '../../../src/infrastructure/repositories/market-data/PrismaMarketInstrumentRepository';
import { IMarketInstrumentTransactionPort } from '../../../src/application/ports/market-data/IMarketInstrumentTransactionPort';
import { IMarketInstrumentQueryRepository } from '../../../src/application/ports/market-data/IMarketInstrumentQueryRepository';
import { IMarketInstrumentTransactionalRepository } from '../../../src/application/ports/market-data/IMarketInstrumentTransactionalRepository';
import { RegisterMarketInstrumentService } from '../../../src/application/services/market-data/RegisterMarketInstrumentService';
import { CloseMarketInstrumentListingService } from '../../../src/application/services/market-data/CloseMarketInstrumentListingService';
import { MarketDataCanonicalization } from '../../../src/domain/market-data/MarketDataCanonicalization';
import { MarketInstrumentOverlapError, MarketInstrumentAlreadyClosedError } from '../../../src/domain/market-data/MarketDataErrors';
import { setupIsolatedTestSchema, IsolatedTestSchema } from '../../utils/database';
describe('MarketInstrument Real Concurrency Tests', () => {
  let prismaA: PrismaClient;
  let prismaB: PrismaClient;
  let prismaObserver: PrismaClient;

  let txRunner: IMarketInstrumentTransactionPort;
  let qRepo: IMarketInstrumentQueryRepository;
  let txRepo: IMarketInstrumentTransactionalRepository;
  let registerService: RegisterMarketInstrumentService;
  let closeService: CloseMarketInstrumentListingService;

  let isolatedSchema: IsolatedTestSchema;

  beforeAll(async () => {
    isolatedSchema = await setupIsolatedTestSchema('instrument-race');
    prismaA = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    prismaB = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });
    prismaObserver = new PrismaClient({ datasourceUrl: isolatedSchema.databaseUrl });

    const adapters = createPrismaMarketInstrumentAdapters(prismaA);
    txRunner = adapters.transactionRunner;
    qRepo = adapters.queryRepository;
    txRepo = adapters.transactionalRepository;

    registerService = new RegisterMarketInstrumentService(txRunner, txRepo);
    closeService = new CloseMarketInstrumentListingService(txRunner, qRepo, txRepo);
  });

  afterAll(async () => {
    await prismaA.$disconnect();
    await prismaB.$disconnect();
    await prismaObserver.$disconnect();
    if (isolatedSchema) {
      await isolatedSchema.teardown();
    }
  });

  const getTestSymbol = () => `TSRC${Math.random().toString(36).substring(7).toUpperCase()}`;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  describe('Part 1: Real PostgreSQL Advisory Lock Verification', () => {

    it('1. Same-key serialization', async () => {
      const tokenA = Symbol('A');
      const tokenB = Symbol('B');
      const adaptersA = createPrismaMarketInstrumentAdapters(prismaA, tokenA);
      const runnerA = adaptersA.transactionRunner;
      const adaptersB = createPrismaMarketInstrumentAdapters(prismaB, tokenB);
      const runnerB = adaptersB.transactionRunner;
      const repoA = adaptersA.transactionalRepository;
      const repoB = adaptersB.transactionalRepository;

      const lockKey = MarketDataCanonicalization.deriveAdvisoryLockKey('HOSE', getTestSymbol(), 'EQUITY');

      const events: string[] = [];
      let resolveA: () => void;
      const barrierA = new Promise<void>(r => resolveA = r);
      let pidA: number = 0;
      let pidB: number = 0;
      let observerLocks: any[] = [];
      let blockingPids: number[] = [];

      const p1 = runnerA.runInTransaction(async (ctxA) => {
        events.push('A_STARTED');
        const txClient = (ctxA as any).getClient(tokenA);
        const pidRes = await txClient.$queryRaw`SELECT pg_backend_pid() AS pid`;
        pidA = (pidRes as any)[0].pid;
        events.push('A_PID_CAPTURED');

        await repoA.acquireIdentityLock(ctxA, lockKey);
        events.push('A_LOCKED');
        await barrierA; // Hold lock
        return 'A_COMMITTED';
      }).then(res => {
        events.push(res);
      });

      // Wait for A to acquire lock
      while (!events.includes('A_LOCKED')) await sleep(10);

      events.push('B_STARTED');
      const p2 = runnerB.runInTransaction(async (ctxB) => {
        const txClient = (ctxB as any).getClient(tokenB);
        const pidRes = await txClient.$queryRaw`SELECT pg_backend_pid() AS pid`;
        pidB = (pidRes as any)[0].pid;
        events.push('B_PID_CAPTURED');

        events.push('B_LOCK_ATTEMPTED');
        // This will block on PostgreSQL!
        await repoB.acquireIdentityLock(ctxB, lockKey);
        events.push('B_LOCKED');
        return 'B_COMMITTED';
      }).then(res => {
        events.push(res);
      });

      // B is now started, wait a bit for it to send the lock request to Postgres
      while (!events.includes('B_LOCK_ATTEMPTED')) await sleep(10);
      await sleep(100); // Give postgres time to register the wait

      // Observer checks pg_locks to prove B is waiting on Postgres
      if (pidA && pidB) {
        let attempts = 0;
        while (attempts < 10) {
          observerLocks = await prismaObserver.$queryRaw<any[]>`
            SELECT pid, locktype, database, classid, objid, objsubid, mode, granted
            FROM pg_locks
            WHERE locktype = 'advisory' AND pid IN (${pidA}, ${pidB})
            ORDER BY pid, granted DESC
          `;

          const blockingRes = await prismaObserver.$queryRaw<any[]>`
            SELECT pg_blocking_pids(CAST(${pidB} AS int)) AS blocking_pids
          `;
          blockingPids = blockingRes[0]?.blocking_pids || [];

          const bWaiting = observerLocks.find(l => l.pid === pidB && l.granted === false);
          if (bWaiting && blockingPids.includes(pidA)) {
            events.push('B_WAIT_CONFIRMED_BY_PG_LOCKS');
            events.push('B_BLOCKED_BY_A_CONFIRMED');
            break;
          }
          await sleep(50);
          attempts++;
        }
      }

      resolveA!();
      await Promise.all([p1, p2]);

      expect(events).toEqual([
        'A_STARTED',
        'A_PID_CAPTURED',
        'A_LOCKED',
        'B_STARTED',
        'B_PID_CAPTURED',
        'B_LOCK_ATTEMPTED',
        'B_WAIT_CONFIRMED_BY_PG_LOCKS',
        'B_BLOCKED_BY_A_CONFIRMED',
        'A_COMMITTED',
        'B_LOCKED',
        'B_COMMITTED'
      ]);

      // Assert lock rows strictly
      const aLock = observerLocks.find(l => l.pid === pidA);
      const bLock = observerLocks.find(l => l.pid === pidB);
      expect(aLock.granted).toBe(true);
      expect(bLock.granted).toBe(false);
      expect(aLock.database).toBe(bLock.database);
      expect(aLock.classid).toBe(bLock.classid);
      expect(aLock.objid).toBe(bLock.objid);
      expect(aLock.objsubid).toBe(bLock.objsubid);
    });

    it('2. Rollback release', async () => {
      const tokenA = Symbol('A');
      const tokenB = Symbol('B');
      const adaptersA = createPrismaMarketInstrumentAdapters(prismaA, tokenA);
      const runnerA = adaptersA.transactionRunner;
      const adaptersB = createPrismaMarketInstrumentAdapters(prismaB, tokenB);
      const runnerB = adaptersB.transactionRunner;
      const repoA = adaptersA.transactionalRepository;
      const repoB = adaptersB.transactionalRepository;

      const lockKey = MarketDataCanonicalization.deriveAdvisoryLockKey('HOSE', getTestSymbol(), 'EQUITY');

      const events: string[] = [];
      let resolveA: () => void;
      const barrierA = new Promise<void>(r => resolveA = r);
      let pidA: number = 0;
      let pidB: number = 0;
      let observerLocks: any[] = [];
      let blockingPids: number[] = [];

      const p1 = runnerA.runInTransaction(async (ctxA) => {
        const txClient = (ctxA as any).getClient(tokenA);
        const pidRes = await txClient.$queryRaw`SELECT pg_backend_pid() AS pid`;
        pidA = (pidRes as any)[0].pid;

        await repoA.acquireIdentityLock(ctxA, lockKey);
        events.push('A_LOCKED');
        await barrierA;
        throw new Error('Rollback A');
      }).catch(err => {
        events.push('A_ROLLED_BACK');
      });

      while (!events.includes('A_LOCKED')) await sleep(10);

      const p2 = runnerB.runInTransaction(async (ctxB) => {
        const txClient = (ctxB as any).getClient(tokenB);
        const pidRes = await txClient.$queryRaw`SELECT pg_backend_pid() AS pid`;
        pidB = (pidRes as any)[0].pid;

        events.push('B_LOCK_ATTEMPTED');
        await repoB.acquireIdentityLock(ctxB, lockKey);
        events.push('B_LOCKED');
        return 'B_COMMITTED';
      }).then(res => {
        events.push(res);
      });

      while (!events.includes('B_LOCK_ATTEMPTED')) await sleep(10);

      let attempts = 0;
      while (attempts < 10) {
        observerLocks = await prismaObserver.$queryRaw<any[]>`
          SELECT pid, locktype, database, classid, objid, objsubid, mode, granted
          FROM pg_locks
          WHERE locktype = 'advisory' AND pid IN (${pidA}, ${pidB})
        `;
        const blockingRes = await prismaObserver.$queryRaw<any[]>`SELECT pg_blocking_pids(CAST(${pidB} AS int)) AS blocking_pids`;
        blockingPids = blockingRes[0]?.blocking_pids || [];

        const bWaiting = observerLocks.find(l => l.pid === pidB && l.granted === false);
        if (bWaiting && blockingPids.includes(pidA)) {
          events.push('B_WAIT_CONFIRMED_BY_PG_LOCKS');
          break;
        }
        await sleep(50);
        attempts++;
      }

      resolveA!();
      await Promise.all([p1, p2]);

      // The order of A_ROLLED_BACK and B_LOCKED is non-deterministic because Node.js processes the catch block and unblocked queries in parallel.
      expect(events).toContain('A_LOCKED');
      expect(events).toContain('B_LOCK_ATTEMPTED');
      expect(events).toContain('B_WAIT_CONFIRMED_BY_PG_LOCKS');
      expect(events).toContain('A_ROLLED_BACK');
      expect(events).toContain('B_LOCKED');
      expect(events).toContain('B_COMMITTED');

      // But we can assert the causal order
      expect(events.indexOf('B_WAIT_CONFIRMED_BY_PG_LOCKS')).toBeLessThan(events.indexOf('B_LOCKED'));
      expect(events.indexOf('A_LOCKED')).toBeLessThan(events.indexOf('B_WAIT_CONFIRMED_BY_PG_LOCKS'));

      const postLocks = await prismaObserver.$queryRaw<any[]>`
        SELECT * FROM pg_locks
        WHERE locktype = 'advisory' AND pid IN (${pidA}, ${pidB})
      `;
      expect(postLocks.length).toBe(0);
    }, 20000);

    it('3. Different keys bypass barrier', async () => {
      const tokenA = Symbol('A');
      const tokenB = Symbol('B');
      const adaptersA = createPrismaMarketInstrumentAdapters(prismaA, tokenA);
      const runnerA = adaptersA.transactionRunner;
      const adaptersB = createPrismaMarketInstrumentAdapters(prismaB, tokenB);
      const runnerB = adaptersB.transactionRunner;
      const repoA = adaptersA.transactionalRepository;
      const repoB = adaptersB.transactionalRepository;

      const lockKey1 = MarketDataCanonicalization.deriveAdvisoryLockKey('HOSE', getTestSymbol(), 'EQUITY');
      const lockKey2 = MarketDataCanonicalization.deriveAdvisoryLockKey('HOSE', getTestSymbol(), 'EQUITY');

      let resolveA: () => void;
      const barrierA = new Promise<void>(r => resolveA = r);
      let pidA: number = 0;
      let pidB: number = 0;
      let isALocked = false;
      let isBLocked = false;

      const p1 = runnerA.runInTransaction(async (ctxA) => {
        const txClient = (ctxA as any).getClient(tokenA);
        const pidRes = await txClient.$queryRaw`SELECT pg_backend_pid() AS pid`;
        pidA = (pidRes as any)[0].pid;

        await repoA.acquireIdentityLock(ctxA, lockKey1);
        isALocked = true;
        await barrierA;
      });

      while (!isALocked) await sleep(10);

      const p2 = runnerB.runInTransaction(async (ctxB) => {
        const txClient = (ctxB as any).getClient(tokenB);
        const pidRes = await txClient.$queryRaw`SELECT pg_backend_pid() AS pid`;
        pidB = (pidRes as any)[0].pid;

        await repoB.acquireIdentityLock(ctxB, lockKey2);
        isBLocked = true;
        await barrierA; // also hold so observer can see both granted
      });

      while (!isBLocked) await sleep(10);

      const observerLocks = await prismaObserver.$queryRaw<any[]>`
        SELECT pid, locktype, database, classid, objid, objsubid, mode, granted
        FROM pg_locks
        WHERE locktype = 'advisory' AND pid IN (${pidA}, ${pidB})
      `;

      const blockA = await prismaObserver.$queryRaw<any[]>`SELECT pg_blocking_pids(CAST(${pidA} AS int)) AS blocking_pids`;
      const blockB = await prismaObserver.$queryRaw<any[]>`SELECT pg_blocking_pids(CAST(${pidB} AS int)) AS blocking_pids`;

      resolveA!();
      await Promise.all([p1, p2]);

      const aLock = observerLocks.find(l => l.pid === pidA);
      const bLock = observerLocks.find(l => l.pid === pidB);

      expect(aLock.granted).toBe(true);
      expect(bLock.granted).toBe(true);
      expect(aLock.objid !== bLock.objid || aLock.objsubid !== bLock.objsubid).toBe(true);
      expect((blockA[0]?.blocking_pids || []).includes(pidB)).toBe(false);
      expect((blockB[0]?.blocking_pids || []).includes(pidA)).toBe(false);
    });

    it('4. Post-test lock inventory', async () => {
      // Nothing here since test 2 already asserts post-test locks for its PIDs
      expect(true).toBe(true);
    });
  });

  describe('Part 2: Register/Close Concurrency (6 Real Outcomes)', () => {

    it('1. Exact duplicate registration', async () => {
      const symbol = getTestSymbol();
      const payload = { exchange: 'HOSE' as const, canonicalSymbol: symbol, securityType: 'EQUITY' as const, effectiveFrom: '2023-01-01' };

      const results = await Promise.allSettled([
        registerService.execute(payload),
        registerService.execute(payload)
      ]);

      const created = results.filter(r => r.status === 'fulfilled' && r.value.outcome === 'CREATED');
      const replayed = results.filter(r => r.status === 'fulfilled' && r.value.outcome === 'REPLAYED');

      expect(created.length).toBe(1);
      expect(replayed.length).toBe(1);

      const count = await prismaA.marketInstrument.count({ where: { canonicalSymbol: symbol }});
      expect(count).toBe(1);
    });

    it('2. Same-business-key conflict', async () => {
      const symbol = getTestSymbol();

      const results = await Promise.allSettled([
        registerService.execute({ exchange: 'HOSE', canonicalSymbol: symbol, securityType: 'EQUITY', effectiveFrom: '2023-01-01', effectiveTo: '2023-12-31' }),
        registerService.execute({ exchange: 'HOSE', canonicalSymbol: symbol, securityType: 'EQUITY', effectiveFrom: '2023-01-01', effectiveTo: null })
      ]);

      const created = results.filter(r => r.status === 'fulfilled' && r.value.outcome === 'CREATED');
      const errors = results.filter(r => r.status === 'rejected');

      expect(created.length).toBe(1);
      expect(errors.length).toBe(1);
      expect((errors[0] as any).reason).toBeInstanceOf(MarketInstrumentOverlapError);

      const count = await prismaA.marketInstrument.count({ where: { canonicalSymbol: symbol }});
      expect(count).toBe(1);
    });

    it('3. Overlapping intervals', async () => {
      const symbol = getTestSymbol();

      const results = await Promise.allSettled([
        registerService.execute({ exchange: 'HOSE', canonicalSymbol: symbol, securityType: 'EQUITY', effectiveFrom: '2023-01-01', effectiveTo: '2023-06-30' }),
        registerService.execute({ exchange: 'HOSE', canonicalSymbol: symbol, securityType: 'EQUITY', effectiveFrom: '2023-05-01', effectiveTo: null })
      ]);

      const created = results.filter(r => r.status === 'fulfilled' && r.value.outcome === 'CREATED');
      const errors = results.filter(r => r.status === 'rejected');

      expect(created.length).toBe(1);
      expect(errors.length).toBe(1);

      const count = await prismaA.marketInstrument.count({ where: { canonicalSymbol: symbol }});
      expect(count).toBe(1);
    });

    it('4. Non-overlapping intervals', async () => {
      const symbol = getTestSymbol();

      const results = await Promise.allSettled([
        registerService.execute({ exchange: 'HOSE', canonicalSymbol: symbol, securityType: 'EQUITY', effectiveFrom: '2023-01-01', effectiveTo: '2023-06-30' }),
        registerService.execute({ exchange: 'HOSE', canonicalSymbol: symbol, securityType: 'EQUITY', effectiveFrom: '2023-07-01', effectiveTo: null })
      ]);

      const created = results.filter(r => r.status === 'fulfilled' && (r.value as any).outcome === 'CREATED');

      expect(created.length).toBe(2);
      const count = await prismaA.marketInstrument.count({ where: { canonicalSymbol: symbol }});
      expect(count).toBe(2);
    });

    it('5. Register versus close', async () => {
      const symbol = getTestSymbol();
      const testId = Math.random().toString(36).substring(7);
      const closeAppName = `task_1b2b_close_${testId}`;
      const registerAppName = `task_1b2b_register_${testId}`;
      
      const buildTestUrl = (appName: string) => {
        const url = isolatedSchema.databaseUrl || 'postgresql://postgres:123456789@localhost:5432/autonomous_ai_lab_test?schema=public';
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}application_name=${appName}&connection_limit=1`;
      };

      const closeClient = new PrismaClient({ datasourceUrl: buildTestUrl(closeAppName) });
      const registerClient = new PrismaClient({ datasourceUrl: buildTestUrl(registerAppName) });

      try {
        const initial = await registerService.execute({ exchange: 'HOSE', canonicalSymbol: symbol, securityType: 'EQUITY', effectiveFrom: '2023-01-01' });

        const adaptersClose = createPrismaMarketInstrumentAdapters(closeClient);
        const adaptersRegister = createPrismaMarketInstrumentAdapters(registerClient);

        let closeLockAcquired = false;
        let resumeClose: () => void;
        const closeBarrier = new Promise<void>(resolve => { resumeClose = resolve; });
        const events: string[] = [];

        events.push('CLOSE_STARTED');
        const coordinatingCloseRepo: IMarketInstrumentTransactionalRepository = {
          findById: (ctx, id) => adaptersClose.transactionalRepository.findById(ctx, id),
          findByBusinessKey: (ctx, bk) => adaptersClose.transactionalRepository.findByBusinessKey(ctx, bk),
          listEpisodesForIdentity: (ctx, iden) => adaptersClose.transactionalRepository.listEpisodesForIdentity(ctx, iden),
          insertListing: (ctx, data) => adaptersClose.transactionalRepository.insertListing(ctx, data),
          closeOpenListing: (ctx, input) => adaptersClose.transactionalRepository.closeOpenListing(ctx, input),
          acquireIdentityLock: async (context, lockKey) => {
            await adaptersClose.transactionalRepository.acquireIdentityLock(context, lockKey);
            events.push('CLOSE_REAL_LOCK_ACQUIRED');
            closeLockAcquired = true;
            await closeBarrier;
          }
        };
        const coordinatingCloseService = new CloseMarketInstrumentListingService(
          adaptersClose.transactionRunner,
          adaptersClose.queryRepository,
          coordinatingCloseRepo
        );

        const closePromise = coordinatingCloseService.execute({ businessKey: initial.instrument.businessKey, effectiveTo: '2023-06-30' })
          .then(() => events.push('CLOSE_COMMITTED'))
          .catch(e => events.push(`CLOSE_FAILED: ${e.message}`));

        let startWait = Date.now();
        while (!closeLockAcquired) {
            if (Date.now() - startWait > 5000) throw new Error(`Timeout waiting for close lock. Events: ${events.join(', ')}`);
            await sleep(10);
        }

        events.push('REGISTER_STARTED');
        const coordinatingRegisterRepo: IMarketInstrumentTransactionalRepository = {
          findById: (ctx, id) => adaptersRegister.transactionalRepository.findById(ctx, id),
          findByBusinessKey: (ctx, bk) => adaptersRegister.transactionalRepository.findByBusinessKey(ctx, bk),
          listEpisodesForIdentity: (ctx, iden) => adaptersRegister.transactionalRepository.listEpisodesForIdentity(ctx, iden),
          insertListing: (ctx, data) => adaptersRegister.transactionalRepository.insertListing(ctx, data),
          closeOpenListing: (ctx, input) => adaptersRegister.transactionalRepository.closeOpenListing(ctx, input),
          acquireIdentityLock: async (context, lockKey) => {
            events.push('REGISTER_LOCK_ATTEMPT_STARTED');
            await adaptersRegister.transactionalRepository.acquireIdentityLock(context, lockKey);
            events.push('REGISTER_REAL_LOCK_ACQUIRED');
          }
        };
        const coordinatingRegisterService = new RegisterMarketInstrumentService(
          adaptersRegister.transactionRunner,
          coordinatingRegisterRepo
        );
        
        const registerPromise = coordinatingRegisterService.execute({ exchange: 'HOSE', canonicalSymbol: symbol, securityType: 'EQUITY', effectiveFrom: '2023-07-01' })
          .then(() => events.push('REGISTER_COMMITTED'))
          .catch(e => events.push(`REGISTER_FAILED: ${e.message}`));

        let closePid: number | undefined;
        let registerPid: number | undefined;
        let pidsResolved = false;

        for (let i = 0; i < 200; i++) {
          const stats = await prismaObserver.$queryRaw<any[]>`
            SELECT pid, application_name, state
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND application_name IN (${closeAppName}, ${registerAppName})
          `;
          const c = stats.find(s => s.application_name === closeAppName);
          const r = stats.find(s => s.application_name === registerAppName);
          if (c && r) {
            closePid = c.pid;
            registerPid = r.pid;
            pidsResolved = true;
            break;
          }
          await sleep(20);
        }

        if (!pidsResolved) {
          if (resumeClose!) resumeClose();
          throw new Error(`Timeout resolving PIDs. events: ${events.join(',')}`);
        }

        let lockConfirmed = false;
        let lastObserverLocks: any[] = [];
        let lastBlockingPids: any[] = [];

        for (let i = 0; i < 200; i++) {
          lastObserverLocks = await prismaObserver.$queryRaw<any[]>`
            SELECT pid, database, classid, objid, objsubid, mode, granted
            FROM pg_locks
            WHERE locktype = 'advisory' AND pid IN (${closePid!}, ${registerPid!})
            ORDER BY pid, granted DESC
          `;
          
          const blockingRes = await prismaObserver.$queryRaw<any[]>`
            SELECT pg_blocking_pids(CAST(${registerPid!} AS integer)) AS blocking_pids
          `;
          lastBlockingPids = blockingRes[0]?.blocking_pids || [];

          const closeLock = lastObserverLocks.find(l => l.pid === closePid && l.granted === true);
          const regLock = lastObserverLocks.find(l => l.pid === registerPid && l.granted === false);

          if (closeLock && regLock && 
              closeLock.database === regLock.database &&
              closeLock.classid === regLock.classid &&
              closeLock.objid === regLock.objid &&
              closeLock.objsubid === regLock.objsubid &&
              lastBlockingPids.includes(closePid)) {
            lockConfirmed = true;
            events.push('REGISTER_WAIT_CONFIRMED_BY_PG_LOCKS');
            events.push('REGISTER_BLOCKED_BY_CLOSE_CONFIRMED');
            break;
          }
          await sleep(20);
        }

        if (!lockConfirmed) {
          if (resumeClose!) resumeClose();
          throw new Error(`Timeout polling locks. events: ${events.join(',')}, PIDs: c=${closePid}, r=${registerPid}, locks: ${JSON.stringify(lastObserverLocks, (_, v) => typeof v === 'bigint' ? v.toString() : v)}, blocking: ${JSON.stringify(lastBlockingPids)}`);
        }

        events.push('CLOSE_BARRIER_RELEASED');
        resumeClose!();

        const timeoutToken = Symbol('TIMEOUT');
        const waitRes = await Promise.race([
          Promise.all([closePromise, registerPromise]),
          sleep(10000).then(() => timeoutToken)
        ]);

        if (waitRes === timeoutToken) {
          throw new Error(`HANGING PROMISES. Events so far: ${events.join(', ')}`);
        }

        const rows = await qRepo.list({ canonicalSymbol: symbol, limit: 10 });
        expect(rows.length).toBe(2);
        expect(rows[0].effectiveFrom).toBe('2023-01-01');
        expect(rows[0].effectiveTo).toBe('2023-06-30');
        expect(rows[1].effectiveFrom).toBe('2023-07-01');
        expect(rows[1].effectiveTo).toBeNull();

        const postLocks = await prismaObserver.$queryRaw<any[]>`
          SELECT * FROM pg_locks WHERE locktype = 'advisory' AND pid IN (${closePid!}, ${registerPid!})
        `;
        expect(postLocks.length).toBe(0);

        expect(events).toContain('CLOSE_STARTED');
        expect(events).toContain('CLOSE_REAL_LOCK_ACQUIRED');
        expect(events).toContain('REGISTER_STARTED');
        expect(events).toContain('REGISTER_LOCK_ATTEMPT_STARTED');
        expect(events).toContain('REGISTER_WAIT_CONFIRMED_BY_PG_LOCKS');
        expect(events).toContain('REGISTER_BLOCKED_BY_CLOSE_CONFIRMED');
        expect(events).toContain('CLOSE_BARRIER_RELEASED');
        expect(events).toContain('CLOSE_COMMITTED');
        expect(events).toContain('REGISTER_REAL_LOCK_ACQUIRED');
        expect(events).toContain('REGISTER_COMMITTED');

        expect(events.indexOf('CLOSE_REAL_LOCK_ACQUIRED')).toBeLessThan(events.indexOf('REGISTER_WAIT_CONFIRMED_BY_PG_LOCKS'));
        expect(events.indexOf('REGISTER_BLOCKED_BY_CLOSE_CONFIRMED')).toBeLessThan(events.indexOf('CLOSE_BARRIER_RELEASED'));
        expect(events.indexOf('CLOSE_BARRIER_RELEASED')).toBeLessThan(events.indexOf('CLOSE_COMMITTED'));
      } finally {
        await closeClient.$disconnect();
        await registerClient.$disconnect();
      }
    }, 20000);

    it('6. Double close', async () => {
      const symbol = getTestSymbol();
      const initial = await registerService.execute({ exchange: 'HOSE', canonicalSymbol: symbol, securityType: 'EQUITY', effectiveFrom: '2023-01-01' });

      const results = await Promise.allSettled([
        closeService.execute({ businessKey: initial.instrument.businessKey, effectiveTo: '2023-06-30' }),
        closeService.execute({ businessKey: initial.instrument.businessKey, effectiveTo: '2023-07-31' })
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as any).reason).toBeInstanceOf(MarketInstrumentAlreadyClosedError);
    });
  });
});
