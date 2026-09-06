import { describe, it, expect } from 'vitest';
import { SimulationOrderAcceptanceDomain, SimulationOrderAcceptanceInvalidError } from '../../../src/domain/order-execution/SimulationOrderAcceptance';
import { SimulationOrderIntentDomain } from '../../../src/domain/order-execution/SimulationOrderIntent';
import { SimulationRiskCheckResultDomain } from '../../../src/domain/order-execution/SimulationRiskCheckResult';

describe('SimulationOrderAcceptanceDomain', () => {
  const FROZEN_BUY_INTENT = {
    contractVersion: '1.0' as const,
    orderKind: 'SIMULATION_ORDER_INTENT' as const,
    runBusinessKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    simulationDate: '2026-08-01',
    instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2026-08-01',
    side: 'BUY' as const,
    quantity: '100',
    orderType: 'MARKET' as const,
    sourceDecisionHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    intentHash: 'f4699f1b21c9c6d99534d4ee01a0454c91705df645adf2a5053be32cf95c433e'
  } as const;

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
  } as const;

  const FROZEN_STRATEGY_PASS_RESULT = {
    contractVersion: '1.0' as const,
    resultKind: 'SIMULATION_RISK_CHECK_RESULT' as const,
    intentHash: 'f4699f1b21c9c6d99534d4ee01a0454c91705df645adf2a5053be32cf95c433e',
    policyCode: 'STRATEGY_RISK' as const,
    policyVersionHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    passed: true,
    checks: [
      { checkCode: 'CONCENTRATION_LIMIT_VALID', passed: true, reasonCode: null },
      { checkCode: 'WASH_TRADING_FREE', passed: true, reasonCode: null }
    ],
    resultHash: 'fac6f5826ed75fad5ede6c320f08155af635e64a9bec7c572f97da7f102e9f05'
  } as const;

  const FROZEN_SELL_INTENT = SimulationOrderIntentDomain.build({
    runBusinessKey: FROZEN_BUY_INTENT.runBusinessKey,
    simulationDate: FROZEN_BUY_INTENT.simulationDate,
    instrumentBusinessKey: FROZEN_BUY_INTENT.instrumentBusinessKey,
    side: 'SELL',
    quantity: 100n,
    orderType: 'MARKET',
    sourceDecisionHash: FROZEN_BUY_INTENT.sourceDecisionHash
  });

  const FROZEN_SELL_HARD_PASS_RESULT = SimulationRiskCheckResultDomain.build({
    intentHash: FROZEN_SELL_INTENT.intentHash,
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

  const FROZEN_SELL_STRATEGY_PASS_RESULT = SimulationRiskCheckResultDomain.build({
    intentHash: FROZEN_SELL_INTENT.intentHash,
    policyCode: 'STRATEGY_RISK',
    policyVersionHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    checks: [
      { checkCode: 'CONCENTRATION_LIMIT_VALID', passed: true, reasonCode: null },
      { checkCode: 'WASH_TRADING_FREE', passed: true, reasonCode: null }
    ]
  });

  const validBase = {
    intent: FROZEN_BUY_INTENT,
    hardMarketIntegrityResult: FROZEN_HARD_PASS_RESULT,
    strategyRiskResult: FROZEN_STRATEGY_PASS_RESULT,
    eligibleSessionDate: '2026-08-03'
  };

  const sellBase = {
    intent: FROZEN_SELL_INTENT,
    hardMarketIntegrityResult: FROZEN_SELL_HARD_PASS_RESULT,
    strategyRiskResult: FROZEN_SELL_STRATEGY_PASS_RESULT,
    eligibleSessionDate: '2026-08-03'
  };

  const expectThrow = (input: any) => {
    expect(() => SimulationOrderAcceptanceDomain.accept(input)).toThrow(SimulationOrderAcceptanceInvalidError);
  };

  describe('Success Behaviors', () => {
    it('1. canonical BUY pipeline creates Order', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.orderHash).toBe('a484fc182aa35209dece0d8ec0d1d16f22bb01cbe212501146624a572adda642');
    });

    it('2. canonical SELL pipeline creates Order', () => {
      const result = SimulationOrderAcceptanceDomain.accept(sellBase as any);
      expect(result.orderHash).toBeDefined();
    });

    it('3. status exactly ACCEPTED', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.status).toBe('ACCEPTED');
    });

    it('4. orderKind exactly SIMULATION_ORDER', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.orderKind).toBe('SIMULATION_ORDER');
    });

    it('5. contractVersion exactly 1.0', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.contractVersion).toBe('1.0');
    });

    it('6. intentHash inherited exactly', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.intentHash).toBe(validBase.intent.intentHash);
    });

    it('7. runBusinessKey inherited exactly', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.runBusinessKey).toBe(validBase.intent.runBusinessKey);
    });

    it('8. simulationDate inherited exactly', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.simulationDate).toBe(validBase.intent.simulationDate);
    });

    it('9. instrumentBusinessKey inherited exactly', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.instrumentBusinessKey).toBe(validBase.intent.instrumentBusinessKey);
    });

    it('10. side inherited exactly', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.side).toBe(validBase.intent.side);
    });

    it('11. quantity inherited exactly', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.quantity).toBe(validBase.intent.quantity);
    });

    it('12. orderType inherited exactly', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.orderType).toBe(validBase.intent.orderType);
    });

    it('13. sourceDecisionHash inherited exactly', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.sourceDecisionHash).toBe(validBase.intent.sourceDecisionHash);
    });

    it('14. hard resultHash inherited exactly', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.hardMarketIntegrityResultHash).toBe(validBase.hardMarketIntegrityResult.resultHash);
    });

    it('15. strategy resultHash inherited exactly', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.strategyRiskResultHash).toBe(validBase.strategyRiskResult.resultHash);
    });

    it('16. eligibleSessionDate exact', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.eligibleSessionDate).toBe('2026-08-03');
    });

    it('17. frozen BUY orderHash', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(result.orderHash).toBe('a484fc182aa35209dece0d8ec0d1d16f22bb01cbe212501146624a572adda642');
    });

    it('18. second eligible-date frozen orderHash', () => {
      const result = SimulationOrderAcceptanceDomain.accept({ ...validBase, eligibleSessionDate: '2026-08-04' } as any);
      expect(result.orderHash).toBe('5d1bbd655d9ef3098a1b430ccb4026d0dc9d990fcf6c05cd76ef3c8f62522ae1');
    });
  });

  describe('Intent Integrity Tests', () => {
    it('19. null intent', () => expectThrow({ ...validBase, intent: null }));
    it('20. array intent', () => expectThrow({ ...validBase, intent: [] }));
    it('21. malformed intent', () => expectThrow({ ...validBase, intent: {} }));
    it('22. numeric quantity', () => expectThrow({ ...validBase, intent: { ...validBase.intent, quantity: 100 } }));
    it('23. leading-zero quantity', () => expectThrow({ ...validBase, intent: { ...validBase.intent, quantity: '0100' } }));
    it('24. plus-prefixed quantity', () => expectThrow({ ...validBase, intent: { ...validBase.intent, quantity: '+100' } }));
    it('25. hex quantity', () => expectThrow({ ...validBase, intent: { ...validBase.intent, quantity: '0x64' } }));
    it('26. whitespace quantity', () => expectThrow({ ...validBase, intent: { ...validBase.intent, quantity: ' 100 ' } }));
    it('27. exponent quantity', () => expectThrow({ ...validBase, intent: { ...validBase.intent, quantity: '1e2' } }));
    it('28. decimal quantity', () => expectThrow({ ...validBase, intent: { ...validBase.intent, quantity: '100.0' } }));
    it('29. zero quantity', () => expectThrow({ ...validBase, intent: { ...validBase.intent, quantity: '0' } }));
    it('30. negative quantity', () => expectThrow({ ...validBase, intent: { ...validBase.intent, quantity: '-100' } }));
    it('31. tampered contractVersion', () => expectThrow({ ...validBase, intent: { ...validBase.intent, contractVersion: '2.0' } }));
    it('32. tampered orderKind', () => expectThrow({ ...validBase, intent: { ...validBase.intent, orderKind: 'OTHER' } }));
    it('33. tampered runBusinessKey', () => expectThrow({ ...validBase, intent: { ...validBase.intent, runBusinessKey: 'b'.repeat(64) } }));
    it('34. tampered simulationDate', () => expectThrow({ ...validBase, intent: { ...validBase.intent, simulationDate: '2026-08-02' } }));
    it('35. tampered instrumentBusinessKey', () => expectThrow({ ...validBase, intent: { ...validBase.intent, instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2026-08-02' } }));
    it('36. tampered side', () => expectThrow({ ...validBase, intent: { ...validBase.intent, side: 'SELL' } }));
    it('37. tampered orderType', () => expectThrow({ ...validBase, intent: { ...validBase.intent, orderType: 'LIMIT' } }));
    it('38. tampered sourceDecisionHash', () => expectThrow({ ...validBase, intent: { ...validBase.intent, sourceDecisionHash: 'c'.repeat(64) } }));
    it('39. tampered intentHash', () => expectThrow({ ...validBase, intent: { ...validBase.intent, intentHash: 'a'.repeat(64) } }));
  });

  describe('Hard Result Validation Tests', () => {
    it('40. null hard result', () => expectThrow({ ...validBase, hardMarketIntegrityResult: null }));
    it('41. array hard result', () => expectThrow({ ...validBase, hardMarketIntegrityResult: [] }));
    it('42. wrong policyCode', () => expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, policyCode: 'OTHER' } }));
    it('43. hard passed=false', () => {
      const tampered = { ...validBase.hardMarketIntegrityResult, passed: false };
      expectThrow({ ...validBase, hardMarketIntegrityResult: tampered });
    });
    it('44. one failed Hard check', () => {
      const checks = [...validBase.hardMarketIntegrityResult.checks];
      checks[0] = { ...checks[0], passed: false } as any;
      expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, checks } });
    });
    it('45. non-null Hard failure reason on PASS', () => {
      const checks = [...validBase.hardMarketIntegrityResult.checks];
      checks[0] = { ...checks[0], reasonCode: 'SOME' } as any;
      expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, checks } });
    });
    it('46. tampered hard resultHash', () => expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, resultHash: 'a'.repeat(64) } }));
    it('47. tampered hard intentHash', () => expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, intentHash: 'a'.repeat(64) } }));
    it('48. tampered hard policyVersionHash', () => expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, policyVersionHash: 'a'.repeat(64) } }));
    it('49. tampered hard contractVersion', () => expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, contractVersion: '2.0' } }));
    it('50. tampered hard resultKind', () => expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, resultKind: 'OTHER' } }));
    it('51. missing Hard check', () => {
      const checks = [...validBase.hardMarketIntegrityResult.checks];
      checks.pop();
      expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, checks } });
    });
    it('52. extra Hard check', () => {
      const checks = [...validBase.hardMarketIntegrityResult.checks, { checkCode: 'EXTRA', passed: true, reasonCode: null }] as any;
      expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, checks } });
    });
    it('53. arbitrary Hard check set', () => {
      const checks = [{ checkCode: 'AVAILABLE_CASH', passed: true, reasonCode: null }] as any;
      expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, checks } });
    });
    it('54. both BUY and SELL balance checks', () => {
      const checks = [...validBase.hardMarketIntegrityResult.checks, { checkCode: 'SELLABLE_QUANTITY', passed: true, reasonCode: null }] as any;
      expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, checks } });
    });
    it('55. noncanonical Hard check order', () => {
      const checks = [...validBase.hardMarketIntegrityResult.checks];
      const temp = checks[0];
      checks[0] = checks[1];
      checks[1] = temp;
      expectThrow({ ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult, checks } });
    });
  });

  describe('Strategy Result Validation Tests', () => {
    it('56. null strategy result', () => expectThrow({ ...validBase, strategyRiskResult: null }));
    it('57. array strategy result', () => expectThrow({ ...validBase, strategyRiskResult: [] }));
    it('58. wrong policyCode', () => expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, policyCode: 'OTHER' } }));
    it('59. strategy passed=false', () => expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, passed: false } }));
    it('60. concentration failure', () => {
      const checks = [...validBase.strategyRiskResult.checks];
      checks[0] = { ...checks[0], passed: false } as any;
      expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, checks } });
    });
    it('61. wash-trading failure', () => {
      const checks = [...validBase.strategyRiskResult.checks];
      checks[1] = { ...checks[1], passed: false } as any;
      expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, checks } });
    });
    it('62. non-null Strategy failure reason on PASS', () => {
      const checks = [...validBase.strategyRiskResult.checks];
      checks[0] = { ...checks[0], reasonCode: 'SOME' } as any;
      expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, checks } });
    });
    it('63. tampered strategy resultHash', () => expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, resultHash: 'a'.repeat(64) } }));
    it('64. tampered strategy intentHash', () => expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, intentHash: 'a'.repeat(64) } }));
    it('65. tampered strategy policyVersionHash', () => expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, policyVersionHash: 'a'.repeat(64) } }));
    it('66. tampered strategy contractVersion', () => expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, contractVersion: '2.0' } }));
    it('67. tampered strategy resultKind', () => expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, resultKind: 'OTHER' } }));
    it('68. missing Strategy check', () => {
      const checks = [...validBase.strategyRiskResult.checks];
      checks.pop();
      expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, checks } });
    });
    it('69. extra Strategy check', () => {
      const checks = [...validBase.strategyRiskResult.checks, { checkCode: 'EXTRA', passed: true, reasonCode: null }] as any;
      expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, checks } });
    });
    it('70. arbitrary Strategy check', () => {
      const checks = [{ checkCode: 'SOME_CHECK', passed: true, reasonCode: null }] as any;
      expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, checks } });
    });
    it('71. reversed/noncanonical Strategy check order', () => {
      const checks = [...validBase.strategyRiskResult.checks];
      const temp = checks[0];
      checks[0] = checks[1];
      checks[1] = temp;
      expectThrow({ ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult, checks } });
    });
  });

  describe('Cross-Artifact Identity Tests', () => {
    it('72. Hard result valid but belongs to different intentHash', () => {
      const otherIntent = SimulationOrderIntentDomain.build({
        ...validBase.intent,
        quantity: BigInt(validBase.intent.quantity),
        runBusinessKey: 'c'.repeat(64)
      });
      const hard = SimulationRiskCheckResultDomain.build({
        ...validBase.hardMarketIntegrityResult,
        intentHash: otherIntent.intentHash
      });
      expectThrow({ ...validBase, hardMarketIntegrityResult: hard });
    });
    it('73. Strategy result valid but belongs to different intentHash', () => {
      const otherIntent = SimulationOrderIntentDomain.build({
        ...validBase.intent,
        quantity: BigInt(validBase.intent.quantity),
        runBusinessKey: 'c'.repeat(64)
      });
      const strategy = SimulationRiskCheckResultDomain.build({
        ...validBase.strategyRiskResult,
        intentHash: otherIntent.intentHash
      });
      expectThrow({ ...validBase, strategyRiskResult: strategy });
    });
    it('74. Hard and Strategy belong to same different Intent but supplied Intent differs', () => {
      const otherIntent = SimulationOrderIntentDomain.build({
        ...validBase.intent,
        quantity: BigInt(validBase.intent.quantity),
        runBusinessKey: 'c'.repeat(64)
      });
      const hard = SimulationRiskCheckResultDomain.build({
        ...validBase.hardMarketIntegrityResult,
        intentHash: otherIntent.intentHash
      });
      const strategy = SimulationRiskCheckResultDomain.build({
        ...validBase.strategyRiskResult,
        intentHash: otherIntent.intentHash
      });
      expectThrow({ ...validBase, hardMarketIntegrityResult: hard, strategyRiskResult: strategy });
    });
    it('75. Hard and Strategy intentHashes differ from each other', () => {
      const otherIntent = SimulationOrderIntentDomain.build({
        ...validBase.intent,
        quantity: BigInt(validBase.intent.quantity),
        runBusinessKey: 'c'.repeat(64)
      });
      const strategy = SimulationRiskCheckResultDomain.build({
        ...validBase.strategyRiskResult,
        intentHash: otherIntent.intentHash
      });
      expectThrow({ ...validBase, strategyRiskResult: strategy });
    });
  });

  describe('Eligibility Date Tests', () => {
    it('76. canonical later date', () => {
      const result = SimulationOrderAcceptanceDomain.accept({ ...validBase, eligibleSessionDate: '2026-08-04' } as any);
      expect(result.eligibleSessionDate).toBe('2026-08-04');
    });
    it('77. same-day date', () => expectThrow({ ...validBase, eligibleSessionDate: '2026-08-01' }));
    it('78. earlier date', () => expectThrow({ ...validBase, eligibleSessionDate: '2026-07-31' }));
    it('79. malformed YYYY-M-D', () => expectThrow({ ...validBase, eligibleSessionDate: '2026-8-2' }));
    it('80. timestamp', () => expectThrow({ ...validBase, eligibleSessionDate: '2026-08-03T00:00:00Z' }));
    it('81. leading whitespace', () => expectThrow({ ...validBase, eligibleSessionDate: ' 2026-08-03' }));
    it('82. trailing whitespace', () => expectThrow({ ...validBase, eligibleSessionDate: '2026-08-03 ' }));
    it('83. impossible calendar date', () => expectThrow({ ...validBase, eligibleSessionDate: '2026-02-30' }));
    it('84. empty string', () => expectThrow({ ...validBase, eligibleSessionDate: '' }));
    it('85. null', () => expectThrow({ ...validBase, eligibleSessionDate: null }));
    it('86. number', () => expectThrow({ ...validBase, eligibleSessionDate: 20260803 }));
  });

  describe('Determinism Tests', () => {
    it('87. same input -> same orderHash', () => {
      const r1 = SimulationOrderAcceptanceDomain.accept(validBase as any);
      const r2 = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(r1.orderHash).toBe(r2.orderHash);
    });
    it('88. repeated acceptance -> deep equal', () => {
      const r1 = SimulationOrderAcceptanceDomain.accept(validBase as any);
      const r2 = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(r1).toEqual(r2);
    });
    it('89. eligibleSessionDate change -> different hash', () => {
      const r1 = SimulationOrderAcceptanceDomain.accept(validBase as any);
      const r2 = SimulationOrderAcceptanceDomain.accept({ ...validBase, eligibleSessionDate: '2026-08-05' } as any);
      expect(r1.orderHash).not.toBe(r2.orderHash);
    });
    it('90. Hard resultHash change through valid different Hard policy provenance -> different Order hash', () => {
      const hard2 = SimulationRiskCheckResultDomain.build({
        ...validBase.hardMarketIntegrityResult,
        policyVersionHash: 'a'.repeat(64)
      });
      const r1 = SimulationOrderAcceptanceDomain.accept(validBase as any);
      const r2 = SimulationOrderAcceptanceDomain.accept({ ...validBase, hardMarketIntegrityResult: hard2 } as any);
      expect(r1.orderHash).not.toBe(r2.orderHash);
    });
    it('91. Strategy resultHash change through valid different Strategy policy provenance -> different Order hash', () => {
      const strategy2 = SimulationRiskCheckResultDomain.build({
        ...validBase.strategyRiskResult,
        policyVersionHash: 'a'.repeat(64)
      });
      const r1 = SimulationOrderAcceptanceDomain.accept(validBase as any);
      const r2 = SimulationOrderAcceptanceDomain.accept({ ...validBase, strategyRiskResult: strategy2 } as any);
      expect(r1.orderHash).not.toBe(r2.orderHash);
    });
    it('92. caller input not mutated', () => {
      const input = { ...validBase };
      SimulationOrderAcceptanceDomain.accept(input as any);
      expect(input).toEqual(validBase);
    });
    it('93. intent not mutated', () => {
      const input = { ...validBase, intent: { ...validBase.intent } };
      SimulationOrderAcceptanceDomain.accept(input as any);
      expect(input.intent).toEqual(validBase.intent);
    });
    it('94. Hard result not mutated', () => {
      const input = { ...validBase, hardMarketIntegrityResult: { ...validBase.hardMarketIntegrityResult } };
      SimulationOrderAcceptanceDomain.accept(input as any);
      expect(input.hardMarketIntegrityResult).toEqual(validBase.hardMarketIntegrityResult);
    });
    it('95. Strategy result not mutated', () => {
      const input = { ...validBase, strategyRiskResult: { ...validBase.strategyRiskResult } };
      SimulationOrderAcceptanceDomain.accept(input as any);
      expect(input.strategyRiskResult).toEqual(validBase.strategyRiskResult);
    });
    it('96. output frozen', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('Error Contract Tests', () => {
    const getError = () => {
      try {
        SimulationOrderAcceptanceDomain.accept(null as any);
        throw new Error('fail');
      } catch (e: any) {
        return e;
      }
    };
    it('97. instanceof SimulationOrderAcceptanceInvalidError', () => {
      expect(getError() instanceof SimulationOrderAcceptanceInvalidError).toBe(true);
    });
    it('98. instanceof Error', () => {
      expect(getError() instanceof Error).toBe(true);
    });
    it('99. code exact', () => {
      expect(getError().code).toBe('SIMULATION_ORDER_ACCEPTANCE_INVALID');
    });
    it('100. name exact', () => {
      expect(getError().name).toBe('SimulationOrderAcceptanceInvalidError');
    });
    it('101. default message exact', () => {
      expect(getError().message).toBe('Simulation order acceptance input is invalid.');
    });
    it('102. prototype exact', () => {
      expect(Object.getPrototypeOf(getError())).toBe(SimulationOrderAcceptanceInvalidError.prototype);
    });
  });

  describe('Order Output MUST NOT contain tests', () => {
    it('103. no reservation', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect((result as any).reservation).toBeUndefined();
      expect((result as any).reservationHash).toBeUndefined();
      expect((result as any).reservedCash).toBeUndefined();
      expect((result as any).reservedQuantity).toBeUndefined();
    });
    it('104. no execution', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect((result as any).price).toBeUndefined();
      expect((result as any).fee).toBeUndefined();
      expect((result as any).tax).toBeUndefined();
      expect((result as any).fill).toBeUndefined();
      expect((result as any).execution).toBeUndefined();
      expect((result as any).settlement).toBeUndefined();
    });
    it('105. no timestamp/db fields', () => {
      const result = SimulationOrderAcceptanceDomain.accept(validBase as any);
      expect((result as any).acceptedAt).toBeUndefined();
      expect((result as any).createdAt).toBeUndefined();
      expect((result as any).updatedAt).toBeUndefined();
      expect((result as any).databaseId).toBeUndefined();
      expect((result as any).id).toBeUndefined();
    });
  });

  describe('Hard Risk Side Binding Tests', () => {
    it('106. BUY intent rejects canonical SELL Hard check set', () => {
      const hard = SimulationRiskCheckResultDomain.build({
        ...FROZEN_HARD_PASS_RESULT,
        checks: FROZEN_SELL_HARD_PASS_RESULT.checks
      });
      expectThrow({
        intent: FROZEN_BUY_INTENT,
        strategyRiskResult: FROZEN_STRATEGY_PASS_RESULT,
        eligibleSessionDate: '2026-08-03',
        hardMarketIntegrityResult: hard
      });
    });

    it('107. SELL intent rejects canonical BUY Hard check set', () => {
      const hard = SimulationRiskCheckResultDomain.build({
        ...FROZEN_SELL_HARD_PASS_RESULT,
        checks: FROZEN_HARD_PASS_RESULT.checks
      });
      expectThrow({
        intent: FROZEN_SELL_INTENT,
        strategyRiskResult: FROZEN_SELL_STRATEGY_PASS_RESULT,
        eligibleSessionDate: '2026-08-03',
        hardMarketIntegrityResult: hard
      });
    });
  });
});
