import { Prisma } from '@prisma/client';
import { TradingCalendarTransactionContext } from '../../../application/ports/market-data/TradingCalendarPorts';

type CalendarContextState = {
  tx: Prisma.TransactionClient;
  ownerToken: symbol;
  active: boolean;
};

const contextMap = new WeakMap<TradingCalendarTransactionContext, CalendarContextState>();

export function createTradingCalendarContext(tx: Prisma.TransactionClient, ownerToken: symbol): TradingCalendarTransactionContext {
  const ctx = {} as TradingCalendarTransactionContext;
  contextMap.set(ctx, { tx, ownerToken, active: true });
  return ctx;
}

export function validateCalendarContext(ctx: TradingCalendarTransactionContext, ownerToken: symbol): Prisma.TransactionClient {
  const state = contextMap.get(ctx);
  if (!state) {
    throw new Error('Invalid context: fake or incompatible context provided.');
  }
  if (state.ownerToken !== ownerToken) {
    throw new Error('Invalid context: cross-family context provided.');
  }
  if (!state.active) {
    throw new Error('Transaction context has expired and cannot be used');
  }
  return state.tx;
}

export function deactivateCalendarContext(ctx: TradingCalendarTransactionContext): void {
  const state = contextMap.get(ctx);
  if (state) {
    state.active = false;
  }
}
