import { DomainError } from '../errors/DomainErrors';
import { CanonicalDate } from '../models/CanonicalDate';
import { CanonicalSerializer } from '../hashing/CanonicalSerializer';
import { Sha256Service } from '../services/Sha256Service';
import {
  PORTFOLIO_LEDGER_ENTRY_CONTRACT_VERSION,
  PortfolioLedgerEntry,
  PortfolioLedgerEntryInput,
  CanonicalPortfolioLedgerEntryPayload
} from '../contracts/PortfolioLedgerEntryContracts';

export class PortfolioLedgerEntryInvalidError extends DomainError {
  constructor(message: string = 'Portfolio ledger entry is invalid.') {
    super(message, 'PORTFOLIO_LEDGER_ENTRY_INVALID');
    this.name = 'PortfolioLedgerEntryInvalidError';
    Object.setPrototypeOf(this, PortfolioLedgerEntryInvalidError.prototype);
  }
}

export class PortfolioLedgerEntryDomain {
  static build(input: PortfolioLedgerEntryInput): PortfolioLedgerEntry {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new PortfolioLedgerEntryInvalidError();
    }

    const { ledgerGenesisHash, entrySequence, effectiveDate, payloadHash, previousHash } = input;

    if (typeof ledgerGenesisHash !== 'string' || !/^[a-f0-9]{64}$/.test(ledgerGenesisHash)) {
      throw new PortfolioLedgerEntryInvalidError('Invalid ledgerGenesisHash');
    }

    if (typeof payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(payloadHash)) {
      throw new PortfolioLedgerEntryInvalidError('Invalid payloadHash');
    }

    if (typeof previousHash !== 'string' || !/^[a-f0-9]{64}$/.test(previousHash)) {
      throw new PortfolioLedgerEntryInvalidError('Invalid previousHash');
    }

    if (typeof entrySequence !== 'number' || !Number.isInteger(entrySequence) || entrySequence < 1 || entrySequence > Number.MAX_SAFE_INTEGER) {
      throw new PortfolioLedgerEntryInvalidError('Invalid entrySequence');
    }

    if (typeof effectiveDate !== 'string') {
      throw new PortfolioLedgerEntryInvalidError('Invalid effectiveDate');
    }

    let cDate: CanonicalDate;
    try {
      cDate = new CanonicalDate(effectiveDate);
    } catch (error) {
      throw new PortfolioLedgerEntryInvalidError('Invalid effectiveDate');
    }

    if (cDate.value !== effectiveDate) {
      throw new PortfolioLedgerEntryInvalidError('Invalid effectiveDate');
    }

    if (entrySequence === 1) {
      if (previousHash !== ledgerGenesisHash) {
        throw new PortfolioLedgerEntryInvalidError('Invalid previousHash for sequence 1');
      }
    } else {
      if (previousHash === ledgerGenesisHash) {
        throw new PortfolioLedgerEntryInvalidError('Invalid previousHash for sequence > 1');
      }
    }

    const payload: CanonicalPortfolioLedgerEntryPayload = {
      contractVersion: PORTFOLIO_LEDGER_ENTRY_CONTRACT_VERSION,
      entryType: 'POSTING',
      ledgerGenesisHash,
      entrySequence,
      effectiveDate,
      payloadHash,
      previousHash
    };

    const serialized = CanonicalSerializer.serialize(payload);
    const entryHash = Sha256Service.hashString(serialized);

    const output: PortfolioLedgerEntry = {
      contractVersion: payload.contractVersion,
      entryType: payload.entryType,
      ledgerGenesisHash: payload.ledgerGenesisHash,
      entrySequence: payload.entrySequence,
      effectiveDate: payload.effectiveDate,
      payloadHash: payload.payloadHash,
      previousHash: payload.previousHash,
      entryHash
    };

    return Object.freeze(output);
  }
}
