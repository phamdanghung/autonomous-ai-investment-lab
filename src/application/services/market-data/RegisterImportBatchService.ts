import { ImportBatchRepository, RegisterImportBatchCommand } from '../../ports/market-data/ImportBatchPorts';
import { GetMarketDataSourceVersionService } from './source-version/GetMarketDataSourceVersionService';
import { IClock } from '../../ports/IClock';
import { MarketImportMode } from '../../../domain/contracts/MarketDataContracts';
import {
  MarketDataImportBatch,
  MarketDataImportBatchDomain,
} from '../../../domain/market-data/MarketDataImportBatch';
import {
  MarketImportIdempotencyConflictError,
  MarketImportBusinessKeyConflictError
} from '../../../domain/market-data/MarketDataErrors';

export type RegisterImportBatchRequest = {
  creationIdempotencyKey: string;
  sourceVersionKey: string;
  fixtureKey: string;
  sourceObjectKey: string;
  sourceContentHash: string;
  sourceByteSize: string;
  importMode: MarketImportMode;
  adapterVersion: string;
  schemaVersion: string;
  canonicalizationVersion: string;
  declaredRowCount?: number;
};

export class RegisterImportBatchService {
  constructor(
    private readonly importBatchRepo: ImportBatchRepository,
    private readonly getSourceVersionService: GetMarketDataSourceVersionService,
    private readonly clock: IClock
  ) {}

  async execute(request: RegisterImportBatchRequest): Promise<MarketDataImportBatch> {
    const creationHashInput = {
      sourceVersionKey: request.sourceVersionKey,
      fixtureKey: request.fixtureKey,
      sourceObjectKey: request.sourceObjectKey,
      sourceContentHash: request.sourceContentHash,
      sourceByteSize: request.sourceByteSize,
      importMode: request.importMode,
      adapterVersion: request.adapterVersion,
      schemaVersion: request.schemaVersion,
      canonicalizationVersion: request.canonicalizationVersion,
    };

    const { hash: creationRequestHash } = MarketDataImportBatchDomain.buildCreationRequestHash(creationHashInput);

    const { hash: batchBusinessKey } = MarketDataImportBatchDomain.buildBatchBusinessKey(
      request.sourceVersionKey,
      request.sourceContentHash,
      request.importMode,
      request.canonicalizationVersion
    );

    const existingByIdempotency = await this.importBatchRepo.findByCreationIdempotencyKey(request.creationIdempotencyKey);
    if (existingByIdempotency) {
      const decision = MarketDataImportBatchDomain.evaluateIdempotency(
        request.creationIdempotencyKey,
        creationRequestHash,
        batchBusinessKey,
        existingByIdempotency
      );
      if (decision === 'REPLAY_BY_IDEMPOTENCY_KEY') {
        return existingByIdempotency;
      }
      if (decision === 'IDEMPOTENCY_CONFLICT') {
        throw new MarketImportIdempotencyConflictError();
      }
    }

    const existingByBusinessKey = await this.importBatchRepo.findByBatchBusinessKey(batchBusinessKey);
    if (existingByBusinessKey) {
      const decision = MarketDataImportBatchDomain.evaluateIdempotency(
        request.creationIdempotencyKey,
        creationRequestHash,
        batchBusinessKey,
        existingByBusinessKey
      );
      if (decision === 'REPLAY_BY_BUSINESS_KEY') {
        return existingByBusinessKey;
      }
      if (decision === 'BUSINESS_KEY_CONFLICT') {
        throw new MarketImportBusinessKeyConflictError();
      }
    }

    const sourceVersion = await this.getSourceVersionService.execute({ sourceKey: request.sourceVersionKey });

    const command: RegisterImportBatchCommand = {
      creationIdempotencyKey: request.creationIdempotencyKey,
      creationRequestHash,
      batchBusinessKey,
      sourceVersionId: sourceVersion.id,
      sourceObjectKey: request.sourceObjectKey,
      sourceContentHash: request.sourceContentHash,
      sourceByteSize: request.sourceByteSize,
      declaredRowCount: request.declaredRowCount !== undefined ? request.declaredRowCount : null,
      importMode: request.importMode,
      startedAt: new Date(this.clock.now().getTime()),
    };

    return await this.importBatchRepo.create(command);
  }
}
