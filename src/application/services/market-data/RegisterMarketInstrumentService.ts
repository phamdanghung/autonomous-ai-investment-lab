import { IMarketInstrumentTransactionPort } from '../../ports/market-data/IMarketInstrumentTransactionPort';
import { IMarketInstrumentTransactionalRepository } from '../../ports/market-data/IMarketInstrumentTransactionalRepository';
import { MarketInstrumentDomain } from '../../../domain/market-data/MarketInstrument';
import { MarketDataValidation } from '../../../domain/market-data/MarketDataValidation';
import { MarketDataCanonicalization } from '../../../domain/market-data/MarketDataCanonicalization';
import { MarketExchange, SecurityType } from '../../../domain/contracts/MarketDataContracts';
import { MarketInstrumentRecord } from '../../ports/market-data/IMarketInstrumentQueryRepository';
import { MarketInstrumentOverlapError, MarketInstrumentInvalidError } from '../../../domain/market-data/MarketDataErrors';

export interface RegisterMarketInstrumentInput {
  exchange: MarketExchange;
  canonicalSymbol: string;
  securityType: SecurityType;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface RegisterMarketInstrumentResult {
  outcome: 'CREATED' | 'REPLAYED';
  instrument: MarketInstrumentRecord;
}

export class RegisterMarketInstrumentService {
  constructor(
    private readonly transactionPort: IMarketInstrumentTransactionPort,
    private readonly repository: IMarketInstrumentTransactionalRepository
  ) {}

  async execute(input: RegisterMarketInstrumentInput): Promise<RegisterMarketInstrumentResult> {
    const exchange = input.exchange;
    const securityType = input.securityType;
    const canonicalSymbol = MarketDataValidation.normalizeSymbol(input.canonicalSymbol);
    const effectiveFrom = MarketDataValidation.normalizeDateOnly(input.effectiveFrom);
    const effectiveTo = input.effectiveTo ? MarketDataValidation.normalizeDateOnly(input.effectiveTo) : null;

    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new MarketInstrumentInvalidError('effectiveTo cannot be before effectiveFrom');
    }

    const businessKey = MarketInstrumentDomain.buildBusinessKey(exchange, canonicalSymbol, securityType, effectiveFrom);

    const lockKey = MarketDataCanonicalization.deriveAdvisoryLockKey(
      exchange,
      canonicalSymbol,
      securityType
    );

    return await this.transactionPort.runInTransaction(async (ctx) => {
      await this.repository.acquireIdentityLock(ctx, lockKey);

      const existingExact = await this.repository.findByBusinessKey(ctx, businessKey);

      if (existingExact) {
        if (existingExact.effectiveTo === effectiveTo) {
          return {
            outcome: 'REPLAYED',
            instrument: existingExact
          };
        } else {
          throw new MarketInstrumentOverlapError('Conflict: Business key exists but with different creation payload');
        }
      }

      const episodes = await this.repository.listEpisodesForIdentity(ctx, {
        exchange,
        canonicalSymbol,
        securityType
      });

      for (const ep of episodes) {
        if (MarketInstrumentDomain.isOverlap(effectiveFrom, effectiveTo, ep.effectiveFrom, ep.effectiveTo)) {
          throw new MarketInstrumentOverlapError('Listing overlaps with existing episode');
        }
      }

      const insertResult = await this.repository.insertListing(ctx, {
        businessKey,
        exchange,
        canonicalSymbol,
        securityType,
        effectiveFrom,
        effectiveTo
      });

      return {
        outcome: insertResult.outcome,
        instrument: insertResult.record
      };
    });
  }
}
