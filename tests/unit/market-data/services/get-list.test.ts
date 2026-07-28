import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetMarketInstrumentService } from '../../../../src/application/services/market-data/GetMarketInstrumentService';
import { ListMarketInstrumentsService } from '../../../../src/application/services/market-data/ListMarketInstrumentsService';
import { MarketInstrumentCursor } from '../../../../src/application/services/market-data/MarketInstrumentCursor';
import { MarketInstrumentNotFoundError, MarketInstrumentInvalidError } from '../../../../src/domain/market-data/MarketDataErrors';

describe('GetMarketInstrumentService', () => {
  let qRepo: any;
  let getService: GetMarketInstrumentService;

  beforeEach(() => {
    qRepo = {
      findById: vi.fn(),
      findByBusinessKey: vi.fn(),
      list: vi.fn(),
    };
    getService = new GetMarketInstrumentService(qRepo);
  });

  it('lookup by ID', async () => {
    qRepo.findById.mockResolvedValue({ id: '123' });
    const res = await getService.execute({ id: '123' });
    expect(res.id).toBe('123');
    expect(qRepo.findById).toHaveBeenCalledWith('123');
  });

  it('lookup by business key', async () => {
    qRepo.findByBusinessKey.mockResolvedValue({ id: '123' });
    const res = await getService.execute({ businessKey: 'BK' });
    expect(res.id).toBe('123');
    expect(qRepo.findByBusinessKey).toHaveBeenCalledWith('BK');
  });

  it('invalid lookup shape rejected (both)', async () => {
    await expect(getService.execute({ id: '123', businessKey: 'BK' }))
      .rejects.toThrowError(MarketInstrumentInvalidError);
  });

  it('invalid lookup shape rejected (neither)', async () => {
    await expect(getService.execute({}))
      .rejects.toThrowError(MarketInstrumentInvalidError);
  });

  it('not found throws', async () => {
    qRepo.findById.mockResolvedValue(null);
    await expect(getService.execute({ id: '123' }))
      .rejects.toThrowError(MarketInstrumentNotFoundError);
  });
});

describe('ListMarketInstrumentsService', () => {
  let qRepo: any;
  let listService: ListMarketInstrumentsService;

  beforeEach(() => {
    qRepo = {
      list: vi.fn(),
    };
    listService = new ListMarketInstrumentsService(qRepo);
  });

  it('list requests limit + 1 and handles no next page', async () => {
    qRepo.list.mockResolvedValue([
      { id: '1' }, { id: '2' }
    ]);
    const res = await listService.execute({ limit: 10 });
    expect(qRepo.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 11 }));
    expect(res.items.length).toBe(2);
    expect(res.nextCursor).toBeNull();
  });

  it('list handles next page by popping limit + 1', async () => {
    qRepo.list.mockResolvedValue([
      { id: '1' },
      { id: '22222222-2222-2222-2222-222222222222', exchange: 'HOSE', canonicalSymbol: 'VND', securityType: 'EQUITY', effectiveFrom: '2020-01-01' },
      { id: '12345678-1234-1234-1234-123456789012', exchange: 'HOSE', canonicalSymbol: 'VND', securityType: 'EQUITY', effectiveFrom: '2020-02-01' }
    ]);
    const res = await listService.execute({ limit: 2 });
    expect(res.items.length).toBe(2); // The 3rd item is popped
    expect(res.nextCursor).toBeDefined();

    const cursor = MarketInstrumentCursor.decode(res.nextCursor!);
    expect(cursor.id).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('maximum page size enforced', async () => {
    qRepo.list.mockResolvedValue([]);
    await listService.execute({ limit: 200 }); // exceeding 100
    expect(qRepo.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 101 })); // max 100 + 1
  });

  it('cursor round-trip', () => {
    const original = {
      version: 1 as const,
      exchange: 'HOSE' as const,
      canonicalSymbol: 'VND',
      securityType: 'EQUITY' as const,
      effectiveFrom: '2020-01-01',
      id: 'd9e03f56-62b1-4f18-bb9f-8557b7705cc6',
    };
    const encoded = MarketInstrumentCursor.encode(original);
    const decoded = MarketInstrumentCursor.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('invalid cursor rejected - comprehensive matrix', () => {
    const make = (payload: any) => Buffer.from(JSON.stringify(payload)).toString('base64url');
    const valid = { version: 1, exchange: 'HOSE', canonicalSymbol: 'VND', securityType: 'EQUITY', effectiveFrom: '2020-01-01', id: 'd9e03f56-62b1-4f18-bb9f-8557b7705cc6' };

    // malformed base64url
    expect(() => MarketInstrumentCursor.decode('not-base64@!#')).toThrowError(MarketInstrumentInvalidError);
    // invalid JSON
    expect(() => MarketInstrumentCursor.decode(Buffer.from('{"version":').toString('base64url'))).toThrowError(MarketInstrumentInvalidError);
    // unknown version
    expect(() => MarketInstrumentCursor.decode(make({ ...valid, version: 2 }))).toThrowError(MarketInstrumentInvalidError);
    // missing field
    expect(() => MarketInstrumentCursor.decode(make({ version: 1, exchange: 'HOSE', canonicalSymbol: 'VND', securityType: 'EQUITY', effectiveFrom: '2020-01-01' }))).toThrowError(MarketInstrumentInvalidError);
    // extra field
    expect(() => MarketInstrumentCursor.decode(make({ ...valid, extra: 'foo' }))).toThrowError(MarketInstrumentInvalidError);
    // invalid exchange
    expect(() => MarketInstrumentCursor.decode(make({ ...valid, exchange: 'NYSE' }))).toThrowError(MarketInstrumentInvalidError);
    // invalid securityType
    expect(() => MarketInstrumentCursor.decode(make({ ...valid, securityType: 'BOND' }))).toThrowError(MarketInstrumentInvalidError);
    // invalid canonicalSymbol
    expect(() => MarketInstrumentCursor.decode(make({ ...valid, canonicalSymbol: ' ' }))).toThrowError(MarketInstrumentInvalidError);
    // invalid effectiveFrom
    expect(() => MarketInstrumentCursor.decode(make({ ...valid, effectiveFrom: '2020-13-01' }))).toThrowError(MarketInstrumentInvalidError);
    // invalid id (not UUID)
    expect(() => MarketInstrumentCursor.decode(make({ ...valid, id: '123' }))).toThrowError(MarketInstrumentInvalidError);
    // oversized cursor
    const giantCursor = Buffer.alloc(1025, 'a').toString('base64url');
    expect(() => MarketInstrumentCursor.decode(giantCursor)).toThrowError(MarketInstrumentInvalidError);
  });
});
