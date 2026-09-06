import { describe, it, expect } from 'vitest';
import { SimulationRiskCheckResultDomain, SimulationRiskCheckResultInvalidError } from '../../../src/domain/order-execution/SimulationRiskCheckResult';
import { SimulationRiskCheckResultInput } from '../../../src/domain/contracts/SimulationRiskCheckResultContracts';
import { CanonicalSerializer } from '../../../src/domain/hashing/CanonicalSerializer';

describe('SimulationRiskCheckResultDomain', () => {
  const FROZEN_INTENT = 'a'.repeat(64);
  const FROZEN_POLICY_HASH = 'b'.repeat(64);
  const FROZEN_CHECKS = [
    { checkCode: 'MARKET_DATA_VALID', passed: false, reasonCode: 'STALE_PRICE' },
    { checkCode: 'AVAILABLE_CASH', passed: true, reasonCode: null },
    { checkCode: 'INSTRUMENT_TRADABLE', passed: true, reasonCode: null }
  ];

  const validBase: SimulationRiskCheckResultInput = {
    intentHash: FROZEN_INTENT,
    policyCode: 'HARD_MARKET_INTEGRITY',
    policyVersionHash: FROZEN_POLICY_HASH,
    checks: FROZEN_CHECKS
  };

  const expectThrow = (input: any) => {
    expect(() => SimulationRiskCheckResultDomain.build(input)).toThrow(SimulationRiskCheckResultInvalidError);
  };

  describe('Valid result behavior', () => {
    it('1. valid HARD_MARKET_INTEGRITY all PASS', () => {
      const result = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [{ checkCode: 'A', passed: true, reasonCode: null }]
      });
      expect(result.passed).toBe(true);
      expect(result.policyCode).toBe('HARD_MARKET_INTEGRITY');
    });

    it('2. valid HARD_MARKET_INTEGRITY one FAIL', () => {
      const result = SimulationRiskCheckResultDomain.build(validBase);
      expect(result.passed).toBe(false);
    });

    it('3. valid HARD_MARKET_INTEGRITY multiple FAIL', () => {
      const result = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [
          { checkCode: 'A', passed: false, reasonCode: 'A_REASON' },
          { checkCode: 'B', passed: false, reasonCode: 'B_REASON' }
        ]
      });
      expect(result.passed).toBe(false);
    });

    it('4. valid STRATEGY_RISK all PASS', () => {
      const result = SimulationRiskCheckResultDomain.build({
        ...validBase,
        policyCode: 'STRATEGY_RISK',
        checks: [{ checkCode: 'A', passed: true, reasonCode: null }]
      });
      expect(result.passed).toBe(true);
      expect(result.policyCode).toBe('STRATEGY_RISK');
    });

    it('5. valid STRATEGY_RISK FAIL', () => {
      const result = SimulationRiskCheckResultDomain.build({
        ...validBase,
        policyCode: 'STRATEGY_RISK'
      });
      expect(result.passed).toBe(false);
    });

    it('6. all-pass derives passed=true', () => {
      const result = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [
          { checkCode: 'A', passed: true, reasonCode: null },
          { checkCode: 'B', passed: true, reasonCode: null }
        ]
      });
      expect(result.passed).toBe(true);
    });

    it('7. any-fail derives passed=false', () => {
      const result = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [
          { checkCode: 'A', passed: true, reasonCode: null },
          { checkCode: 'B', passed: false, reasonCode: 'FAIL' },
          { checkCode: 'C', passed: true, reasonCode: null }
        ]
      });
      expect(result.passed).toBe(false);
    });
  });

  describe('Determinism', () => {
    it('8. identical input -> identical resultHash', () => {
      const res1 = SimulationRiskCheckResultDomain.build(validBase);
      const res2 = SimulationRiskCheckResultDomain.build(validBase);
      expect(res1.resultHash).toBe(res2.resultHash);
    });

    it('9. repeated build -> deeply equal canonical result', () => {
      const res1 = SimulationRiskCheckResultDomain.build(validBase);
      const res2 = SimulationRiskCheckResultDomain.build(validBase);
      expect(res1).toEqual(res2);
    });

    it('10. input check order A/B/C equals C/B/A resultHash', () => {
      const res1 = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [
          { checkCode: 'A', passed: true, reasonCode: null },
          { checkCode: 'B', passed: true, reasonCode: null },
          { checkCode: 'C', passed: true, reasonCode: null }
        ]
      });
      const res2 = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [
          { checkCode: 'C', passed: true, reasonCode: null },
          { checkCode: 'B', passed: true, reasonCode: null },
          { checkCode: 'A', passed: true, reasonCode: null }
        ]
      });
      expect(res1.resultHash).toBe(res2.resultHash);
    });

    it('11. canonical output checks sorted', () => {
      const result = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [
          { checkCode: 'Z', passed: true, reasonCode: null },
          { checkCode: 'A', passed: true, reasonCode: null }
        ]
      });
      expect(result.checks[0].checkCode).toBe('A');
      expect(result.checks[1].checkCode).toBe('Z');
    });

    it('12. caller order not retained when noncanonical', () => {
      const result = SimulationRiskCheckResultDomain.build(validBase);
      // Valid base has M, A, I
      expect(result.checks[0].checkCode).toBe('AVAILABLE_CASH');
      expect(result.checks[1].checkCode).toBe('INSTRUMENT_TRADABLE');
      expect(result.checks[2].checkCode).toBe('MARKET_DATA_VALID');
    });
  });

  describe('Hash sensitivity', () => {
    const getBaseHash = () => SimulationRiskCheckResultDomain.build(validBase).resultHash;

    it('13. changing intentHash changes hash', () => {
      const h = SimulationRiskCheckResultDomain.build({ ...validBase, intentHash: 'c'.repeat(64) }).resultHash;
      expect(h).not.toBe(getBaseHash());
    });

    it('14. changing policyCode changes hash', () => {
      const h = SimulationRiskCheckResultDomain.build({ ...validBase, policyCode: 'STRATEGY_RISK' }).resultHash;
      expect(h).not.toBe(getBaseHash());
    });

    it('15. changing policyVersionHash changes hash', () => {
      const h = SimulationRiskCheckResultDomain.build({ ...validBase, policyVersionHash: 'c'.repeat(64) }).resultHash;
      expect(h).not.toBe(getBaseHash());
    });

    it('16. changing checkCode changes hash', () => {
      const h = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [
          { checkCode: 'AVAILABLE_CASH_2', passed: true, reasonCode: null },
          { checkCode: 'INSTRUMENT_TRADABLE', passed: true, reasonCode: null },
          { checkCode: 'MARKET_DATA_VALID', passed: false, reasonCode: 'STALE_PRICE' }
        ]
      }).resultHash;
      expect(h).not.toBe(getBaseHash());
    });

    it('17. changing passed changes hash', () => {
      const h = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [
          { checkCode: 'AVAILABLE_CASH', passed: false, reasonCode: 'NO_CASH' },
          { checkCode: 'INSTRUMENT_TRADABLE', passed: true, reasonCode: null },
          { checkCode: 'MARKET_DATA_VALID', passed: false, reasonCode: 'STALE_PRICE' }
        ]
      }).resultHash;
      expect(h).not.toBe(getBaseHash());
    });

    it('18. changing failed reasonCode changes hash', () => {
      const h = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [
          { checkCode: 'AVAILABLE_CASH', passed: true, reasonCode: null },
          { checkCode: 'INSTRUMENT_TRADABLE', passed: true, reasonCode: null },
          { checkCode: 'MARKET_DATA_VALID', passed: false, reasonCode: 'OTHER' }
        ]
      }).resultHash;
      expect(h).not.toBe(getBaseHash());
    });

    it('19. adding check changes hash', () => {
      const h = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: [...FROZEN_CHECKS, { checkCode: 'EXTRA', passed: true, reasonCode: null }]
      }).resultHash;
      expect(h).not.toBe(getBaseHash());
    });

    it('20. removing check changes hash', () => {
      const h = SimulationRiskCheckResultDomain.build({
        ...validBase,
        checks: FROZEN_CHECKS.slice(1)
      }).resultHash;
      expect(h).not.toBe(getBaseHash());
    });
  });

  describe('Hash validation', () => {
    it('21. short intentHash rejected', () => expectThrow({ ...validBase, intentHash: 'short' }));
    it('22. uppercase intentHash rejected', () => expectThrow({ ...validBase, intentHash: FROZEN_INTENT.toUpperCase() }));
    it('23. nonhex intentHash rejected', () => expectThrow({ ...validBase, intentHash: 'z'.repeat(64) }));
    it('24. whitespace intentHash rejected', () => expectThrow({ ...validBase, intentHash: FROZEN_INTENT + ' ' }));
    it('25. short policyVersionHash rejected', () => expectThrow({ ...validBase, policyVersionHash: 'short' }));
    it('26. uppercase policyVersionHash rejected', () => expectThrow({ ...validBase, policyVersionHash: FROZEN_POLICY_HASH.toUpperCase() }));
    it('27. nonhex policyVersionHash rejected', () => expectThrow({ ...validBase, policyVersionHash: 'z'.repeat(64) }));
    it('28. whitespace policyVersionHash rejected', () => expectThrow({ ...validBase, policyVersionHash: FROZEN_POLICY_HASH + ' ' }));
  });

  describe('Policy validation', () => {
    it('29. lowercase policy rejected', () => expectThrow({ ...validBase, policyCode: 'hard_market_integrity' }));
    it('30. unknown policy rejected', () => expectThrow({ ...validBase, policyCode: 'UNKNOWN' }));
    it('31. whitespace policy rejected', () => expectThrow({ ...validBase, policyCode: ' HARD_MARKET_INTEGRITY' }));
  });

  describe('Checks container', () => {
    it('32. empty checks rejected', () => expectThrow({ ...validBase, checks: [] }));
    it('33. null checks rejected', () => expectThrow({ ...validBase, checks: null }));
    it('34. non-array checks rejected', () => expectThrow({ ...validBase, checks: 'string' }));
    it('35. null check element rejected', () => expectThrow({ ...validBase, checks: [null] }));
    it('36. array check element rejected', () => expectThrow({ ...validBase, checks: [[]] }));
    it('37. duplicate checkCode rejected', () => expectThrow({
      ...validBase,
      checks: [
        { checkCode: 'A', passed: true, reasonCode: null },
        { checkCode: 'A', passed: true, reasonCode: null }
      ]
    }));
  });

  describe('Check code', () => {
    const withCode = (c: any) => ({ ...validBase, checks: [{ checkCode: c, passed: true, reasonCode: null }] });
    it('38. lowercase checkCode rejected', () => expectThrow(withCode('code')));
    it('39. whitespace checkCode rejected', () => expectThrow(withCode('CODE ')));
    it('40. hyphenated checkCode rejected', () => expectThrow(withCode('CO-DE')));
    it('41. empty checkCode rejected', () => expectThrow(withCode('')));
    it('42. > 64 char checkCode rejected', () => expectThrow(withCode('A'.repeat(65))));
  });

  describe('Passed/reason invariant', () => {
    const withCheck = (c: any) => ({ ...validBase, checks: [c] });
    it('43. passed not boolean rejected', () => expectThrow(withCheck({ checkCode: 'A', passed: 'true', reasonCode: null })));
    it('44. PASS with non-null reasonCode rejected', () => expectThrow(withCheck({ checkCode: 'A', passed: true, reasonCode: 'OK' })));
    it('45. FAIL with null reasonCode rejected', () => expectThrow(withCheck({ checkCode: 'A', passed: false, reasonCode: null })));
    it('46. FAIL with lowercase reasonCode rejected', () => expectThrow(withCheck({ checkCode: 'A', passed: false, reasonCode: 'fail' })));
    it('47. FAIL with whitespace reasonCode rejected', () => expectThrow(withCheck({ checkCode: 'A', passed: false, reasonCode: 'FAIL ' })));
    it('48. FAIL with hyphen reasonCode rejected', () => expectThrow(withCheck({ checkCode: 'A', passed: false, reasonCode: 'FA-IL' })));
    it('49. reasonCode >64 rejected', () => expectThrow(withCheck({ checkCode: 'A', passed: false, reasonCode: 'A'.repeat(65) })));
  });

  describe('Input shape', () => {
    it('50. null input rejected', () => expectThrow(null));
    it('51. undefined input rejected', () => expectThrow(undefined));
    it('52. array input rejected', () => expectThrow([]));
    it('53. string input rejected', () => expectThrow('string'));
  });

  describe('Output contract', () => {
    const result = SimulationRiskCheckResultDomain.build(validBase);
    it('54. exact top-level key set', () => {
      const keys = Object.keys(result).sort();
      expect(keys).toEqual(['checks', 'contractVersion', 'intentHash', 'passed', 'policyCode', 'policyVersionHash', 'resultHash', 'resultKind']);
    });
    it('55. exact check key set', () => {
      const keys = Object.keys(result.checks[0]).sort();
      expect(keys).toEqual(['checkCode', 'passed', 'reasonCode']);
    });
    it('56. result contractVersion exact', () => expect(result.contractVersion).toBe('1.0'));
    it('57. resultKind exact', () => expect(result.resultKind).toBe('SIMULATION_RISK_CHECK_RESULT'));
    it('58. resultHash lowercase hex64', () => expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/));
    it('59. top-level frozen', () => expect(Object.isFrozen(result)).toBe(true));
    it('60. checks array frozen', () => expect(Object.isFrozen(result.checks)).toBe(true));
    it('61. individual checks frozen', () => expect(Object.isFrozen(result.checks[0])).toBe(true));
    
    it('62. input object not mutated', () => {
      const input = { ...validBase };
      SimulationRiskCheckResultDomain.build(input);
      expect(input).toEqual(validBase);
    });
    it('63. input checks array not mutated', () => {
      const arr = [...FROZEN_CHECKS];
      SimulationRiskCheckResultDomain.build({ ...validBase, checks: arr });
      expect(arr).toEqual(FROZEN_CHECKS);
    });
    it('64. input check objects not mutated', () => {
      const check = { ...FROZEN_CHECKS[0] };
      SimulationRiskCheckResultDomain.build({ ...validBase, checks: [check] });
      expect(check).toEqual(FROZEN_CHECKS[0]);
    });
  });

  describe('Error contract', () => {
    const getError = () => {
      try {
        SimulationRiskCheckResultDomain.build(null as any);
        throw new Error('fail');
      } catch (e: any) {
        return e;
      }
    };
    it('65. instanceof SimulationRiskCheckResultInvalidError', () => expect(getError() instanceof SimulationRiskCheckResultInvalidError).toBe(true));
    it('66. instanceof Error', () => expect(getError() instanceof Error).toBe(true));
    it('67. code exact', () => expect(getError().code).toBe('SIMULATION_RISK_CHECK_RESULT_INVALID'));
    it('68. name exact', () => expect(getError().name).toBe('SimulationRiskCheckResultInvalidError'));
    it('69. default message exact', () => expect(getError().message).toBe('Simulation risk check result is invalid.'));
  });

  describe('Known vector', () => {
    it('70. frozen canonical serialized payload exact', () => {
      const result = SimulationRiskCheckResultDomain.build(validBase);
      const expectedPayload = {
        contractVersion: '1.0',
        resultKind: 'SIMULATION_RISK_CHECK_RESULT',
        intentHash: FROZEN_INTENT,
        policyCode: 'HARD_MARKET_INTEGRITY',
        policyVersionHash: FROZEN_POLICY_HASH,
        passed: false,
        checks: [
          { checkCode: 'AVAILABLE_CASH', passed: true, reasonCode: null },
          { checkCode: 'INSTRUMENT_TRADABLE', passed: true, reasonCode: null },
          { checkCode: 'MARKET_DATA_VALID', passed: false, reasonCode: 'STALE_PRICE' }
        ]
      };
      const serialized = CanonicalSerializer.serialize(expectedPayload);
      expect(serialized).toBe('{"checks":[{"checkCode":"AVAILABLE_CASH","passed":true,"reasonCode":null},{"checkCode":"INSTRUMENT_TRADABLE","passed":true,"reasonCode":null},{"checkCode":"MARKET_DATA_VALID","passed":false,"reasonCode":"STALE_PRICE"}],"contractVersion":"1.0","intentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","passed":false,"policyCode":"HARD_MARKET_INTEGRITY","policyVersionHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","resultKind":"SIMULATION_RISK_CHECK_RESULT"}');
    });

    it('71. frozen known-vector resultHash exact', () => {
      const result = SimulationRiskCheckResultDomain.build(validBase);
      expect(result.resultHash).toBe('6a4d74ba6677b0a01b0ba43da96c827b61c065da29ae396183ac00c348b87f96');
    });
  });
});
