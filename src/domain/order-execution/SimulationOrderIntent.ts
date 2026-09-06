import { DomainError } from '../errors/DomainErrors';
import { CanonicalDate } from '../models/CanonicalDate';
import { CanonicalSerializer } from '../hashing/CanonicalSerializer';
import { Sha256Service } from '../services/Sha256Service';
import { MarketInstrumentDomain } from '../market-data/MarketInstrument';
import { MARKET_EXCHANGES, MarketExchange } from '../contracts/MarketDataContracts';
import {
  SIMULATION_ORDER_INTENT_CONTRACT_VERSION,
  SIMULATION_ORDER_INTENT_KIND,
  SimulationOrderIntentInput,
  SimulationOrderIntent,
  CanonicalSimulationOrderIntentPayload,
} from '../contracts/SimulationOrderIntentContracts';

export class SimulationOrderIntentInvalidError extends DomainError {
  constructor(message: string = 'Simulation order intent is invalid.') {
    super(message, 'SIMULATION_ORDER_INTENT_INVALID');
  }
}

export class SimulationOrderIntentDomain {
  static build(input: SimulationOrderIntentInput): SimulationOrderIntent {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Input must be a non-null object.');
      }

      const runBusinessKey = input.runBusinessKey;
      if (typeof runBusinessKey !== 'string' || !/^[a-f0-9]{64}$/.test(runBusinessKey)) {
        throw new Error('runBusinessKey must be exactly 64 lowercase hex characters.');
      }

      let canonicalSimulationDate: string;
      try {
        const d = new CanonicalDate(input.simulationDate);
        if (d.value !== input.simulationDate) {
          throw new Error('Simulation date is not canonical.');
        }
        canonicalSimulationDate = d.value;
      } catch (e: any) {
        throw new Error(`Invalid simulationDate: ${e.message}`);
      }

      const instrumentBusinessKey = input.instrumentBusinessKey;
      if (typeof instrumentBusinessKey !== 'string') {
        throw new Error('instrumentBusinessKey must be a string.');
      }
      
      const parts = instrumentBusinessKey.split('|');
      if (parts.length !== 5) {
        throw new Error('instrumentBusinessKey malformed component count.');
      }
      const [country, exchange, canonicalSymbol, secType, effectiveFrom] = parts;
      if (country !== 'VN') {
        throw new Error('Invalid instrument country.');
      }
      if (!MARKET_EXCHANGES.includes(exchange as any)) {
        throw new Error('Invalid exchange.');
      }
      if (secType !== 'EQUITY') {
        throw new Error('Invalid securityType.');
      }

      const expectedKey = MarketInstrumentDomain.buildBusinessKey(
        exchange as MarketExchange,
        canonicalSymbol,
        'EQUITY',
        effectiveFrom
      );
      if (instrumentBusinessKey !== expectedKey) {
        throw new Error('instrumentBusinessKey exact canonical match failed.');
      }

      if (input.side !== 'BUY' && input.side !== 'SELL') {
        throw new Error('Side must be exactly BUY or SELL.');
      }

      if (typeof input.quantity !== 'bigint') {
        throw new Error('quantity must be a bigint.');
      }
      if (input.quantity <= 0n) {
        throw new Error('quantity must be > 0n.');
      }

      if (input.orderType !== 'MARKET') {
        throw new Error('orderType must be exactly MARKET.');
      }

      const sourceDecisionHash = input.sourceDecisionHash;
      if (typeof sourceDecisionHash !== 'string' || !/^[a-f0-9]{64}$/.test(sourceDecisionHash)) {
        throw new Error('sourceDecisionHash must be exactly 64 lowercase hex characters.');
      }

      const payload: CanonicalSimulationOrderIntentPayload = {
        contractVersion: SIMULATION_ORDER_INTENT_CONTRACT_VERSION,
        instrumentBusinessKey: instrumentBusinessKey,
        orderKind: SIMULATION_ORDER_INTENT_KIND,
        orderType: 'MARKET',
        quantity: input.quantity.toString(10),
        runBusinessKey: runBusinessKey,
        side: input.side,
        simulationDate: canonicalSimulationDate,
        sourceDecisionHash: sourceDecisionHash,
      };

      const serialized = CanonicalSerializer.serialize(payload);
      const intentHash = Sha256Service.hashString(serialized);

      const output: SimulationOrderIntent = {
        ...payload,
        intentHash,
      };

      return Object.freeze(output);
    } catch (err: any) {
      throw new SimulationOrderIntentInvalidError(
        err.message || 'Simulation order intent is invalid.'
      );
    }
  }
}
