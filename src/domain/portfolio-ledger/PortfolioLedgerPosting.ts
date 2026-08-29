import { DomainError } from '../errors/DomainErrors';
import { PortfolioAccountingTransitionDomain } from './PortfolioAccountingTransition';
import { PortfolioLedgerEntryDomain } from './PortfolioLedgerEntry';
import { PortfolioLedgerPostingInput, PortfolioLedgerPosting } from '../contracts/PortfolioLedgerPostingContracts';

export class PortfolioLedgerPostingInvalidError extends DomainError {
  constructor(message: string = 'Portfolio ledger posting is invalid.') {
    super(message, 'PORTFOLIO_LEDGER_POSTING_INVALID');
    this.name = 'PortfolioLedgerPostingInvalidError';
    Object.setPrototypeOf(this, PortfolioLedgerPostingInvalidError.prototype);
  }
}

export class PortfolioLedgerPostingDomain {
  static compose(input: PortfolioLedgerPostingInput): PortfolioLedgerPosting {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new PortfolioLedgerPostingInvalidError();
    }

    let transition;
    try {
      transition = PortfolioAccountingTransitionDomain.apply({
        ledgerGenesisHash: input.ledgerGenesisHash,
        cashBalanceBeforeVnd: input.cashBalanceBeforeVnd,
        positionQuantityBefore: input.positionQuantityBefore,
        settlement: input.settlement
      });
    } catch (e) {
      throw new PortfolioLedgerPostingInvalidError('Transition build failed: ' + (e as Error).message);
    }

    let entry;
    try {
      entry = PortfolioLedgerEntryDomain.build({
        ledgerGenesisHash: input.ledgerGenesisHash,
        entrySequence: input.entrySequence,
        effectiveDate: input.effectiveDate,
        payloadHash: transition.transitionHash,
        previousHash: input.previousHash
      });
    } catch (e) {
      throw new PortfolioLedgerPostingInvalidError('Entry build failed: ' + (e as Error).message);
    }

    if (entry.ledgerGenesisHash !== transition.ledgerGenesisHash) {
      throw new PortfolioLedgerPostingInvalidError('ledgerGenesisHash mismatch');
    }

    if (entry.payloadHash !== transition.transitionHash) {
      throw new PortfolioLedgerPostingInvalidError('payloadHash mismatch');
    }

    const output: PortfolioLedgerPosting = {
      transition,
      entry
    };

    return Object.freeze(output);
  }
}
