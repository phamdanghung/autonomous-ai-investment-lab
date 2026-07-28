import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterMarketInstrumentService } from '../../../../src/application/services/market-data/RegisterMarketInstrumentService';
import { IMarketInstrumentTransactionPort, IMarketInstrumentTransactionContext, MARKET_INSTRUMENT_TX_CONTEXT } from '../../../../src/application/ports/market-data/IMarketInstrumentTransactionPort';
import { IMarketInstrumentTransactionalRepository } from '../../../../src/application/ports/market-data/IMarketInstrumentTransactionalRepository';
import { MarketInstrumentOverlapError, MarketInstrumentInvalidError, MarketDataIntegrityError } from '../../../../src/domain/market-data/MarketDataErrors';
import { MarketInstrumentDomain } from '../../../../src/domain/market-data/MarketInstrument';

const mockContext: IMarketInstrumentTransactionContext = { [MARKET_INSTRUMENT_TX_CONTEXT]: true };

class MockTxPort implements IMarketInstrumentTransactionPort {
  async runInTransaction<T>(work: (context: IMarketInstrumentTransactionContext) => Promise<T>): Promise<T> {
    return work(mockContext);
  }
}

describe('RegisterMarketInstrumentService', () => {
  let txPort: MockTxPort;
  let repo: any;
  let service: RegisterMarketInstrumentService;

  beforeEach(() => {
    txPort = new MockTxPort();
    repo = {
      acquireIdentityLock: vi.fn().mockResolvedValue(undefined),
      findByBusinessKey: vi.fn().mockResolvedValue(null),
      listEpisodesForIdentity: vi.fn().mockResolvedValue([]),
      insertListing: vi.fn((ctx, data) => Promise.resolve({ outcome: 'CREATED', record: data as any })),
      closeOpenListing: vi.fn(),
      findById: vi.fn(),
    };
    service = new RegisterMarketInstrumentService(txPort, repo);
  });

  it('valid registration returns CREATED', async () => {
    repo.insertListing.mockResolvedValue({ outcome: 'CREATED', record: { id: '123' } });
    const res = await service.execute({
      exchange: 'HOSE',
      canonicalSymbol: 'VND',
      securityType: 'EQUITY',
      effectiveFrom: '2020-01-01'
    });
    expect(res.outcome).toBe('CREATED');
    expect(repo.acquireIdentityLock).toHaveBeenCalled();
    expect(repo.insertListing).toHaveBeenCalled();
  });

  it('exact replay returns REPLAYED', async () => {
    repo.findByBusinessKey.mockResolvedValue({
      id: '123',
      effectiveTo: '2020-12-31'
    });
    const res = await service.execute({
      exchange: 'HOSE',
      canonicalSymbol: 'VND',
      securityType: 'EQUITY',
      effectiveFrom: '2020-01-01',
      effectiveTo: '2020-12-31'
    });
    expect(res.outcome).toBe('REPLAYED');
    expect(repo.insertListing).not.toHaveBeenCalled();
  });

  it('same business key/different payload rejects', async () => {
    repo.findByBusinessKey.mockResolvedValue({
      id: '123',
      effectiveTo: null // existing is open-ended
    });
    await expect(service.execute({
      exchange: 'HOSE',
      canonicalSymbol: 'VND',
      securityType: 'EQUITY',
      effectiveFrom: '2020-01-01',
      effectiveTo: '2020-12-31' // different
    })).rejects.toThrowError(MarketInstrumentOverlapError);
  });

  it('closed non-overlapping historical episode allowed', async () => {
    repo.listEpisodesForIdentity.mockResolvedValue([
      { effectiveFrom: '2019-01-01', effectiveTo: '2019-12-31' }
    ]);
    repo.insertListing.mockResolvedValue({ outcome: 'CREATED', record: { id: '123' } as any });
    const res = await service.execute({
      exchange: 'HOSE',
      canonicalSymbol: 'VND',
      securityType: 'EQUITY',
      effectiveFrom: '2020-01-01'
    });
    expect(res.outcome).toBe('CREATED');
  });

  it('closed overlapping episode rejected', async () => {
    repo.listEpisodesForIdentity.mockResolvedValue([
      { effectiveFrom: '2020-01-01', effectiveTo: '2020-06-30' }
    ]);
    await expect(service.execute({
      exchange: 'HOSE',
      canonicalSymbol: 'VND',
      securityType: 'EQUITY',
      effectiveFrom: '2020-05-01'
    })).rejects.toThrowError(MarketInstrumentOverlapError);
  });

  it('open-ended existing episode rejects future episode', async () => {
    repo.listEpisodesForIdentity.mockResolvedValue([
      { effectiveFrom: '2020-01-01', effectiveTo: null }
    ]);
    await expect(service.execute({
      exchange: 'HOSE',
      canonicalSymbol: 'VND',
      securityType: 'EQUITY',
      effectiveFrom: '2020-05-01'
    })).rejects.toThrowError(MarketInstrumentOverlapError);
  });

  it('touching boundary rejected', async () => {
    repo.listEpisodesForIdentity.mockResolvedValue([
      { effectiveFrom: '2020-01-01', effectiveTo: '2020-05-01' }
    ]);
    // overlaps because both use 2020-05-01
    await expect(service.execute({
      exchange: 'HOSE',
      canonicalSymbol: 'VND',
      securityType: 'EQUITY',
      effectiveFrom: '2020-05-01'
    })).rejects.toThrowError(MarketInstrumentOverlapError);
  });

  it('invalid symbol/date propagated safely', async () => {
    await expect(service.execute({
      exchange: 'HOSE',
      canonicalSymbol: 'V@ND', // invalid
      securityType: 'EQUITY',
      effectiveFrom: '2020-01-01'
    })).rejects.toThrowError(MarketInstrumentInvalidError);
  });

  it('transaction rollback on insert failure', async () => {
    repo.insertListing.mockRejectedValue(new MarketDataIntegrityError('DB ERROR'));
    await expect(service.execute({
      exchange: 'HOSE',
      canonicalSymbol: 'VND',
      securityType: 'EQUITY',
      effectiveFrom: '2020-01-01'
    })).rejects.toThrowError(MarketDataIntegrityError);
  });
});
