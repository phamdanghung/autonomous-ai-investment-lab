import { DomainError } from '../errors/DomainErrors';
import { CanonicalDate } from '../models/CanonicalDate';
import { CanonicalSerializer } from '../hashing/CanonicalSerializer';
import { Sha256Service } from '../services/Sha256Service';
import {
  PORTFOLIO_LEDGER_GENESIS_CONTRACT_VERSION,
  PortfolioLedgerGenesis,
  PortfolioLedgerGenesisInput,
  CanonicalPortfolioLedgerGenesisPayload
} from '../contracts/PortfolioLedgerContracts';

export class PortfolioLedgerGenesisInvalidError extends DomainError {
  constructor(message: string = 'Portfolio ledger genesis is invalid.') {
    super(message, 'PORTFOLIO_LEDGER_GENESIS_INVALID');
    this.name = 'PortfolioLedgerGenesisInvalidError';
    Object.setPrototypeOf(this, PortfolioLedgerGenesisInvalidError.prototype);
  }
}

export class PortfolioLedgerGenesisDomain {
  static build(input: PortfolioLedgerGenesisInput): PortfolioLedgerGenesis {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new PortfolioLedgerGenesisInvalidError();
    }

    const { runBusinessKey, canonicalStartDate, initialCapitalVnd } = input;

    if (typeof runBusinessKey !== 'string' || !/^[a-f0-9]{64}$/.test(runBusinessKey)) {
      throw new PortfolioLedgerGenesisInvalidError('Invalid runBusinessKey');
    }

    if (typeof canonicalStartDate !== 'string') {
      throw new PortfolioLedgerGenesisInvalidError('Invalid canonicalStartDate');
    }

    let cDate: CanonicalDate;
    try {
      cDate = new CanonicalDate(canonicalStartDate);
    } catch (error) {
      throw new PortfolioLedgerGenesisInvalidError('Invalid canonicalStartDate');
    }

    if (cDate.value !== canonicalStartDate) {
      throw new PortfolioLedgerGenesisInvalidError('Invalid canonicalStartDate');
    }

    if (typeof initialCapitalVnd !== 'bigint' || initialCapitalVnd < 0n) {
      throw new PortfolioLedgerGenesisInvalidError('Invalid initialCapitalVnd');
    }

    const openingCashVnd = initialCapitalVnd.toString(10);

    const payload: CanonicalPortfolioLedgerGenesisPayload = {
      contractVersion: PORTFOLIO_LEDGER_GENESIS_CONTRACT_VERSION,
      ledgerKind: 'SIMULATION_PORTFOLIO',
      runBusinessKey,
      canonicalStartDate,
      currency: 'VND',
      openingCashVnd,
      openingPositionCount: 0
    };

    const serialized = CanonicalSerializer.serialize(payload);
    const genesisHash = Sha256Service.hashString(serialized);

    const output: PortfolioLedgerGenesis = {
      contractVersion: payload.contractVersion,
      ledgerKind: payload.ledgerKind,
      runBusinessKey: payload.runBusinessKey,
      canonicalStartDate: payload.canonicalStartDate,
      currency: payload.currency,
      openingCashVnd: payload.openingCashVnd,
      openingPositionCount: payload.openingPositionCount,
      genesisHash
    };

    return Object.freeze(output);
  }
}
