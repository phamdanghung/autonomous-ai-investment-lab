import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloseMarketInstrumentListingService } from '../../../../src/application/services/market-data/CloseMarketInstrumentListingService';
import { IMarketInstrumentTransactionPort, IMarketInstrumentTransactionContext, MARKET_INSTRUMENT_TX_CONTEXT } from '../../../../src/application/ports/market-data/IMarketInstrumentTransactionPort';
import { MarketInstrumentNotFoundError, MarketInstrumentAlreadyClosedError, MarketInstrumentOverlapError, MarketInstrumentInvalidError } from '../../../../src/domain/market-data/MarketDataErrors';

const mockContext: IMarketInstrumentTransactionContext = { [MARKET_INSTRUMENT_TX_CONTEXT]: true };

class MockTxPort implements IMarketInstrumentTransactionPort {
  async runInTransaction<T>(work: (context: IMarketInstrumentTransactionContext) => Promise<T>): Promise<T> {
    return work(mockContext);
  }
}

describe('CloseMarketInstrumentListingService', () => {
  let txPort: MockTxPort;
  let qRepo: any;
  let txRepo: any;
  let service: CloseMarketInstrumentListingService;

  beforeEach(() => {
    txPort = new MockTxPort();
    qRepo = {};
    txRepo = {
      acquireIdentityLock: vi.fn().mockResolvedValue(undefined),
      findByBusinessKey: vi.fn(),
      listEpisodesForIdentity: vi.fn().mockResolvedValue([]),
      closeOpenListing: vi.fn()
    };
    service = new CloseMarketInstrumentListingService(txPort, qRepo, txRepo);
  });

  it('open episode closes successfully', async () => {
    txRepo.findByBusinessKey.mockResolvedValue({
      id: '123',
      exchange: 'HOSE',
      canonicalSymbol: 'VND',
      securityType: 'EQUITY',
      effectiveFrom: '2020-01-01',
      effectiveTo: null
    });
    txRepo.closeOpenListing.mockResolvedValue({ id: '123', effectiveTo: '2020-05-01' });

    const res = await service.execute({ businessKey: 'BK', effectiveTo: '2020-05-01' });

    expect(res.effectiveTo).toBe('2020-05-01');
    expect(txRepo.acquireIdentityLock).toHaveBeenCalled();
    expect(txRepo.closeOpenListing).toHaveBeenCalledWith(mockContext, { id: '123', effectiveTo: '2020-05-01' });
  });

  it('already closed rejects', async () => {
    txRepo.findByBusinessKey.mockResolvedValue({
      id: '123',
      effectiveFrom: '2020-01-01',
      effectiveTo: '2020-03-01'
    });

    await expect(service.execute({ businessKey: 'BK', effectiveTo: '2020-05-01' }))
      .rejects.toThrowError(MarketInstrumentAlreadyClosedError);
  });

  it('missing listing rejects', async () => {
    txRepo.findByBusinessKey.mockResolvedValue(null);

    await expect(service.execute({ businessKey: 'BK', effectiveTo: '2020-05-01' }))
      .rejects.toThrowError(MarketInstrumentNotFoundError);
  });

  it('date before effectiveFrom rejects', async () => {
    txRepo.findByBusinessKey.mockResolvedValue({
      id: '123',
      effectiveFrom: '2020-05-01',
      effectiveTo: null
    });

    await expect(service.execute({ businessKey: 'BK', effectiveTo: '2020-01-01' }))
      .rejects.toThrowError(MarketInstrumentInvalidError);
  });

  it('close date before next episode allowed', async () => {
    txRepo.findByBusinessKey.mockResolvedValue({
      id: '123',
      effectiveFrom: '2020-01-01',
      effectiveTo: null
    });
    txRepo.listEpisodesForIdentity.mockResolvedValue([
      { effectiveFrom: '2020-01-01', effectiveTo: null }, // Self
      { effectiveFrom: '2021-01-01', effectiveTo: null }  // Next
    ]);
    txRepo.closeOpenListing.mockResolvedValue({ id: '123' });

    await expect(service.execute({ businessKey: 'BK', effectiveTo: '2020-06-01' }))
      .resolves.toBeDefined();
  });

  it('close date equal next start rejected', async () => {
    txRepo.findByBusinessKey.mockResolvedValue({
      id: '123',
      effectiveFrom: '2020-01-01',
      effectiveTo: null
    });
    txRepo.listEpisodesForIdentity.mockResolvedValue([
      { effectiveFrom: '2020-01-01', effectiveTo: null }, // Self
      { effectiveFrom: '2021-01-01', effectiveTo: null }  // Next
    ]);

    await expect(service.execute({ businessKey: 'BK', effectiveTo: '2021-01-01' }))
      .rejects.toThrowError(MarketInstrumentOverlapError);
  });

  it('close date after next start rejected', async () => {
    txRepo.findByBusinessKey.mockResolvedValue({
      id: '123',
      effectiveFrom: '2020-01-01',
      effectiveTo: null
    });
    txRepo.listEpisodesForIdentity.mockResolvedValue([
      { effectiveFrom: '2020-01-01', effectiveTo: null }, // Self
      { effectiveFrom: '2021-01-01', effectiveTo: null }  // Next
    ]);

    await expect(service.execute({ businessKey: 'BK', effectiveTo: '2022-01-01' }))
      .rejects.toThrowError(MarketInstrumentOverlapError);
  });

  it('conditional-update race classified correctly', async () => {
    txRepo.findByBusinessKey.mockResolvedValue({
      id: '123',
      effectiveFrom: '2020-01-01',
      effectiveTo: null
    });
    txRepo.closeOpenListing.mockResolvedValue(null); // Simulated race condition failure

    await expect(service.execute({ businessKey: 'BK', effectiveTo: '2020-05-01' }))
      .rejects.toThrowError(MarketInstrumentNotFoundError); // We map null to NotFoundError indicating concurrent modification
  });
});
