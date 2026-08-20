import { Prisma } from '@prisma/client';
import { DailyMarketBar } from '../../domain/market-data/DailyMarketBar';
import { AppendDailyMarketBarCommand } from '../../application/ports/market-data/DailyMarketBarPorts';
import { MarketBarKind, MarketQualityDecision } from '../../domain/contracts/MarketDataContracts';
import { MarketDataIntegrityError } from '../../domain/market-data/MarketDataErrors';
import { MarketDataPrismaMappers } from '../repositories/market-data/MarketDataPrismaMappers';

export class DailyMarketBarPrismaMappers {
  static toDomain(row: Prisma.DailyMarketBarGetPayload<{}>): DailyMarketBar {
    let barKind: MarketBarKind;
    if (row.barKind === 'TRADED') barKind = 'TRADED';
    else if (row.barKind === 'NO_TRADE') barKind = 'NO_TRADE';
    else if (row.barKind === 'SUSPENDED') barKind = 'SUSPENDED';
    else throw new MarketDataIntegrityError('Unknown persisted barKind.');

    let qualityDecision: MarketQualityDecision;
    if (row.qualityDecision === 'ACCEPTED') qualityDecision = 'ACCEPTED';
    else if (row.qualityDecision === 'ACCEPTED_WITH_FLAGS') qualityDecision = 'ACCEPTED_WITH_FLAGS';
    else if (row.qualityDecision === 'QUARANTINED') qualityDecision = 'QUARANTINED';
    else throw new MarketDataIntegrityError('Unknown persisted qualityDecision.');

    return {
      id: row.id,
      sourceVersionId: row.sourceVersionId,
      importBatchId: row.importBatchId,
      sourceRecordKey: row.sourceRecordKey,
      instrumentId: row.instrumentId,
      marketDate: MarketDataPrismaMappers.mapDateToYYYYMMDD(row.marketDate),
      barKind,
      open: row.open !== null ? row.open.toString() : null,
      high: row.high !== null ? row.high.toString() : null,
      low: row.low !== null ? row.low.toString() : null,
      close: row.close !== null ? row.close.toString() : null,
      volume: row.volume.toString(),
      tradingValue: row.tradingValue !== null ? row.tradingValue.toString() : null,
      correctionVersion: row.correctionVersion,
      supersedesBarId: row.supersedesBarId,
      qualityDecision,
      qualityFlags: row.qualityFlags,
      sourceRowHash: row.sourceRowHash,
      canonicalHash: row.canonicalHash,
    };
  }

  static toPrismaCreate(command: AppendDailyMarketBarCommand): Prisma.DailyMarketBarCreateInput {
    let open: bigint | null;
    let high: bigint | null;
    let low: bigint | null;
    let close: bigint | null;
    let volume: bigint;
    let tradingValue: bigint | null;

    try {
      open = command.open !== null ? BigInt(command.open) : null;
      high = command.high !== null ? BigInt(command.high) : null;
      low = command.low !== null ? BigInt(command.low) : null;
      close = command.close !== null ? BigInt(command.close) : null;
      volume = BigInt(command.volume);
      tradingValue = command.tradingValue !== null ? BigInt(command.tradingValue) : null;
    } catch (e: unknown) {
      throw new MarketDataIntegrityError('Daily market bar contains malformed persisted integer data.');
    }

    return {
      sourceRecordKey: command.sourceRecordKey,
      marketDate: MarketDataPrismaMappers.mapYYYYMMDDToDate(command.marketDate),
      barKind: command.barKind,
      open,
      high,
      low,
      close,
      volume,
      tradingValue,
      correctionVersion: command.correctionVersion,
      qualityDecision: command.qualityDecision,
      qualityFlags: command.qualityFlags,
      sourceRowHash: command.sourceRowHash,
      canonicalHash: command.canonicalHash,
      sourceVersion: {
        connect: { id: command.sourceVersionId }
      },
      importBatch: {
        connect: { id: command.importBatchId }
      },
      instrument: {
        connect: { id: command.instrumentId }
      },
      ...(command.supersedesBarId !== null
        ? { supersedesBar: { connect: { id: command.supersedesBarId } } }
        : {})
    };
  }
}
