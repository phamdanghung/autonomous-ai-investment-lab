import { CanonicalDailyBarPayload } from '../../../domain/contracts/MarketDataContracts';
import { DailyMarketBar, DailyMarketBarDomain } from '../../../domain/market-data/DailyMarketBar';
import {
  DailyMarketBarInvalidError,
  MarketDataIntegrityError,
  MarketImportInvalidTransitionError,
  MarketImportNotFoundError,
  MarketInstrumentNotFoundError,
} from '../../../domain/market-data/MarketDataErrors';
import { IMarketInstrumentQueryRepository } from '../../ports/market-data/IMarketInstrumentQueryRepository';
import { GetMarketDataSourceVersionService } from './source-version/GetMarketDataSourceVersionService';
import {
  AppendDailyMarketBarCommand,
  DailyMarketBarUniqueCollisionError,
  IDailyMarketBarAppendRepository,
  IDailyMarketBarImportBatchLookup,
  IDailyMarketBarQueryRepository,
} from '../../ports/market-data/DailyMarketBarPorts';

export type RegisterDailyMarketBarRequest = Omit<CanonicalDailyBarPayload, 'barContractVersion'> & {
  importBatchId: string;
};

export interface RegisterDailyMarketBarResult {
  outcome: 'CREATED' | 'REPLAYED';
  bar: DailyMarketBar;
}

export class RegisterDailyMarketBarService {
  constructor(
    private readonly queryRepository: IDailyMarketBarQueryRepository,
    private readonly appendRepository: IDailyMarketBarAppendRepository,
    private readonly importBatchLookup: IDailyMarketBarImportBatchLookup,
    private readonly getSourceVersionService: GetMarketDataSourceVersionService,
    private readonly instrumentQueryRepository: IMarketInstrumentQueryRepository
  ) {}

  async execute(request: RegisterDailyMarketBarRequest): Promise<RegisterDailyMarketBarResult> {
    // 1. PURE DOMAIN VALIDATION + CANONICAL HASH
    const canonicalPayload: Omit<CanonicalDailyBarPayload, 'barContractVersion'> = {
      sourceVersionKey: request.sourceVersionKey,
      sourceRecordKey: request.sourceRecordKey,
      instrumentBusinessKey: request.instrumentBusinessKey,
      marketDate: request.marketDate,
      barKind: request.barKind,
      open: request.open,
      high: request.high,
      low: request.low,
      close: request.close,
      volume: request.volume,
      tradingValue: request.tradingValue,
      correctionVersion: request.correctionVersion,
      qualityDecision: request.qualityDecision,
      qualityFlags: request.qualityFlags,
      sourceRowHash: request.sourceRowHash,
      supersedesBarHash: request.supersedesBarHash,
    };

    const { payload, hash } = DailyMarketBarDomain.buildCanonicalHash(canonicalPayload);

    // 2. RESOLVE SOURCE VERSION
    const resolvedSourceVersion = await this.getSourceVersionService.execute({ sourceKey: request.sourceVersionKey });

    // 3. RESOLVE INSTRUMENT
    const resolvedInstrument = await this.instrumentQueryRepository.findByBusinessKey(request.instrumentBusinessKey);
    if (!resolvedInstrument) {
      throw new MarketInstrumentNotFoundError();
    }

    // 4. INSTRUMENT LISTING DATE INVARIANT
    // marketDate >= effectiveFrom and (effectiveTo === null or marketDate <= effectiveTo)
    if (payload.marketDate < resolvedInstrument.effectiveFrom || (resolvedInstrument.effectiveTo !== null && payload.marketDate > resolvedInstrument.effectiveTo)) {
      throw new DailyMarketBarInvalidError('Instrument listing is not active on marketDate.');
    }

    // 5. RESOLVE IMPORT BATCH
    const importBatch = await this.importBatchLookup.findById(request.importBatchId);
    if (!importBatch) {
      throw new MarketImportNotFoundError();
    }

    // 6. IMPORT BATCH PROVENANCE INVARIANTS
    if (importBatch.sourceVersionId !== resolvedSourceVersion.id) {
      throw new MarketDataIntegrityError('Daily market bar source version does not match import batch source version.');
    }
    if (importBatch.status !== 'PENDING') {
      throw new MarketImportInvalidTransitionError('Daily market bars may only be appended while import batch is PENDING.');
    }

    // 7. CANONICAL-HASH REPLAY PREFLIGHT
    const existingByHash = await this.queryRepository.findByCanonicalHash(hash);
    if (existingByHash) {
      if (
        existingByHash.sourceVersionId !== resolvedSourceVersion.id ||
        existingByHash.instrumentId !== resolvedInstrument.id ||
        existingByHash.sourceRecordKey !== payload.sourceRecordKey ||
        existingByHash.marketDate !== payload.marketDate ||
        existingByHash.correctionVersion !== payload.correctionVersion ||
        existingByHash.canonicalHash !== hash
      ) {
        throw new MarketDataIntegrityError('Daily market bar canonical hash resolves to inconsistent identity.');
      }
      return { outcome: 'REPLAYED', bar: existingByHash };
    }

    // 8. CORRECTION / PREDECESSOR RULES
    let supersedesBarId: string | null = null;
    if (payload.correctionVersion === 0) {
      supersedesBarId = null;
    } else {
      const predecessor = await this.queryRepository.findByCanonicalHash(payload.supersedesBarHash!);
      if (!predecessor) {
        throw new MarketDataIntegrityError('Daily market bar predecessor was not found.');
      }
      if (
        predecessor.sourceVersionId !== resolvedSourceVersion.id ||
        predecessor.instrumentId !== resolvedInstrument.id ||
        predecessor.marketDate !== payload.marketDate ||
        predecessor.sourceRecordKey !== payload.sourceRecordKey ||
        predecessor.correctionVersion !== payload.correctionVersion - 1
      ) {
        throw new MarketDataIntegrityError('Daily market bar correction predecessor is inconsistent.');
      }

      // 9. NO FORKED SUPERSESSION
      const supersedingRow = await this.queryRepository.findBySupersedesBarId(predecessor.id);
      if (supersedingRow) {
        if (supersedingRow.canonicalHash === hash) {
          return { outcome: 'REPLAYED', bar: supersedingRow };
        } else {
          throw new MarketDataIntegrityError('Daily market bar predecessor has already been superseded.');
        }
      }
      supersedesBarId = predecessor.id;
    }

    // 10. IDENTITY PREFLIGHT
    // Identity A
    const identityA = await this.queryRepository.findBySourceInstrumentDateVersion(resolvedSourceVersion.id, resolvedInstrument.id, payload.marketDate, payload.correctionVersion);
    if (identityA) {
      if (identityA.canonicalHash === hash) {
        return { outcome: 'REPLAYED', bar: identityA };
      }
      throw new MarketDataIntegrityError('Daily market bar identity conflicts with existing canonical content.');
    }

    // Identity B
    const identityB = await this.queryRepository.findBySourceRecordVersion(resolvedSourceVersion.id, payload.sourceRecordKey, payload.correctionVersion);
    if (identityB) {
      if (identityB.canonicalHash === hash) {
        return { outcome: 'REPLAYED', bar: identityB };
      }
      throw new MarketDataIntegrityError('Daily market bar identity conflicts with existing canonical content.');
    }

    // 11. BUILD EXACT APPEND COMMAND
    const command: AppendDailyMarketBarCommand = {
      sourceVersionId: resolvedSourceVersion.id,
      importBatchId: request.importBatchId,
      instrumentId: resolvedInstrument.id,
      sourceRecordKey: payload.sourceRecordKey,
      marketDate: payload.marketDate,
      barKind: payload.barKind,
      open: payload.open,
      high: payload.high,
      low: payload.low,
      close: payload.close,
      volume: payload.volume,
      tradingValue: payload.tradingValue,
      correctionVersion: payload.correctionVersion,
      supersedesBarId,
      qualityDecision: payload.qualityDecision,
      qualityFlags: payload.qualityFlags,
      sourceRowHash: payload.sourceRowHash,
      canonicalHash: hash,
    };

    // 12. INSERT SUCCESS / 13. UNIQUE COLLISION RECOVERY
    try {
      const inserted = await this.appendRepository.insert(command);
      return { outcome: 'CREATED', bar: inserted };
    } catch (e) {
      if (e instanceof DailyMarketBarUniqueCollisionError) {
        // 1. canonical hash
        const reReadHash = await this.queryRepository.findByCanonicalHash(hash);
        if (reReadHash) {
          if (
            reReadHash.sourceVersionId === resolvedSourceVersion.id &&
            reReadHash.instrumentId === resolvedInstrument.id &&
            reReadHash.sourceRecordKey === payload.sourceRecordKey &&
            reReadHash.marketDate === payload.marketDate &&
            reReadHash.correctionVersion === payload.correctionVersion &&
            reReadHash.canonicalHash === hash
          ) {
            return { outcome: 'REPLAYED', bar: reReadHash };
          }
        }
        
        // 2. sourceVersion + instrument + marketDate + correctionVersion
        const reReadA = await this.queryRepository.findBySourceInstrumentDateVersion(resolvedSourceVersion.id, resolvedInstrument.id, payload.marketDate, payload.correctionVersion);
        if (reReadA) {
          if (reReadA.canonicalHash === hash) {
            return { outcome: 'REPLAYED', bar: reReadA };
          }
          throw new MarketDataIntegrityError('Daily market bar unique collision conflicts with existing canonical content.');
        }

        // 3. sourceVersion + sourceRecordKey + correctionVersion
        const reReadB = await this.queryRepository.findBySourceRecordVersion(resolvedSourceVersion.id, payload.sourceRecordKey, payload.correctionVersion);
        if (reReadB) {
          if (reReadB.canonicalHash === hash) {
            return { outcome: 'REPLAYED', bar: reReadB };
          }
          throw new MarketDataIntegrityError('Daily market bar unique collision conflicts with existing canonical content.');
        }

        // 4. supersedesBarId when correction
        if (supersedesBarId) {
          const reReadPredecessor = await this.queryRepository.findBySupersedesBarId(supersedesBarId);
          if (reReadPredecessor && reReadPredecessor.canonicalHash !== hash) {
            throw new MarketDataIntegrityError('Daily market bar predecessor has already been superseded.');
          }
        }

        // Collision but no row can be found
        throw new MarketDataIntegrityError('Daily market bar unique collision could not be resolved.');
      }
      throw e;
    }
  }
}
