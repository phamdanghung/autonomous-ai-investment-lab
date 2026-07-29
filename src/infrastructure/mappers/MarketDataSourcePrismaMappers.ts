import { MarketDataSourceVersion as PrismaSourceVersion } from '@prisma/client';
import { MarketDataSourceVersion } from '../../domain/market-data/MarketDataSourceVersion';
import { MarketDatasetKind, MarketAdapterKind, MarketPriceUnit, SourceEncoding } from '../../domain/contracts/MarketDataContracts';
import { MarketDataSourceVersionRow } from '../../application/ports/market-data/MarketDataSourcePorts';

export class MarketDataSourcePrismaMappers {
  static toDomain(prisma: PrismaSourceVersion): MarketDataSourceVersion {
    return {
      id: prisma.id,
      sourceKey: prisma.sourceKey,
      contractHash: prisma.contractHash,
      providerCode: prisma.providerCode,
      datasetKind: prisma.datasetKind as MarketDatasetKind,
      sealedAt: prisma.sealedAt,
      adapterKind: prisma.adapterKind as MarketAdapterKind,
      adapterVersion: prisma.adapterVersion,
      schemaVersion: prisma.schemaVersion,
      canonicalizationVersion: prisma.canonicalizationVersion,
      priceUnit: prisma.priceUnit as MarketPriceUnit,
      encoding: prisma.encoding as SourceEncoding,
    };
  }

  static toPortRow(prisma: PrismaSourceVersion): MarketDataSourceVersionRow {
    return {
      sourceVersion: this.toDomain(prisma),
      createdAt: prisma.createdAt.toISOString(),
    };
  }

  static toPrismaInsert(domain: MarketDataSourceVersion) {
    return {
      id: domain.id,
      sourceKey: domain.sourceKey,
      contractHash: domain.contractHash,
      providerCode: domain.providerCode,
      datasetKind: domain.datasetKind,
      sealedAt: domain.sealedAt,
      adapterKind: domain.adapterKind,
      adapterVersion: domain.adapterVersion,
      schemaVersion: domain.schemaVersion,
      canonicalizationVersion: domain.canonicalizationVersion,
      priceUnit: domain.priceUnit,
      encoding: domain.encoding,
    };
  }
}
