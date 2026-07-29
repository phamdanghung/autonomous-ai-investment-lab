import { IMarketDataSourceContext } from '../../../application/ports/market-data/MarketDataSourcePorts';
import { Prisma } from '@prisma/client';

type ContextState = {
  tx: Prisma.TransactionClient;
  ownerToken: symbol;
  active: boolean;
};

const contextMap = new WeakMap<IMarketDataSourceContext, ContextState>();

export function createMarketDataSourceContext(tx: Prisma.TransactionClient, ownerToken: symbol): IMarketDataSourceContext {
  const ctx = {} as IMarketDataSourceContext;
  contextMap.set(ctx, { tx, ownerToken, active: true });
  return ctx;
}

export function validateAndGetTx(ctx: IMarketDataSourceContext, ownerToken: symbol): Prisma.TransactionClient {
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

export function deactivateContext(ctx: IMarketDataSourceContext): void {
  const state = contextMap.get(ctx);
  if (state) {
    state.active = false;
  }
}
