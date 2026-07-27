import { MARKET_DATA_CONTRACT_VERSIONS, MarketExchange, SecurityType } from '../contracts/MarketDataContracts';
import { MarketDataValidation } from './MarketDataValidation';
import { MarketInstrumentInvalidError, MarketInstrumentOverlapError, MarketInstrumentAlreadyClosedError } from './MarketDataErrors';

export interface MarketInstrumentListing {
  id: string; // Database ID (UUID)
  businessKey: string;
  symbol: string; // Original symbol
  canonicalSymbol: string;
  exchange: MarketExchange;
  securityType: SecurityType;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // YYYY-MM-DD
}

export const MARKET_INSTRUMENT_BUSINESS_KEY_FORMAT = {
  contractVersion: MARKET_DATA_CONTRACT_VERSIONS.INSTRUMENT_BUSINESS_KEY,
  countryPrefix: "VN",
} as const;

export class MarketInstrumentDomain {
  /**
   * Generates the deterministic business key for an instrument listing.
   * Format: VN|{EXCHANGE}|{CANONICAL_SYMBOL}|{SECURITY_TYPE}|{YYYY-MM-DD}
   */
  static buildBusinessKey(exchange: MarketExchange, canonicalSymbol: string, securityType: SecurityType, effectiveFrom: string): string {
    const validCanonical = MarketDataValidation.normalizeSymbol(canonicalSymbol);
    const validEffectiveFrom = MarketDataValidation.normalizeDateOnly(effectiveFrom);

    return `${MARKET_INSTRUMENT_BUSINESS_KEY_FORMAT.countryPrefix}|${exchange}|${validCanonical}|${securityType}|${validEffectiveFrom}`;
  }

  /**
   * Checks if two closed or open-ended intervals overlap.
   * [newFrom, newTo] vs [existingFrom, existingTo]
   * null means open-ended.
   */
  static isOverlap(newFrom: string, newTo: string | null, existingFrom: string, existingTo: string | null): boolean {
    const nFrom = MarketDataValidation.normalizeDateOnly(newFrom);
    const nTo = newTo ? MarketDataValidation.normalizeDateOnly(newTo) : null;
    const eFrom = MarketDataValidation.normalizeDateOnly(existingFrom);
    const eTo = existingTo ? MarketDataValidation.normalizeDateOnly(existingTo) : null;

    if (nTo && nTo < nFrom) {
      throw new MarketInstrumentInvalidError('effectiveTo cannot be before effectiveFrom');
    }

    const condition1 = (nTo === null || nTo >= eFrom);
    const condition2 = (eTo === null || eTo >= nFrom);

    return condition1 && condition2;
  }

  /**
   * Validates closure of an instrument listing.
   */
  static validateClosure(effectiveFrom: string, existingEffectiveTo: string | null, closeDate: string): string {
    if (existingEffectiveTo !== null) {
      throw new MarketInstrumentAlreadyClosedError();
    }

    const validCloseDate = MarketDataValidation.normalizeDateOnly(closeDate);
    const validEffectiveFrom = MarketDataValidation.normalizeDateOnly(effectiveFrom);

    if (validCloseDate < validEffectiveFrom) {
      throw new MarketInstrumentInvalidError('Close date cannot be before effectiveFrom');
    }

    return validCloseDate;
  }
}
