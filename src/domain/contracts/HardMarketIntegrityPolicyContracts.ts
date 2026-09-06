import type { SimulationOrderIntent } from './SimulationOrderIntentContracts';

export interface HardMarketIntegrityPolicyInput {
  intent: SimulationOrderIntent;

  policyVersionHash: string;

  availableCashVnd: bigint | null;
  requiredCashVnd: bigint | null;

  sellableQuantity: bigint | null;

  instrumentTradable: boolean;
  marketDataValid: boolean;

  boardLotSize: bigint;

  idempotencyUnique: boolean;
}
