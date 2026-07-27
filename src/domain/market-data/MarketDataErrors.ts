import { DomainError } from '../errors/DomainErrors';

export class MarketDataDomainError extends DomainError {
  constructor(message: string, code: string, public readonly retryable: boolean = false) {
    super(message, code);
    this.name = 'MarketDataDomainError';
  }
}

// ----------------- INSTRUMENT ERRORS -----------------
export class MarketInstrumentInvalidError extends MarketDataDomainError {
  constructor(message: string = 'Market instrument contains invalid data.') {
    super(message, 'MARKET_INSTRUMENT_INVALID', false);
  }
}

export class MarketInstrumentOverlapError extends MarketDataDomainError {
  constructor(message: string = 'Instrument listing episode overlaps with an existing episode.') {
    super(message, 'MARKET_INSTRUMENT_OVERLAP', false);
  }
}

export class MarketInstrumentAlreadyClosedError extends MarketDataDomainError {
  constructor(message: string = 'Cannot close an already closed instrument episode.') {
    super(message, 'MARKET_INSTRUMENT_ALREADY_CLOSED', false);
  }
}

export class MarketInstrumentNotFoundError extends MarketDataDomainError {
  constructor(message: string = 'Market instrument not found.') {
    super(message, 'MARKET_INSTRUMENT_NOT_FOUND', false);
  }
}

// ----------------- SOURCE VERSION ERRORS -----------------
export class MarketSourceVersionInvalidError extends MarketDataDomainError {
  constructor(message: string = 'Market source version contains invalid data.') {
    super(message, 'MARKET_SOURCE_VERSION_INVALID', false);
  }
}

export class MarketSourceVersionConflictError extends MarketDataDomainError {
  constructor(message: string = 'Market source version key exists but payload is different.') {
    super(message, 'MARKET_SOURCE_VERSION_CONFLICT', false);
  }
}

export class MarketSourceVersionNotFoundError extends MarketDataDomainError {
  constructor(message: string = 'Market source version not found.') {
    super(message, 'MARKET_SOURCE_VERSION_NOT_FOUND', false);
  }
}

// ----------------- CALENDAR ERRORS -----------------
export class TradingCalendarConflictError extends MarketDataDomainError {
  constructor(message: string = 'Trading calendar day exists but payload is different.') {
    super(message, 'TRADING_CALENDAR_CONFLICT', false);
  }
}

export class TradingCalendarNotFoundError extends MarketDataDomainError {
  constructor(message: string = 'Trading calendar day not found.') {
    super(message, 'TRADING_CALENDAR_NOT_FOUND', false);
  }
}

// ----------------- IMPORT BATCH ERRORS -----------------
export class MarketImportInvalidError extends MarketDataDomainError {
  constructor(message: string = 'Market import batch contains invalid data.') {
    super(message, 'MARKET_IMPORT_INVALID', false);
  }
}

export class MarketImportIdempotencyConflictError extends MarketDataDomainError {
  constructor(message: string = 'Market import idempotency key reused with different request payload.') {
    super(message, 'MARKET_IMPORT_IDEMPOTENCY_CONFLICT', false);
  }
}

export class MarketImportBusinessKeyConflictError extends MarketDataDomainError {
  constructor(message: string = 'Market import batch business key conflicts with existing batch but idempotency key differs.') {
    super(message, 'MARKET_IMPORT_BUSINESS_KEY_CONFLICT', false);
  }
}

export class MarketImportInvalidTransitionError extends MarketDataDomainError {
  constructor(message: string = 'Invalid transition for market import batch lifecycle.') {
    super(message, 'MARKET_IMPORT_INVALID_TRANSITION', false);
  }
}

export class MarketImportNotFoundError extends MarketDataDomainError {
  constructor(message: string = 'Market import batch not found.') {
    super(message, 'MARKET_IMPORT_NOT_FOUND', false);
  }
}

// ----------------- GENERIC / SYSTEM ERRORS -----------------
export class MarketDataConcurrencyConflictError extends MarketDataDomainError {
  constructor(message: string = 'Optimistic concurrency locking failure.') {
    super(message, 'MARKET_DATA_CONCURRENCY_CONFLICT', true);
  }
}

export class MarketDataIntegrityError extends MarketDataDomainError {
  constructor(message: string = 'Market data integrity constraint violated.') {
    super(message, 'MARKET_DATA_INTEGRITY_ERROR', false);
  }
}
