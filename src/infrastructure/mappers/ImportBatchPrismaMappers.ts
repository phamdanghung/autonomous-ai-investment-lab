import { Prisma } from '@prisma/client';
import { MarketDataImportBatch, MarketDataImportStatus } from '../../domain/market-data/MarketDataImportBatch';
import { RegisterImportBatchCommand } from '../../application/ports/market-data/ImportBatchPorts';
import { MarketImportMode } from '../../domain/contracts/MarketDataContracts';
import { MarketDataIntegrityError } from '../../domain/market-data/MarketDataErrors';

export class ImportBatchPrismaMappers {
  static toDomain(row: Prisma.MarketDataImportBatchGetPayload<{}>): MarketDataImportBatch {
    return {
      id: row.id,
      sourceVersionId: row.sourceVersionId,
      creationIdempotencyKey: row.creationIdempotencyKey,
      creationRequestHash: row.creationRequestHash,
      batchBusinessKey: row.batchBusinessKey,
      importMode: ImportBatchPrismaMappers.mapImportModeToDomain(row.importMode),
      status: ImportBatchPrismaMappers.mapStatusToDomain(row.status),
      parsedRowCount: row.parsedRowCount,
      acceptedRowCount: row.acceptedRowCount,
      flaggedRowCount: row.flaggedRowCount,
      quarantinedRowCount: row.quarantinedRowCount,
    };
  }

  static toPrismaCreate(command: RegisterImportBatchCommand): Prisma.MarketDataImportBatchCreateInput {
    let sourceByteSize: bigint;
    try {
      sourceByteSize = BigInt(command.sourceByteSize);
    } catch (error) {
      throw new MarketDataIntegrityError('sourceByteSize must be a valid integer string');
    }

    return {
      creationIdempotencyKey: command.creationIdempotencyKey,
      creationRequestHash: command.creationRequestHash,
      batchBusinessKey: command.batchBusinessKey,
      sourceObjectKey: command.sourceObjectKey,
      sourceContentHash: command.sourceContentHash,
      sourceByteSize: sourceByteSize,
      declaredRowCount: command.declaredRowCount,
      importMode: ImportBatchPrismaMappers.mapImportModeToPrisma(command.importMode),
      startedAt: command.startedAt,
      status: 'PENDING',
      sourceVersion: {
        connect: { id: command.sourceVersionId }
      }
    };
  }

  private static mapImportModeToDomain(prismaMode: string): MarketImportMode {
    switch (prismaMode) {
      case 'INITIAL': return 'INITIAL';
      case 'CORRECTION': return 'CORRECTION';
      default:
        throw new MarketDataIntegrityError(`Unknown persisted MarketImportMode: ${prismaMode}`);
    }
  }

  private static mapImportModeToPrisma(domainMode: MarketImportMode): 'INITIAL' | 'CORRECTION' {
    switch (domainMode) {
      case 'INITIAL': return 'INITIAL';
      case 'CORRECTION': return 'CORRECTION';
      default:
        throw new MarketDataIntegrityError(`Unknown domain MarketImportMode: ${domainMode}`);
    }
  }

  private static mapStatusToDomain(prismaStatus: string): MarketDataImportStatus {
    switch (prismaStatus) {
      case 'PENDING': return 'PENDING';
      case 'COMPLETED': return 'COMPLETED';
      case 'COMPLETED_WITH_QUARANTINE': return 'COMPLETED_WITH_QUARANTINE';
      case 'FAILED': return 'FAILED';
      default:
        throw new MarketDataIntegrityError(`Unknown persisted MarketImportStatus: ${prismaStatus}`);
    }
  }
}
