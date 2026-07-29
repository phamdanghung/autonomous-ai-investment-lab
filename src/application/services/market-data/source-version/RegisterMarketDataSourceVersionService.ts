import { IMarketDataSourceRepository } from '../../../ports/market-data/MarketDataSourcePorts';
import { IClock } from '../../../ports/IClock';
import { 
  MarketDatasetKind, 
  MarketAdapterKind, 
  MarketPriceUnit, 
  SourceEncoding 
} from '../../../../domain/contracts/MarketDataContracts';
import { MarketDataSourceVersionDomain } from '../../../../domain/market-data/MarketDataSourceVersion';
import { 
  MarketSourceVersionInvalidError,
  MarketSourceVersionConflictError,
  MarketDataIntegrityError
} from '../../../../domain/market-data/MarketDataErrors';
import { randomUUID } from 'crypto';

// The sentinel error from PrismaMarketDataSourceRepository
import { SourceVersionUniqueCollisionError } from '../../../../infrastructure/repositories/market-data/PrismaMarketDataSourceRepository';

export interface RegisterMarketDataSourceVersionRequest {
  providerCode: string;
  datasetKind: MarketDatasetKind;
  adapterKind: MarketAdapterKind;
  adapterVersion: string;
  schemaVersion: string;
  canonicalizationVersion: string;
  priceUnit: MarketPriceUnit;
  encoding: SourceEncoding;
}

export interface RegisterMarketDataSourceVersionResponse {
  outcome: 'CREATED' | 'REPLAYED';
  record: import('../../../../domain/market-data/MarketDataSourceVersion').MarketDataSourceVersion;
}

export class RegisterMarketDataSourceVersionService {
  constructor(
    private readonly repository: IMarketDataSourceRepository,
    private readonly clock: IClock,
    private readonly family: string
  ) {}

  async execute(request: RegisterMarketDataSourceVersionRequest): Promise<RegisterMarketDataSourceVersionResponse> {
    const { payload, hash } = MarketDataSourceVersionDomain.buildContractHash(request);
    const sourceKey = MarketDataSourceVersionDomain.buildSourceKey(hash);

    const now = this.clock.now();
    if (!(now instanceof Date) || isNaN(now.getTime())) {
      throw new MarketSourceVersionInvalidError('Invalid clock timestamp.');
    }

    const sealedAt = new Date(now.getTime());

    const newVersion = {
      id: randomUUID(),
      sourceKey,
      contractHash: hash,
      providerCode: payload.providerCode,
      datasetKind: payload.datasetKind,
      adapterKind: payload.adapterKind,
      adapterVersion: payload.adapterVersion,
      schemaVersion: payload.schemaVersion,
      canonicalizationVersion: payload.canonicalizationVersion,
      priceUnit: payload.priceUnit,
      encoding: payload.encoding,
      sealedAt,
    };

    try {
      const inserted = await this.repository.transaction(this.family, async (ctx) => {
        return await this.repository.insert(ctx, newVersion);
      });
      return { outcome: 'CREATED', record: inserted.sourceVersion };
    } catch (error) {
      if (error instanceof SourceVersionUniqueCollisionError) {
        return await this.repository.transaction(this.family, async (ctx) => {
          const bySourceKey = await this.repository.findBySourceKey(ctx, sourceKey);
          if (bySourceKey) {
            if (
              bySourceKey.providerCode === newVersion.providerCode &&
              bySourceKey.datasetKind === newVersion.datasetKind &&
              bySourceKey.adapterKind === newVersion.adapterKind &&
              bySourceKey.adapterVersion === newVersion.adapterVersion &&
              bySourceKey.schemaVersion === newVersion.schemaVersion &&
              bySourceKey.canonicalizationVersion === newVersion.canonicalizationVersion &&
              bySourceKey.priceUnit === newVersion.priceUnit &&
              bySourceKey.encoding === newVersion.encoding
            ) {
              return { outcome: 'REPLAYED', record: bySourceKey };
            } else {
              throw new MarketSourceVersionConflictError();
            }
          }
          
          const byContractHash = await this.repository.findByContractHash(ctx, hash);
          if (byContractHash) {
            throw new MarketDataIntegrityError('Source version unique collision: contract hash exists but source key missing.');
          }
          
          throw new MarketDataIntegrityError('Source version unique collision: row missing after collision.');
        });
      }
      throw error;
    }
  }
}
