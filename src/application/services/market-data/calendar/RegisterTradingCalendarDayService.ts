import {
  RegisterTradingCalendarDayRequest,
  RegisterTradingCalendarDayResponse,
  TradingCalendarRepository,
  CalendarUniqueCollisionError,
  CalendarSourceFkViolationError
} from '../../../ports/market-data/TradingCalendarPorts';
import { TradingCalendarDayDomain } from '../../../../domain/market-data/TradingCalendarDay';
import {
  MarketSourceVersionNotFoundError,
  TradingCalendarConflictError,
  MarketDataIntegrityError
} from '../../../../domain/market-data/MarketDataErrors';

export class RegisterTradingCalendarDayService {
  constructor(private readonly repository: TradingCalendarRepository) {}

  async execute(request: RegisterTradingCalendarDayRequest): Promise<RegisterTradingCalendarDayResponse> {
    const { payload, hash } = TradingCalendarDayDomain.buildCanonicalHash(
      request.sourceVersionKey,
      request.exchange,
      request.marketDate,
      request.dayType,
      request.reason
    );

    try {
      return await this.repository.runTransaction(async (ctx) => {
        const sourceVersionId = await this.repository.findSourceVersionIdByKey(ctx, payload.sourceVersionKey);
        if (!sourceVersionId) {
          throw new MarketSourceVersionNotFoundError();
        }

        const existing = await this.repository.findCalendarDayByIdentity(ctx, sourceVersionId, payload.exchange, payload.marketDate);
        if (existing) {
          if (existing.canonicalHash === hash) {
            return { outcome: 'REPLAYED', record: existing };
          } else {
            throw new TradingCalendarConflictError();
          }
        }

        const record = await this.repository.insertCalendarDay(ctx, {
          sourceVersionId,
          exchange: payload.exchange,
          marketDate: payload.marketDate,
          dayType: payload.dayType,
          reason: payload.reason,
          canonicalHash: hash,
        });

        return { outcome: 'CREATED', record };
      });
    } catch (error) {
      if (error instanceof CalendarUniqueCollisionError) {
        return this.recoverUniqueCollision(payload.sourceVersionKey, payload.exchange, payload.marketDate, hash);
      }
      if (error instanceof CalendarSourceFkViolationError) {
        return this.recoverSourceFkViolation(payload.sourceVersionKey);
      }
      throw error;
    }
  }

  private async recoverUniqueCollision(
    sourceVersionKey: string,
    exchange: any,
    marketDate: string,
    hash: string
  ): Promise<RegisterTradingCalendarDayResponse> {
    return this.repository.runTransaction(async (ctx) => {
      const sourceVersionId = await this.repository.findSourceVersionIdByKey(ctx, sourceVersionKey);
      if (!sourceVersionId) {
        throw new MarketSourceVersionNotFoundError();
      }

      const existing = await this.repository.findCalendarDayByIdentity(ctx, sourceVersionId, exchange, marketDate);
      if (existing) {
        if (existing.canonicalHash === hash) {
          return { outcome: 'REPLAYED', record: existing };
        } else {
          throw new TradingCalendarConflictError();
        }
      }

      const existingByHash = await this.repository.findCalendarDayByCanonicalHash(ctx, hash);
      if (existingByHash) {
        throw new MarketDataIntegrityError('Canonical hash exists but identity differs.');
      }

      throw new MarketDataIntegrityError('Unique collision on unknown constraint.');
    });
  }

  private async recoverSourceFkViolation(sourceVersionKey: string): Promise<never> {
    return this.repository.runTransaction(async (ctx) => {
      const sourceVersionId = await this.repository.findSourceVersionIdByKey(ctx, sourceVersionKey);
      if (!sourceVersionId) {
        throw new MarketSourceVersionNotFoundError();
      }
      throw new MarketDataIntegrityError('Source version exists but FK violation occurred.');
    });
  }
}
