export const MARKET_INSTRUMENT_TX_CONTEXT = Symbol('MARKET_INSTRUMENT_TX_CONTEXT');

export interface IMarketInstrumentTransactionContext {
  readonly [MARKET_INSTRUMENT_TX_CONTEXT]: true;
}

export interface IMarketInstrumentTransactionPort {
  runInTransaction<T>(
    work: (context: IMarketInstrumentTransactionContext) => Promise<T>
  ): Promise<T>;
}
