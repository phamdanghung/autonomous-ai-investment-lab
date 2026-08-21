import { DomainError } from '../errors/DomainErrors';

export type MarketDataErrorCategory =
  | 'VALIDATION'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'BUSINESS_RULE'
  | 'SYSTEM_INTEGRITY'
  | 'CONCURRENCY';

export class MarketDataDomainError extends DomainError {
  constructor(
    message: string,
    code: string,
    public readonly safeMessage: string,
    public readonly category: MarketDataErrorCategory,
    public readonly retryable: boolean = false
  ) {
    super(message, code);
    this.name = 'MarketDataDomainError';
  }
}

// ----------------- DAILY MARKET BAR ERRORS -----------------
export class DailyMarketBarInvalidError extends MarketDataDomainError {
  constructor(message: string = 'Daily market bar contains invalid data.') {
    super(message, 'DAILY_MARKET_BAR_INVALID', 'The provided daily market bar is invalid.', 'VALIDATION', false);
  }
}


// ----------------- INSTRUMENT ERRORS -----------------
export class MarketInstrumentInvalidError extends MarketDataDomainError {
  constructor(message: string = 'Market instrument contains invalid data.') {
    super(message, 'MARKET_INSTRUMENT_INVALID', 'The provided market instrument is invalid.', 'VALIDATION', false);
  }
}

export class MarketInstrumentOverlapError extends MarketDataDomainError {
  constructor(message: string = 'Instrument listing episode overlaps with an existing episode.') {
    super(message, 'MARKET_INSTRUMENT_OVERLAP', 'Instrument listing dates conflict with existing records.', 'CONFLICT', false);
  }
}

export class MarketInstrumentAlreadyClosedError extends MarketDataDomainError {
  constructor(message: string = 'Cannot close an already closed instrument episode.') {
    super(message, 'MARKET_INSTRUMENT_ALREADY_CLOSED', 'This instrument episode has already been closed.', 'BUSINESS_RULE', false);
  }
}

export class MarketInstrumentNotFoundError extends MarketDataDomainError {
  constructor(message: string = 'Market instrument not found.') {
    super(message, 'MARKET_INSTRUMENT_NOT_FOUND', 'The requested market instrument could not be found.', 'NOT_FOUND', false);
  }
}

// ----------------- SOURCE VERSION ERRORS -----------------
export class MarketSourceVersionInvalidError extends MarketDataDomainError {
  constructor(message: string = 'Market source version contains invalid data.') {
    super(message, 'MARKET_SOURCE_VERSION_INVALID', 'The provided source version is invalid.', 'VALIDATION', false);
  }
}

export class MarketSourceVersionConflictError extends MarketDataDomainError {
  constructor(message: string = 'Market source version key exists but payload is different.') {
    super(message, 'MARKET_SOURCE_VERSION_CONFLICT', 'A conflicting source version already exists.', 'CONFLICT', false);
  }
}

export class MarketSourceVersionNotFoundError extends MarketDataDomainError {
  constructor(message: string = 'Market source version not found.') {
    super(message, 'MARKET_SOURCE_VERSION_NOT_FOUND', 'The requested source version could not be found.', 'NOT_FOUND', false);
  }
}

// ----------------- CALENDAR ERRORS -----------------
export class TradingCalendarInvalidError extends MarketDataDomainError {
  constructor(message: string = 'Trading calendar day contains invalid data.') {
    super(
      message,
      'TRADING_CALENDAR_INVALID',
      'The provided trading calendar day is invalid.',
      'VALIDATION',
      false
    );
  }
}

export class TradingCalendarConflictError extends MarketDataDomainError {
  constructor(message: string = 'Trading calendar day exists but payload is different.') {
    super(message, 'TRADING_CALENDAR_CONFLICT', 'A conflicting trading calendar day already exists.', 'CONFLICT', false);
  }
}

export class TradingCalendarNotFoundError extends MarketDataDomainError {
  constructor(message: string = 'Trading calendar day not found.') {
    super(message, 'TRADING_CALENDAR_NOT_FOUND', 'The requested trading calendar day could not be found.', 'NOT_FOUND', false);
  }
}

// ----------------- IMPORT BATCH ERRORS -----------------
export class MarketImportInvalidError extends MarketDataDomainError {
  constructor(message: string = 'Market import batch contains invalid data.') {
    super(message, 'MARKET_IMPORT_INVALID', 'The provided import batch data is invalid.', 'VALIDATION', false);
  }
}

export class MarketImportIdempotencyConflictError extends MarketDataDomainError {
  constructor(message: string = 'Market import idempotency key reused with different request payload.') {
    super(message, 'MARKET_IMPORT_IDEMPOTENCY_CONFLICT', 'This request has already been processed with different data.', 'CONFLICT', false);
  }
}

export class MarketImportBusinessKeyConflictError extends MarketDataDomainError {
  constructor(message: string = 'Market import batch business key conflicts with existing batch but idempotency key differs.') {
    super(message, 'MARKET_IMPORT_BUSINESS_KEY_CONFLICT', 'A conflicting import batch already exists.', 'CONFLICT', false);
  }
}

export class MarketImportInvalidTransitionError extends MarketDataDomainError {
  constructor(message: string = 'Invalid transition for market import batch lifecycle.') {
    super(message, 'MARKET_IMPORT_INVALID_TRANSITION', 'The requested batch operation is invalid for its current state.', 'BUSINESS_RULE', false);
  }
}

export class MarketImportNotFoundError extends MarketDataDomainError {
  constructor(message: string = 'Market import batch not found.') {
    super(message, 'MARKET_IMPORT_NOT_FOUND', 'The requested import batch could not be found.', 'NOT_FOUND', false);
  }
}

// ----------------- DATASET SNAPSHOT ERRORS -----------------
export class DatasetSnapshotInvalidError extends MarketDataDomainError {
  constructor(message: string = 'Dataset snapshot contains invalid data.') {
    super(message, 'DATASET_SNAPSHOT_INVALID', 'The provided dataset snapshot data is invalid.', 'VALIDATION', false);
  }
}

export class DatasetSnapshotInvalidTransitionError extends MarketDataDomainError {
  constructor(message: string = 'Invalid DatasetSnapshot lifecycle transition.') {
    super(message, 'DATASET_SNAPSHOT_INVALID_TRANSITION', 'The requested dataset snapshot operation is invalid for its current state.', 'BUSINESS_RULE', false);
  }
}

// ----------------- GENERIC / SYSTEM ERRORS -----------------
const MARKET_DATA_CONCURRENCY_MESSAGE = 'Concurrent market-data operation conflict.';

export class MarketDataConcurrencyConflictError extends MarketDataDomainError {
  constructor() {
    super(
      MARKET_DATA_CONCURRENCY_MESSAGE,
      'MARKET_DATA_CONCURRENCY_CONFLICT',
      MARKET_DATA_CONCURRENCY_MESSAGE,
      'CONCURRENCY',
      true
    );
  }
}

export class MarketDataIntegrityError extends MarketDataDomainError {
  constructor(message: string = 'Market data integrity constraint violated.') {
    super(message, 'MARKET_DATA_INTEGRITY_ERROR', 'A data integrity error occurred.', 'SYSTEM_INTEGRITY', false);
  }
}
