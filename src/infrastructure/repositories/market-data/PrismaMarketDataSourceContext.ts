import { IMarketDataSourceContext } from '../../../application/ports/market-data/MarketDataSourcePorts';
import { Prisma } from '@prisma/client';

export class PrismaMarketDataSourceContext implements IMarketDataSourceContext {
  readonly _family: string;
  readonly _tx: Prisma.TransactionClient;
  private _active: boolean = true;

  constructor(family: string, tx: Prisma.TransactionClient) {
    this._family = family;
    this._tx = tx;
  }

  get tx(): Prisma.TransactionClient {
    if (!this._active) {
      throw new Error('Transaction context is inactive.');
    }
    return this._tx;
  }

  deactivate(): void {
    this._active = false;
  }
}
