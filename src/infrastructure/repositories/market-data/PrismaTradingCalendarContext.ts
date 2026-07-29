import { Prisma } from '@prisma/client';
import { TRADING_CALENDAR_TRANSACTION_TOKEN, TradingCalendarTransactionContext } from '../../../application/ports/market-data/TradingCalendarPorts';

export class PrismaTradingCalendarContext implements TradingCalendarTransactionContext {
  public readonly [TRADING_CALENDAR_TRANSACTION_TOKEN] = true;
  private active = true;

  constructor(
    public readonly tx: Prisma.TransactionClient,
    private readonly ownerToken: symbol
  ) {}

  validate(token: symbol) {
    if (this.ownerToken !== token) {
      throw new Error('Cross-family context detected.');
    }
    if (!this.active) {
      throw new Error('Context is expired.');
    }
  }

  deactivate() {
    this.active = false;
  }
}
