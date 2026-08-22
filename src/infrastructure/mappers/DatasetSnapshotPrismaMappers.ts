import { DatasetSnapshot as PrismaDatasetSnapshot } from '@prisma/client';
import { DatasetSnapshot, DatasetSnapshotStatus } from '../../domain/market-data/DatasetSnapshot';
import { MarketDataIntegrityError } from '../../domain/market-data/MarketDataErrors';
import { MarketDataPrismaMappers } from '../repositories/market-data/MarketDataPrismaMappers';
import {
  CreateDatasetSnapshotDraftCommand,
  CreateDatasetSnapshotEntryCommand
} from '../../application/ports/market-data/DatasetSnapshotPorts';

export class DatasetSnapshotPrismaMappers {
  static toDomain(row: PrismaDatasetSnapshot): DatasetSnapshot {
    let status: DatasetSnapshotStatus;
    if (row.status === 'DRAFT') {
      status = 'DRAFT';
    } else if (row.status === 'SEALED') {
      status = 'SEALED';
    } else {
      throw new MarketDataIntegrityError('Unknown persisted DatasetSnapshot status.');
    }

    return {
      id: row.id,
      businessKey: row.businessKey,
      sourceVersionId: row.sourceVersionId,
      rangeStart: MarketDataPrismaMappers.mapDateToYYYYMMDD(row.rangeStart),
      rangeEnd: MarketDataPrismaMappers.mapDateToYYYYMMDD(row.rangeEnd),
      universeDefinitionJson: row.universeDefinitionJson,
      universeHash: row.universeHash,
      dataCutoffKey: row.dataCutoffKey,
      dataCutoffAt: row.dataCutoffAt,
      canonicalizationVersion: row.canonicalizationVersion,
      rowCount: row.rowCount,
      manifestHash: row.manifestHash,
      contentHash: row.contentHash,
      status,
      creationIdempotencyKey: row.creationIdempotencyKey,
      creationRequestHash: row.creationRequestHash,
      sealedAt: row.sealedAt
    };
  }

  static toDraftCreateInput(command: CreateDatasetSnapshotDraftCommand) {
    return {
      businessKey: command.businessKey,
      sourceVersionId: command.sourceVersionId,
      rangeStart: MarketDataPrismaMappers.mapYYYYMMDDToDate(command.rangeStart),
      rangeEnd: MarketDataPrismaMappers.mapYYYYMMDDToDate(command.rangeEnd),
      universeDefinitionJson: command.universeDefinitionJson,
      universeHash: command.universeHash,
      dataCutoffKey: command.dataCutoffKey,
      dataCutoffAt: command.dataCutoffAt,
      canonicalizationVersion: command.canonicalizationVersion,
      rowCount: command.rowCount,
      manifestHash: command.manifestHash,
      contentHash: command.contentHash,
      status: 'DRAFT' as const,
      creationIdempotencyKey: command.creationIdempotencyKey,
      creationRequestHash: command.creationRequestHash,
      sealedAt: null
    };
  }

  static toEntryCreateManyInput(snapshotId: string, command: CreateDatasetSnapshotEntryCommand) {
    return {
      snapshotId,
      dailyBarId: command.dailyBarId,
      entrySequence: command.entrySequence,
      instrumentBusinessKey: command.instrumentBusinessKey,
      marketDate: MarketDataPrismaMappers.mapYYYYMMDDToDate(command.marketDate),
      barCanonicalHash: command.barCanonicalHash,
      entryHash: command.entryHash
    };
  }
}
