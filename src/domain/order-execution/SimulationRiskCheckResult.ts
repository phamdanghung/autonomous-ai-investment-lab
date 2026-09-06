import { DomainError } from '../errors/DomainErrors';
import { CanonicalSerializer } from '../hashing/CanonicalSerializer';
import { Sha256Service } from '../services/Sha256Service';
import {
  SIMULATION_RISK_CHECK_RESULT_CONTRACT_VERSION,
  SIMULATION_RISK_CHECK_RESULT_KIND,
  SimulationRiskPolicyCode,
  SimulationRiskCheckObservationInput,
  CanonicalSimulationRiskCheckObservation,
  SimulationRiskCheckResultInput,
  CanonicalSimulationRiskCheckResultPayload,
  SimulationRiskCheckResult
} from '../contracts/SimulationRiskCheckResultContracts';

export class SimulationRiskCheckResultInvalidError extends DomainError {
  constructor(message: string = 'Simulation risk check result is invalid.') {
    super(message, 'SIMULATION_RISK_CHECK_RESULT_INVALID');
    this.name = 'SimulationRiskCheckResultInvalidError';
    Object.setPrototypeOf(this, SimulationRiskCheckResultInvalidError.prototype);
  }
}

export class SimulationRiskCheckResultDomain {
  static build(input: SimulationRiskCheckResultInput): SimulationRiskCheckResult {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Input must be a non-null object.');
      }

      const { intentHash, policyCode, policyVersionHash, checks } = input as any;

      if (typeof intentHash !== 'string' || !/^[a-f0-9]{64}$/.test(intentHash)) {
        throw new Error('intentHash must be exactly 64 lowercase hex characters.');
      }

      if (policyCode !== 'HARD_MARKET_INTEGRITY' && policyCode !== 'STRATEGY_RISK') {
        throw new Error('Invalid policyCode.');
      }

      if (typeof policyVersionHash !== 'string' || !/^[a-f0-9]{64}$/.test(policyVersionHash)) {
        throw new Error('policyVersionHash must be exactly 64 lowercase hex characters.');
      }

      if (!Array.isArray(checks) || checks.length === 0) {
        throw new Error('checks must be a non-empty array.');
      }

      const seenCodes = new Set<string>();
      const canonicalChecks: CanonicalSimulationRiskCheckObservation[] = [];

      for (const check of checks) {
        if (!check || typeof check !== 'object' || Array.isArray(check)) {
          throw new Error('Invalid check element.');
        }

        const { checkCode, passed, reasonCode } = check;

        if (typeof checkCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(checkCode)) {
          throw new Error('Invalid checkCode.');
        }

        if (seenCodes.has(checkCode)) {
          throw new Error('Duplicate checkCode.');
        }
        seenCodes.add(checkCode);

        if (typeof passed !== 'boolean') {
          throw new Error('passed must be boolean.');
        }

        if (passed) {
          if (reasonCode !== null) {
            throw new Error('PASS requires null reasonCode.');
          }
        } else {
          if (typeof reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(reasonCode)) {
            throw new Error('FAIL requires valid canonical reasonCode.');
          }
        }

        canonicalChecks.push({ checkCode, passed, reasonCode });
      }

      canonicalChecks.sort((a, b) => a.checkCode < b.checkCode ? -1 : (a.checkCode > b.checkCode ? 1 : 0));

      const aggregatePassed = canonicalChecks.every(c => c.passed === true);

      const payload: CanonicalSimulationRiskCheckResultPayload = {
        contractVersion: SIMULATION_RISK_CHECK_RESULT_CONTRACT_VERSION,
        resultKind: SIMULATION_RISK_CHECK_RESULT_KIND,
        intentHash,
        policyCode,
        policyVersionHash,
        passed: aggregatePassed,
        checks: canonicalChecks
      };

      const serialized = CanonicalSerializer.serialize(payload);
      const resultHash = Sha256Service.hashString(serialized);

      const output: SimulationRiskCheckResult = {
        ...payload,
        resultHash
      };

      for (const c of canonicalChecks) {
        Object.freeze(c);
      }
      Object.freeze(output.checks);
      Object.freeze(output);

      return output;
    } catch (err: any) {
      throw new SimulationRiskCheckResultInvalidError();
    }
  }
}
