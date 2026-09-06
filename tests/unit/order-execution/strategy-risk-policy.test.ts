import { describe, it, expect } from 'vitest';
import { StrategyRiskPolicyDomain, StrategyRiskPolicyInvalidError } from '../../../src/domain/order-execution/StrategyRiskPolicy';
import { SimulationRiskCheckResultDomain } from '../../../src/domain/order-execution/SimulationRiskCheckResult';

describe('StrategyRiskPolicyDomain', () => {
  const FROZEN_HARD_PASS_RESULT = {
    contractVersion: '1.0' as const,
    resultKind: 'SIMULATION_RISK_CHECK_RESULT' as const,
    intentHash: 'f4699f1b21c9c6d99534d4ee01a0454c91705df645adf2a5053be32cf95c433e',
    policyCode: 'HARD_MARKET_INTEGRITY' as const,
    policyVersionHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    passed: true,
    checks: [
      { checkCode: 'AVAILABLE_CASH', passed: true, reasonCode: null },
      { checkCode: 'IDEMPOTENCY_UNIQUE', passed: true, reasonCode: null },
      { checkCode: 'INSTRUMENT_TRADABLE', passed: true, reasonCode: null },
      { checkCode: 'LOT_SIZE_VALID', passed: true, reasonCode: null },
      { checkCode: 'MARKET_DATA_VALID', passed: true, reasonCode: null }
    ],
    resultHash: 'c8eeb780b903db47b0523618bc7e06bb811dddc1acd8ebdfb48cc67547ea8110'
  };

  const FROZEN_SELL_HARD_PASS_RESULT = SimulationRiskCheckResultDomain.build({
    intentHash: 'f4699f1b21c9c6d99534d4ee01a0454c91705df645adf2a5053be32cf95c433e',
    policyCode: 'HARD_MARKET_INTEGRITY',
    policyVersionHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    checks: [
      { checkCode: 'IDEMPOTENCY_UNIQUE', passed: true, reasonCode: null },
      { checkCode: 'INSTRUMENT_TRADABLE', passed: true, reasonCode: null },
      { checkCode: 'LOT_SIZE_VALID', passed: true, reasonCode: null },
      { checkCode: 'MARKET_DATA_VALID', passed: true, reasonCode: null },
      { checkCode: 'SELLABLE_QUANTITY', passed: true, reasonCode: null }
    ]
  });

  const validBase = {
    hardMarketIntegrityResult: FROZEN_HARD_PASS_RESULT,
    policyVersionHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    concentrationLimitValid: true,
    washTradingFree: true
  };

  const expectThrow = (input: any) => {
    expect(() => StrategyRiskPolicyDomain.evaluate(input)).toThrow(StrategyRiskPolicyInvalidError);
  };

  describe('Valid behaviors', () => {
    it('1. both Strategy checks PASS', () => {
      const result = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(result.passed).toBe(true);
    });

    it('2. concentration FAIL returns result', () => {
      const result = StrategyRiskPolicyDomain.evaluate({ ...validBase, concentrationLimitValid: false });
      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.checkCode === 'CONCENTRATION_LIMIT_VALID')?.passed).toBe(false);
    });

    it('3. wash-trading FAIL returns result', () => {
      const result = StrategyRiskPolicyDomain.evaluate({ ...validBase, washTradingFree: false });
      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.checkCode === 'WASH_TRADING_FREE')?.passed).toBe(false);
    });

    it('4. both Strategy checks FAIL returns result', () => {
      const result = StrategyRiskPolicyDomain.evaluate({ ...validBase, concentrationLimitValid: false, washTradingFree: false });
      expect(result.passed).toBe(false);
    });

    it('5. exactly 2 checks', () => {
      const result = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(result.checks.length).toBe(2);
    });

    it('6. canonical check order', () => {
      const result = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(result.checks[0].checkCode).toBe('CONCENTRATION_LIMIT_VALID');
      expect(result.checks[1].checkCode).toBe('WASH_TRADING_FREE');
    });

    it('7. policyCode exactly STRATEGY_RISK', () => {
      const result = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(result.policyCode).toBe('STRATEGY_RISK');
    });

    it('8. intentHash inherited from Hard result', () => {
      const result = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(result.intentHash).toBe(validBase.hardMarketIntegrityResult.intentHash);
    });

    it('9. Strategy result policyVersionHash exact', () => {
      const result = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(result.policyVersionHash).toBe(validBase.policyVersionHash);
    });

    it('10. Strategy PASS frozen hash', () => {
      const result = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(result.resultHash).toBe('fac6f5826ed75fad5ede6c320f08155af635e64a9bec7c572f97da7f102e9f05');
    });

    it('11. concentration FAIL frozen hash', () => {
      const result = StrategyRiskPolicyDomain.evaluate({ ...validBase, concentrationLimitValid: false });
      expect(result.resultHash).toBe('9456a4fba1e3f3ec17ab21e3e996c60ea71b5ff2e7bbbc247d702768dc5ed3a4');
    });

    it('12. wash-trading FAIL frozen hash', () => {
      const result = StrategyRiskPolicyDomain.evaluate({ ...validBase, washTradingFree: false });
      expect(result.resultHash).toBe('9d80e7aa0a27f6274ee0816b43b12ba644999ada0b4562267759231fcde4883c');
    });
  });

  describe('Hard Prerequisite Validation Tests', () => {
    it('13. canonical frozen BUY Hard PASS accepted', () => {
      expect(StrategyRiskPolicyDomain.evaluate(validBase).passed).toBe(true);
    });

    it('14. canonical SELL Hard PASS accepted', () => {
      expect(StrategyRiskPolicyDomain.evaluate({ ...validBase, hardMarketIntegrityResult: FROZEN_SELL_HARD_PASS_RESULT as any }).passed).toBe(true);
    });

    it('15. null hard result', () => expectThrow({ ...validBase, hardMarketIntegrityResult: null }));
    it('16. array hard result', () => expectThrow({ ...validBase, hardMarketIntegrityResult: [] }));
    it('17. STRATEGY_RISK supplied as prerequisite', () => {
      const stratResult = StrategyRiskPolicyDomain.evaluate(validBase);
      expectThrow({ ...validBase, hardMarketIntegrityResult: stratResult });
    });

    it('18. Hard passed=false', () => {
      const failResult = SimulationRiskCheckResultDomain.build({
        ...FROZEN_HARD_PASS_RESULT,
        checks: FROZEN_HARD_PASS_RESULT.checks.map((c: any) => c.checkCode === 'AVAILABLE_CASH' ? { ...c, passed: false, reasonCode: 'INSUFFICIENT_AVAILABLE_CASH' } as any : c)
      });
      expectThrow({ ...validBase, hardMarketIntegrityResult: failResult });
    });

    it('19. one Hard check failed', () => {
      const tampered = { ...FROZEN_HARD_PASS_RESULT, checks: [...FROZEN_HARD_PASS_RESULT.checks] };
      tampered.checks[0] = { ...tampered.checks[0], passed: false };
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('20. one Hard check has non-null reasonCode', () => {
      const tampered = { ...FROZEN_HARD_PASS_RESULT, checks: [...FROZEN_HARD_PASS_RESULT.checks] };
      tampered.checks[0] = { ...tampered.checks[0], reasonCode: 'SOME_REASON' } as any;
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('21. tampered hard resultHash', () => {
      const tampered = { ...FROZEN_HARD_PASS_RESULT, resultHash: 'a'.repeat(64) };
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('22. tampered hard intentHash', () => {
      const tampered = { ...FROZEN_HARD_PASS_RESULT, intentHash: 'a'.repeat(64) };
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('23. tampered Hard policyVersionHash', () => {
      const tampered = { ...FROZEN_HARD_PASS_RESULT, policyVersionHash: 'a'.repeat(64) };
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('24. tampered Hard resultKind', () => {
      const tampered = { ...FROZEN_HARD_PASS_RESULT, resultKind: 'OTHER' };
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('25. tampered Hard contractVersion', () => {
      const tampered = { ...FROZEN_HARD_PASS_RESULT, contractVersion: '2.0' };
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('26. missing Hard check', () => {
      const checks = [...FROZEN_HARD_PASS_RESULT.checks];
      checks.pop();
      const tampered = SimulationRiskCheckResultDomain.build({ ...FROZEN_HARD_PASS_RESULT, checks });
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('27. extra Hard check', () => {
      const checks = [...FROZEN_HARD_PASS_RESULT.checks, { checkCode: 'EXTRA_CHECK', passed: true, reasonCode: null }];
      const tampered = SimulationRiskCheckResultDomain.build({ ...FROZEN_HARD_PASS_RESULT, checks });
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('28. arbitrary one-check Hard result', () => {
      const checks = [{ checkCode: 'AVAILABLE_CASH', passed: true, reasonCode: null }];
      const tampered = SimulationRiskCheckResultDomain.build({ ...FROZEN_HARD_PASS_RESULT, checks });
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('29. both AVAILABLE_CASH and SELLABLE_QUANTITY present', () => {
      const checks = [
        { checkCode: 'AVAILABLE_CASH', passed: true, reasonCode: null },
        { checkCode: 'IDEMPOTENCY_UNIQUE', passed: true, reasonCode: null },
        { checkCode: 'INSTRUMENT_TRADABLE', passed: true, reasonCode: null },
        { checkCode: 'LOT_SIZE_VALID', passed: true, reasonCode: null },
        { checkCode: 'MARKET_DATA_VALID', passed: true, reasonCode: null },
        { checkCode: 'SELLABLE_QUANTITY', passed: true, reasonCode: null }
      ];
      const tampered = SimulationRiskCheckResultDomain.build({ ...FROZEN_HARD_PASS_RESULT, checks });
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });

    it('30. noncanonical Hard check order', () => {
      const checks = [...FROZEN_HARD_PASS_RESULT.checks];
      const temp = checks[0];
      checks[0] = checks[1];
      checks[1] = temp;
      const tampered = { ...FROZEN_HARD_PASS_RESULT, checks };
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });
  });

  describe('Strategy Input Validation Tests', () => {
    it('31. null input', () => expectThrow(null));
    it('32. undefined input', () => expectThrow(undefined));
    it('33. array input', () => expectThrow([]));
    it('34. string input', () => expectThrow('test'));
    it('35. invalid policyVersionHash short', () => expectThrow({ ...validBase, policyVersionHash: 'a' }));
    it('36. uppercase policyVersionHash', () => expectThrow({ ...validBase, policyVersionHash: validBase.policyVersionHash.toUpperCase() }));
    it('37. nonhex policyVersionHash', () => expectThrow({ ...validBase, policyVersionHash: 'z'.repeat(64) }));
    it('38. whitespace policyVersionHash', () => expectThrow({ ...validBase, policyVersionHash: ' ' + validBase.policyVersionHash.substring(1) }));
    it('39. concentrationLimitValid number', () => expectThrow({ ...validBase, concentrationLimitValid: 1 }));
    it('40. concentrationLimitValid string', () => expectThrow({ ...validBase, concentrationLimitValid: 'true' }));
    it('41. concentrationLimitValid null', () => expectThrow({ ...validBase, concentrationLimitValid: null }));
    it('42. washTradingFree number', () => expectThrow({ ...validBase, washTradingFree: 1 }));
    it('43. washTradingFree string', () => expectThrow({ ...validBase, washTradingFree: 'true' }));
    it('44. washTradingFree null', () => expectThrow({ ...validBase, washTradingFree: null }));
  });

  describe('Business Failure Must Not Throw', () => {
    it('45. concentration limit exceeded does not throw', () => {
      expect(() => StrategyRiskPolicyDomain.evaluate({ ...validBase, concentrationLimitValid: false })).not.toThrow();
    });
    it('46. wash trading detected does not throw', () => {
      expect(() => StrategyRiskPolicyDomain.evaluate({ ...validBase, washTradingFree: false })).not.toThrow();
    });
    it('47. both Strategy checks failing does not throw', () => {
      expect(() => StrategyRiskPolicyDomain.evaluate({ ...validBase, concentrationLimitValid: false, washTradingFree: false })).not.toThrow();
    });
  });

  describe('Determinism Tests', () => {
    it('48. same input -> same resultHash', () => {
      const res1 = StrategyRiskPolicyDomain.evaluate(validBase);
      const res2 = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(res1.resultHash).toBe(res2.resultHash);
    });
    it('49. repeated evaluation -> deep equal', () => {
      const res1 = StrategyRiskPolicyDomain.evaluate(validBase);
      const res2 = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(res1).toEqual(res2);
    });
    it('50. different Strategy policyVersionHash -> different hash', () => {
      const res1 = StrategyRiskPolicyDomain.evaluate(validBase);
      const res2 = StrategyRiskPolicyDomain.evaluate({ ...validBase, policyVersionHash: 'a'.repeat(64) });
      expect(res1.resultHash).not.toBe(res2.resultHash);
    });
    it('51. concentration PASS->FAIL changes hash', () => {
      const res1 = StrategyRiskPolicyDomain.evaluate(validBase);
      const res2 = StrategyRiskPolicyDomain.evaluate({ ...validBase, concentrationLimitValid: false });
      expect(res1.resultHash).not.toBe(res2.resultHash);
    });
    it('52. wash PASS->FAIL changes hash', () => {
      const res1 = StrategyRiskPolicyDomain.evaluate(validBase);
      const res2 = StrategyRiskPolicyDomain.evaluate({ ...validBase, washTradingFree: false });
      expect(res1.resultHash).not.toBe(res2.resultHash);
    });
    it('53. identical Strategy booleans with same Hard result -> same hash', () => {
      const res1 = StrategyRiskPolicyDomain.evaluate(validBase);
      const res2 = StrategyRiskPolicyDomain.evaluate({ ...validBase });
      expect(res1.resultHash).toBe(res2.resultHash);
    });
    it('54. input not mutated', () => {
      const input = { ...validBase };
      StrategyRiskPolicyDomain.evaluate(input);
      expect(input).toEqual(validBase);
    });
    it('55. hard result not mutated', () => {
      const input = { ...validBase, hardMarketIntegrityResult: { ...FROZEN_HARD_PASS_RESULT } };
      StrategyRiskPolicyDomain.evaluate(input);
      expect(input.hardMarketIntegrityResult).toEqual(FROZEN_HARD_PASS_RESULT);
    });
    it('56. output frozen', () => {
      const result = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(Object.isFrozen(result)).toBe(true);
    });
    it('57. checks array frozen', () => {
      const result = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(Object.isFrozen(result.checks)).toBe(true);
    });
    it('58. each check frozen', () => {
      const result = StrategyRiskPolicyDomain.evaluate(validBase);
      expect(Object.isFrozen(result.checks[0])).toBe(true);
    });
  });

  describe('Error Contract Tests', () => {
    const getError = () => {
      try {
        StrategyRiskPolicyDomain.evaluate(null as any);
        throw new Error('fail');
      } catch (e: any) {
        return e;
      }
    };
    it('59. instanceof StrategyRiskPolicyInvalidError', () => {
      expect(getError() instanceof StrategyRiskPolicyInvalidError).toBe(true);
    });
    it('60. instanceof Error', () => {
      expect(getError() instanceof Error).toBe(true);
    });
    it('61. error code exact', () => {
      expect(getError().code).toBe('STRATEGY_RISK_POLICY_INVALID');
    });
    it('62. error name exact', () => {
      expect(getError().name).toBe('StrategyRiskPolicyInvalidError');
    });
    it('63. default message exact', () => {
      expect(getError().message).toBe('Strategy risk policy input is invalid.');
    });
    it('64. prototype correct', () => {
      const error = getError();
      expect(Object.getPrototypeOf(error)).toBe(StrategyRiskPolicyInvalidError.prototype);
    });
  });
});
