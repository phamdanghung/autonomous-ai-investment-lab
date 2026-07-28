import { MarketInstrument as PrismaMarketInstrument } from '@prisma/client';
import { MarketExchange, SecurityType } from '../../../domain/contracts/MarketDataContracts';
import { MarketInstrumentRecord } from '../../../application/ports/market-data/IMarketInstrumentQueryRepository';
import { MarketDataIntegrityError } from '../../../domain/market-data/MarketDataErrors';

export class MarketDataPrismaMappers {
  static mapExchange(exchange: string): MarketExchange {
    switch (exchange) {
      case 'HOSE':
        return 'HOSE';
      case 'HNX':
        return 'HNX';
      case 'UPCOM':
        return 'UPCOM';
      default:
        throw new MarketDataIntegrityError(`Unknown exchange enum from DB: ${exchange}`);
    }
  }

  static mapSecurityType(type: string): SecurityType {
    switch (type) {
      case 'EQUITY':
        return 'EQUITY';
      default:
        throw new MarketDataIntegrityError(`Unknown security type enum from DB: ${type}`);
    }
  }

  static mapDateToYYYYMMDD(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  static mapYYYYMMDDToDate(value: string): Date {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  static mapToApplicationRecord(prismaRecord: PrismaMarketInstrument): MarketInstrumentRecord {
    return {
      id: prismaRecord.id,
      businessKey: prismaRecord.businessKey,
      exchange: MarketDataPrismaMappers.mapExchange(prismaRecord.exchange),
      canonicalSymbol: prismaRecord.canonicalSymbol,
      securityType: MarketDataPrismaMappers.mapSecurityType(prismaRecord.securityType),
      effectiveFrom: MarketDataPrismaMappers.mapDateToYYYYMMDD(prismaRecord.effectiveFrom),
      effectiveTo: prismaRecord.effectiveTo ? MarketDataPrismaMappers.mapDateToYYYYMMDD(prismaRecord.effectiveTo) : null,
      sealedAt: prismaRecord.sealedAt.toISOString(),
      createdAt: prismaRecord.createdAt.toISOString(),
    };
  }
}
