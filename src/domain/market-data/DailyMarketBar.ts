import { MARKET_DATA_CONTRACT_VERSIONS, CanonicalDailyBarPayload, MarketBarKind, MarketQualityDecision, MARKET_EXCHANGES, MarketExchange, SecurityType } from '../contracts/MarketDataContracts';
import { DailyMarketBarInvalidError } from './MarketDataErrors';
import { MarketDataValidation } from './MarketDataValidation';
import { MarketInstrumentDomain } from './MarketInstrument';
import { MarketDataCanonicalization } from './MarketDataCanonicalization';

export interface DailyMarketBar {
  id: string;
  sourceVersionId: string;
  importBatchId: string;
  sourceRecordKey: string;
  instrumentId: string;
  marketDate: string;
  barKind: MarketBarKind;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  volume: string;
  tradingValue: string | null;
  correctionVersion: number;
  supersedesBarId: string | null;
  qualityDecision: MarketQualityDecision;
  qualityFlags: string;
  sourceRowHash: string;
  canonicalHash: string;
}

export class DailyMarketBarDomain {
  static validateCanonicalInput(input: Omit<CanonicalDailyBarPayload, 'barContractVersion'>): void {
    // 1. Structural Validations
    this.validateSourceVersionKey(input.sourceVersionKey);
    this.validateSourceRecordKey(input.sourceRecordKey);
    this.validateInstrumentBusinessKey(input.instrumentBusinessKey);
    this.validateMarketDate(input.marketDate);
    this.validateBarKind(input.barKind);
    this.validateQualityDecision(input.qualityDecision);
    this.validateQualityFlags(input.qualityFlags);
    this.validateSourceRowHash(input.sourceRowHash);
    this.validateCorrectionRelationship(input.correctionVersion, input.supersedesBarHash);
    
    // Validate numerical string formats
    this.validateDecimalStringOptional('open', input.open);
    this.validateDecimalStringOptional('high', input.high);
    this.validateDecimalStringOptional('low', input.low);
    this.validateDecimalStringOptional('close', input.close);
    this.validateDecimalString('volume', input.volume);
    this.validateDecimalStringOptional('tradingValue', input.tradingValue);

    // 2. Financial Quality Validations (Skipped for QUARANTINED)
    if (input.qualityDecision === 'ACCEPTED' || input.qualityDecision === 'ACCEPTED_WITH_FLAGS') {
      if (input.barKind === 'TRADED') {
        this.validateAcceptedTraded(input);
      } else if (input.barKind === 'NO_TRADE' || input.barKind === 'SUSPENDED') {
        this.validateAcceptedNoTradeOrSuspended(input);
      }
    }
  }

  static buildCanonicalHash(input: Omit<CanonicalDailyBarPayload, 'barContractVersion'>): { payload: CanonicalDailyBarPayload; hash: string } {
    this.validateCanonicalInput(input);
    
    const payload: CanonicalDailyBarPayload = {
      barContractVersion: MARKET_DATA_CONTRACT_VERSIONS.DAILY_BAR,
      sourceVersionKey: input.sourceVersionKey,
      sourceRecordKey: input.sourceRecordKey,
      instrumentBusinessKey: input.instrumentBusinessKey,
      marketDate: input.marketDate,
      barKind: input.barKind,
      open: input.open,
      high: input.high,
      low: input.low,
      close: input.close,
      volume: input.volume,
      tradingValue: input.tradingValue,
      correctionVersion: input.correctionVersion,
      qualityDecision: input.qualityDecision,
      qualityFlags: input.qualityFlags,
      sourceRowHash: input.sourceRowHash,
      supersedesBarHash: input.supersedesBarHash,
    };

    const hash = MarketDataCanonicalization.hashPayload(payload);
    return { payload, hash };
  }

  private static validateSourceVersionKey(key: string): void {
    if (typeof key !== 'string' || !/^VN\|MARKET_DATA_SOURCE\|[a-f0-9]{64}$/.test(key)) {
      throw new DailyMarketBarInvalidError('Invalid sourceVersionKey');
    }
  }

  private static validateSourceRecordKey(key: string): void {
    if (typeof key !== 'string' || key.length === 0 || key.trim() !== key) {
      throw new DailyMarketBarInvalidError('Invalid sourceRecordKey');
    }
  }

  private static validateInstrumentBusinessKey(key: string): void {
    try {
      const parts = key.split('|');
      if (parts.length !== 5 || parts[0] !== 'VN' || parts[3] !== 'EQUITY') {
        throw new DailyMarketBarInvalidError('Invalid instrumentBusinessKey format');
      }
      const exchangeStr = parts[1];
      const foundExchange = MARKET_EXCHANGES.find(e => e === exchangeStr);
      if (foundExchange === undefined) {
        throw new DailyMarketBarInvalidError('Invalid exchange in instrumentBusinessKey');
      }
      
      const expected = MarketInstrumentDomain.buildBusinessKey(foundExchange, parts[2], 'EQUITY', parts[4]);
      if (expected !== key) {
        throw new DailyMarketBarInvalidError('instrumentBusinessKey is not canonical');
      }
    } catch (e) {
      if (e instanceof DailyMarketBarInvalidError) throw e;
      throw new DailyMarketBarInvalidError('Invalid instrumentBusinessKey');
    }
  }

  private static validateMarketDate(date: string): void {
    try {
      const canonical = MarketDataValidation.normalizeDateOnly(date);
      if (canonical !== date) {
         throw new DailyMarketBarInvalidError('marketDate is not canonical');
      }
    } catch (e) {
      throw new DailyMarketBarInvalidError('Invalid marketDate');
    }
  }

  private static validateBarKind(kind: string): void {
    if (kind !== 'TRADED' && kind !== 'NO_TRADE' && kind !== 'SUSPENDED') {
      throw new DailyMarketBarInvalidError('Invalid barKind');
    }
  }

  private static validateQualityDecision(decision: string): void {
    if (decision !== 'ACCEPTED' && decision !== 'ACCEPTED_WITH_FLAGS' && decision !== 'QUARANTINED') {
      throw new DailyMarketBarInvalidError('Invalid qualityDecision');
    }
  }

  private static validateQualityFlags(flags: unknown): void {
    if (typeof flags !== 'string') {
      throw new DailyMarketBarInvalidError('qualityFlags must be a string');
    }
  }

  private static validateSourceRowHash(hash: string): void {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
      throw new DailyMarketBarInvalidError('Invalid sourceRowHash');
    }
  }

  private static validateCorrectionRelationship(version: unknown, supersedesHash: unknown): void {
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      throw new DailyMarketBarInvalidError('Invalid correctionVersion');
    }

    if (version === 0) {
      if (supersedesHash !== null) {
        throw new DailyMarketBarInvalidError('Initial bar cannot supersede another hash');
      }
    } else {
      if (typeof supersedesHash !== 'string' || !/^[a-f0-9]{64}$/.test(supersedesHash)) {
        throw new DailyMarketBarInvalidError('Correction bar requires a valid lowercase 64-hex supersedesBarHash');
      }
    }
  }

  private static validateDecimalString(name: string, value: unknown): void {
    if (typeof value !== 'string') {
      throw new DailyMarketBarInvalidError(`${name} must be a string`);
    }
    if (!/^(0|-?[1-9]\d*)$/.test(value)) {
      throw new DailyMarketBarInvalidError(`Invalid decimal string format for ${name}: ${value}`);
    }
  }

  private static validateDecimalStringOptional(name: string, value: unknown): void {
    if (value === null) return;
    this.validateDecimalString(name, value);
  }

  private static validateAcceptedTraded(input: Omit<CanonicalDailyBarPayload, 'barContractVersion'>): void {
    if (input.open === null || input.high === null || input.low === null || input.close === null) {
      throw new DailyMarketBarInvalidError('ACCEPTED TRADED bar must have all OHLC fields');
    }

    const open = BigInt(input.open);
    const high = BigInt(input.high);
    const low = BigInt(input.low);
    const close = BigInt(input.close);
    const volume = BigInt(input.volume);
    const tradingValue = input.tradingValue !== null ? BigInt(input.tradingValue) : null;

    if (open < 0n || high < 0n || low < 0n || close < 0n) {
      throw new DailyMarketBarInvalidError('ACCEPTED TRADED OHLC cannot be negative');
    }

    if (high < low) {
      throw new DailyMarketBarInvalidError('high cannot be less than low');
    }

    if (open < low || open > high) {
      throw new DailyMarketBarInvalidError('open must be between low and high');
    }

    if (close < low || close > high) {
      throw new DailyMarketBarInvalidError('close must be between low and high');
    }

    if (volume < 0n) {
      throw new DailyMarketBarInvalidError('volume cannot be negative');
    }

    if (tradingValue !== null && tradingValue < 0n) {
      throw new DailyMarketBarInvalidError('tradingValue cannot be negative');
    }
  }

  private static validateAcceptedNoTradeOrSuspended(input: Omit<CanonicalDailyBarPayload, 'barContractVersion'>): void {
    if (input.open !== null || input.high !== null || input.low !== null || input.close !== null) {
      throw new DailyMarketBarInvalidError(`ACCEPTED ${input.barKind} bar must have null OHLC`);
    }

    if (input.volume !== '0') {
      throw new DailyMarketBarInvalidError(`ACCEPTED ${input.barKind} volume must be exactly "0"`);
    }

    if (input.tradingValue !== null && input.tradingValue !== '0') {
      throw new DailyMarketBarInvalidError(`ACCEPTED ${input.barKind} tradingValue must be null or "0"`);
    }
  }
}
