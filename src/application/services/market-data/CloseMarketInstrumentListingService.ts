import { IMarketInstrumentTransactionPort } from '../../ports/market-data/IMarketInstrumentTransactionPort';
import { IMarketInstrumentTransactionalRepository } from '../../ports/market-data/IMarketInstrumentTransactionalRepository';
import { IMarketInstrumentQueryRepository } from '../../ports/market-data/IMarketInstrumentQueryRepository';
import { MarketInstrumentDomain } from '../../../domain/market-data/MarketInstrument';
import { MarketDataValidation } from '../../../domain/market-data/MarketDataValidation';
import { MarketDataCanonicalization } from '../../../domain/market-data/MarketDataCanonicalization';
import { MarketInstrumentRecord } from '../../ports/market-data/IMarketInstrumentQueryRepository';
import { MarketInstrumentNotFoundError, MarketInstrumentOverlapError } from '../../../domain/market-data/MarketDataErrors';

export interface CloseMarketInstrumentInput {
  businessKey: string;
  effectiveTo: string;
}

export class CloseMarketInstrumentListingService {
  constructor(
    private readonly transactionPort: IMarketInstrumentTransactionPort,
    private readonly queryRepository: IMarketInstrumentQueryRepository,
    private readonly transactionalRepository: IMarketInstrumentTransactionalRepository
  ) {}

  async execute(input: CloseMarketInstrumentInput): Promise<MarketInstrumentRecord> {
    const businessKey = input.businessKey;
    const closeDate = MarketDataValidation.normalizeDateOnly(input.effectiveTo);

    return await this.transactionPort.runInTransaction(async (ctx) => {
      // initial target read within transaction
      const target = await this.transactionalRepository.findByBusinessKey(ctx, businessKey);

      if (!target) {
        throw new MarketInstrumentNotFoundError(`Listing with business key ${businessKey} not found`);
      }

      // derive lock
      const lockKey = MarketDataCanonicalization.deriveAdvisoryLockKey(
        target.exchange,
        target.canonicalSymbol,
        target.securityType
      );

      // acquire lock
      await this.transactionalRepository.acquireIdentityLock(ctx, lockKey);

      // target re-read
      const reReadTarget = await this.transactionalRepository.findByBusinessKey(ctx, businessKey);

      if (!reReadTarget) {
        throw new MarketInstrumentNotFoundError(`Listing with business key ${businessKey} not found`);
      }

      // validate target still exists/open
      MarketInstrumentDomain.validateClosure(reReadTarget.effectiveFrom, reReadTarget.effectiveTo, closeDate);

      // list sibling episodes
      const episodes = await this.transactionalRepository.listEpisodesForIdentity(ctx, {
        exchange: reReadTarget.exchange,
        canonicalSymbol: reReadTarget.canonicalSymbol,
        securityType: reReadTarget.securityType
      });

      // Find the next episode after the target
      let nextEpisode: MarketInstrumentRecord | undefined = undefined;
      for (const ep of episodes) {
        if (ep.effectiveFrom > reReadTarget.effectiveFrom) {
          if (!nextEpisode || ep.effectiveFrom < nextEpisode.effectiveFrom) {
            nextEpisode = ep;
          }
        }
      }

      // validate closure and next-episode boundary
      if (nextEpisode) {
        if (closeDate >= nextEpisode.effectiveFrom) {
          throw new MarketInstrumentOverlapError('Close date must be strictly before the next episode effectiveFrom date');
        }
      }

      // conditional update WHERE id=? AND effectiveTo IS NULL
      const updated = await this.transactionalRepository.closeOpenListing(ctx, {
        id: reReadTarget.id,
        effectiveTo: closeDate
      });

      if (!updated) {
        // Since we already locked and validated, if it's null it means someone closed it between our lock acquisition?
        // Wait, the lock prevents concurrent updates for the same identity!
        // The error classification is handled in Repository conditional update row count check logic per prompt,
        // or actually, if we get null, it implies a race condition that wasn't blocked by the lock (which shouldn't happen, but we must handle it).
        throw new MarketInstrumentNotFoundError('Failed to update listing: it may have been concurrently modified');
      }

      return updated;
    });
  }
}
