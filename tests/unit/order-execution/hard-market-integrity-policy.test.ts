import { describe, it, expect } from 'vitest';
import { HardMarketIntegrityPolicyDomain, HardMarketIntegrityPolicyInvalidError } from '../../../src/domain/order-execution/HardMarketIntegrityPolicy';
import { SimulationOrderIntentDomain } from '../../../src/domain/order-execution/SimulationOrderIntent';
import { SimulationOrderIntent } from '../../../src/domain/contracts/SimulationOrderIntentContracts';

describe('HardMarketIntegrityPolicyDomain', () => {
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
  };

  const FROZEN_SELL_INTENT = SimulationOrderIntentDomain.build({
    ...FROZEN_BUY_INTENT,
    quantity: 100n,
    side: 'SELL'
  });

  const validBuyBase = {
    intent: FROZEN_BUY_INTENT,
    policyVersionHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    availableCashVnd: 2000000n,
    requiredCashVnd: 1500000n,
    sellableQuantity: null,
    instrumentTradable: true,
    marketDataValid: true,
    boardLotSize: 100n,
    idempotencyUnique: true
  };

  const expectThrow = (input: any) => {
    expect(() => HardMarketIntegrityPolicyDomain.evaluate(input)).toThrow(HardMarketIntegrityPolicyInvalidError);
  };

  describe('BUY valid evaluation', () => {
    it('1. all BUY checks PASS', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(result.passed).toBe(true);
    });

    it('2. availableCash == requiredCash PASS', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, availableCashVnd: 1500000n, requiredCashVnd: 1500000n });
      expect(result.passed).toBe(true);
    });

    it('3. availableCash > requiredCash PASS', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, availableCashVnd: 3000000n, requiredCashVnd: 1500000n });
      expect(result.passed).toBe(true);
    });

    it('4. availableCash < requiredCash gives Risk FAIL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, availableCashVnd: 1000000n });
      expect(result.passed).toBe(false);
    });

    it('5. instrumentTradable false gives Risk FAIL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, instrumentTradable: false });
      expect(result.passed).toBe(false);
    });

    it('6. marketDataValid false gives Risk FAIL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, marketDataValid: false });
      expect(result.passed).toBe(false);
    });

    it('7. board lot mismatch gives Risk FAIL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, boardLotSize: 30n });
      expect(result.passed).toBe(false);
    });

    it('8. idempotencyUnique false gives Risk FAIL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, idempotencyUnique: false });
      expect(result.passed).toBe(false);
    });

    it('9. multiple simultaneous failures aggregate to false', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({
        ...validBuyBase,
        idempotencyUnique: false,
        marketDataValid: false
      });
      expect(result.passed).toBe(false);
    });

    it('10. exactly 5 BUY checks', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(result.checks.length).toBe(5);
    });

    it('11. no SELLABLE_QUANTITY check in BUY', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(result.checks.find(c => c.checkCode === 'SELLABLE_QUANTITY')).toBeUndefined();
    });

    it('12. exact failed reason codes', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({
        ...validBuyBase,
        availableCashVnd: 10n,
        marketDataValid: false,
        instrumentTradable: false,
        idempotencyUnique: false,
        boardLotSize: 30n
      });
      expect(result.checks.find(c => c.checkCode === 'AVAILABLE_CASH')?.reasonCode).toBe('INSUFFICIENT_AVAILABLE_CASH');
      expect(result.checks.find(c => c.checkCode === 'IDEMPOTENCY_UNIQUE')?.reasonCode).toBe('DUPLICATE_INTENT');
      expect(result.checks.find(c => c.checkCode === 'INSTRUMENT_TRADABLE')?.reasonCode).toBe('INSTRUMENT_NOT_TRADABLE');
      expect(result.checks.find(c => c.checkCode === 'LOT_SIZE_VALID')?.reasonCode).toBe('INVALID_BOARD_LOT');
      expect(result.checks.find(c => c.checkCode === 'MARKET_DATA_VALID')?.reasonCode).toBe('MARKET_DATA_INVALID');
    });

    it('13. known PASS vector hash', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(result.resultHash).toBe('c8eeb780b903db47b0523618bc7e06bb811dddc1acd8ebdfb48cc67547ea8110');
    });

    it('14. known insufficient-cash vector hash', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({
        ...validBuyBase,
        availableCashVnd: 2000000n,
        requiredCashVnd: 2500000n
      });
      expect(result.resultHash).toBe('eb113c3baa332b60a3f0663eba7fcd434579f9b8ad8611824050f3e6fd266349');
    });
  });

  describe('SELL valid evaluation', () => {
    const validSellBase = {
      ...validBuyBase,
      intent: FROZEN_SELL_INTENT,
      availableCashVnd: null,
      requiredCashVnd: null,
      sellableQuantity: 100n
    };

    it('15. SELL all PASS', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validSellBase);
      expect(result.passed).toBe(true);
    });

    it('16. sellable == quantity PASS', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validSellBase, sellableQuantity: 100n });
      expect(result.passed).toBe(true);
    });

    it('17. sellable > quantity PASS', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validSellBase, sellableQuantity: 200n });
      expect(result.passed).toBe(true);
    });

    it('18. sellable < quantity gives Risk FAIL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validSellBase, sellableQuantity: 99n });
      expect(result.passed).toBe(false);
    });

    it('19. sellable zero with positive quantity FAIL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validSellBase, sellableQuantity: 0n });
      expect(result.passed).toBe(false);
    });

    it('20. exact SELLABLE_QUANTITY reason code', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validSellBase, sellableQuantity: 0n });
      expect(result.checks.find(c => c.checkCode === 'SELLABLE_QUANTITY')?.reasonCode).toBe('INSUFFICIENT_SELLABLE_QUANTITY');
    });

    it('21. exactly 5 SELL checks', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validSellBase);
      expect(result.checks.length).toBe(5);
    });

    it('22. no AVAILABLE_CASH check in SELL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validSellBase);
      expect(result.checks.find(c => c.checkCode === 'AVAILABLE_CASH')).toBeUndefined();
    });

    it('23. lot failure on SELL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validSellBase, boardLotSize: 30n });
      expect(result.passed).toBe(false);
    });

    it('24. market-data failure on SELL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validSellBase, marketDataValid: false });
      expect(result.passed).toBe(false);
    });

    it('25. instrument failure on SELL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validSellBase, instrumentTradable: false });
      expect(result.passed).toBe(false);
    });

    it('26. duplicate-intent failure on SELL', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validSellBase, idempotencyUnique: false });
      expect(result.passed).toBe(false);
    });
  });

  describe('Invalid input tests', () => {
    it('27. null input', () => expectThrow(null));
    it('28. undefined input', () => expectThrow(undefined));
    it('29. array input', () => expectThrow([]));
    it('30. string input', () => expectThrow('test'));
    it('31. null intent', () => expectThrow({ ...validBuyBase, intent: null }));
    it('32. malformed intent object', () => expectThrow({ ...validBuyBase, intent: { bad: true } }));
    it('33. tampered intentHash', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, intentHash: 'a'.repeat(64) } }));
    it('34. tampered intent quantity without matching hash', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, quantity: '200' } }));
    it('35. tampered side without matching hash', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, side: 'SELL' } }));
    it('36. invalid policyVersionHash short', () => expectThrow({ ...validBuyBase, policyVersionHash: 'a' }));
    it('37. uppercase policyVersionHash', () => expectThrow({ ...validBuyBase, policyVersionHash: validBuyBase.policyVersionHash.toUpperCase() }));
    it('38. nonhex policyVersionHash', () => expectThrow({ ...validBuyBase, policyVersionHash: 'z'.repeat(64) }));
    it('39. instrumentTradable nonboolean', () => expectThrow({ ...validBuyBase, instrumentTradable: 1 }));
    it('40. marketDataValid nonboolean', () => expectThrow({ ...validBuyBase, marketDataValid: 1 }));
    it('41. idempotencyUnique nonboolean', () => expectThrow({ ...validBuyBase, idempotencyUnique: 1 }));
    it('42. boardLotSize number', () => expectThrow({ ...validBuyBase, boardLotSize: 100 }));
    it('43. boardLotSize string', () => expectThrow({ ...validBuyBase, boardLotSize: '100' }));
    it('44. boardLotSize zero', () => expectThrow({ ...validBuyBase, boardLotSize: 0n }));
    it('45. boardLotSize negative', () => expectThrow({ ...validBuyBase, boardLotSize: -100n }));

    it('46. availableCash null', () => expectThrow({ ...validBuyBase, availableCashVnd: null }));
    it('47. availableCash number', () => expectThrow({ ...validBuyBase, availableCashVnd: 1000 }));
    it('48. availableCash negative', () => expectThrow({ ...validBuyBase, availableCashVnd: -10n }));
    it('49. requiredCash null', () => expectThrow({ ...validBuyBase, requiredCashVnd: null }));
    it('50. requiredCash number', () => expectThrow({ ...validBuyBase, requiredCashVnd: 1000 }));
    it('51. requiredCash zero', () => expectThrow({ ...validBuyBase, requiredCashVnd: 0n }));
    it('52. requiredCash negative', () => expectThrow({ ...validBuyBase, requiredCashVnd: -10n }));
    it('53. BUY sellableQuantity non-null', () => expectThrow({ ...validBuyBase, sellableQuantity: 100n }));

    const validSellBase = {
      ...validBuyBase,
      intent: FROZEN_SELL_INTENT,
      availableCashVnd: null,
      requiredCashVnd: null,
      sellableQuantity: 100n
    };

    it('54. sellable null', () => expectThrow({ ...validSellBase, sellableQuantity: null }));
    it('55. sellable number', () => expectThrow({ ...validSellBase, sellableQuantity: 100 }));
    it('56. sellable negative', () => expectThrow({ ...validSellBase, sellableQuantity: -100n }));
    it('57. SELL availableCash non-null', () => expectThrow({ ...validSellBase, availableCashVnd: 1000n }));
    it('58. SELL requiredCash non-null', () => expectThrow({ ...validSellBase, requiredCashVnd: 1000n }));
  });

  describe('Business failure must not throw', () => {
    it('59. insufficient cash returns result, does not throw', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, availableCashVnd: 0n });
      expect(result.passed).toBe(false);
    });
    it('60. oversell returns result, does not throw', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({
        ...validBuyBase,
        intent: FROZEN_SELL_INTENT,
        availableCashVnd: null,
        requiredCashVnd: null,
        sellableQuantity: 0n
      });
      expect(result.passed).toBe(false);
    });
    it('61. instrument not tradable returns result, does not throw', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, instrumentTradable: false });
      expect(result.passed).toBe(false);
    });
    it('62. market data invalid returns result, does not throw', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, marketDataValid: false });
      expect(result.passed).toBe(false);
    });
    it('63. invalid lot returns result, does not throw', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, boardLotSize: 30n });
      expect(result.passed).toBe(false);
    });
    it('64. duplicate intent evidence returns result, does not throw', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, idempotencyUnique: false });
      expect(result.passed).toBe(false);
    });
    it('65. all five checks failing simultaneously returns a valid frozen result', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({
        ...validBuyBase,
        availableCashVnd: 0n,
        instrumentTradable: false,
        marketDataValid: false,
        boardLotSize: 30n,
        idempotencyUnique: false
      });
      expect(result.passed).toBe(false);
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('Determinism tests', () => {
    it('66. same input -> same resultHash', () => {
      const res1 = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      const res2 = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(res1.resultHash).toBe(res2.resultHash);
    });
    it('67. repeated evaluation -> deep equal', () => {
      const res1 = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      const res2 = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(res1).toEqual(res2);
    });
    it('68. different policyVersionHash -> different resultHash', () => {
      const res1 = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      const res2 = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, policyVersionHash: 'a'.repeat(64) });
      expect(res1.resultHash).not.toBe(res2.resultHash);
    });
    it('69. different required cash changing verdict -> different hash', () => {
      const res1 = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      const res2 = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, requiredCashVnd: 3000000n }); // Fail
      expect(res1.resultHash).not.toBe(res2.resultHash);
    });
    it('70. different available cash that does NOT change any check result -> same resultHash', () => {
      const res1 = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      const res2 = HardMarketIntegrityPolicyDomain.evaluate({ ...validBuyBase, availableCashVnd: 3000000n });
      expect(res1.resultHash).toBe(res2.resultHash);
    });
    it('71. different sellable quantity that does NOT change any check result -> same resultHash', () => {
      const validSellBase = {
        ...validBuyBase,
        intent: FROZEN_SELL_INTENT,
        availableCashVnd: null,
        requiredCashVnd: null,
        sellableQuantity: 100n
      };
      const res1 = HardMarketIntegrityPolicyDomain.evaluate(validSellBase);
      const res2 = HardMarketIntegrityPolicyDomain.evaluate({ ...validSellBase, sellableQuantity: 200n });
      expect(res1.resultHash).toBe(res2.resultHash);
    });
    it('72. input object not mutated', () => {
      const input = { ...validBuyBase };
      HardMarketIntegrityPolicyDomain.evaluate(input);
      expect(input).toEqual(validBuyBase);
    });
    it('73. intent object not mutated', () => {
      const input = { ...validBuyBase, intent: { ...FROZEN_BUY_INTENT } };
      HardMarketIntegrityPolicyDomain.evaluate(input);
      expect(input.intent).toEqual(FROZEN_BUY_INTENT);
    });
    it('74. output frozen', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(Object.isFrozen(result)).toBe(true);
    });
    it('75. checks frozen', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(Object.isFrozen(result.checks)).toBe(true);
    });
    it('76. each check frozen', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(Object.isFrozen(result.checks[0])).toBe(true);
    });
  });

  describe('Error contract tests', () => {
    const getError = () => {
      try {
        HardMarketIntegrityPolicyDomain.evaluate(null as any);
        throw new Error('fail');
      } catch (e: any) {
        return e;
      }
    };
    it('77. instanceof HardMarketIntegrityPolicyInvalidError', () => {
      expect(getError() instanceof HardMarketIntegrityPolicyInvalidError).toBe(true);
    });
    it('78. instanceof Error', () => {
      expect(getError() instanceof Error).toBe(true);
    });
    it('79. code exact', () => {
      expect(getError().code).toBe('HARD_MARKET_INTEGRITY_POLICY_INVALID');
    });
    it('80. name exact', () => {
      expect(getError().name).toBe('HardMarketIntegrityPolicyInvalidError');
    });
    it('81. default message exact', () => {
      expect(getError().message).toBe('Hard market integrity policy input is invalid.');
    });
    it('82. correct prototype behavior', () => {
      const error = getError();
      expect(Object.getPrototypeOf(error)).toBe(HardMarketIntegrityPolicyInvalidError.prototype);
    });
  });

  describe('Canonical Intent Integrity Closure', () => {
    it('83. numeric quantity: 100 rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, quantity: 100 } }));
    it('84. "0100" rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, quantity: '0100' } }));
    it('85. "+100" rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, quantity: '+100' } }));
    it('86. "0x64" rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, quantity: '0x64' } }));
    it('87. " 100 " rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, quantity: ' 100 ' } }));
    it('88. "1e2" rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, quantity: '1e2' } }));
    it('89. "100.0" rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, quantity: '100.0' } }));
    it('90. "0" rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, quantity: '0' } }));
    it('91. negative decimal quantity rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, quantity: '-100' } }));
    it('92. missing contractVersion rejected', () => {
      const intent: any = { ...FROZEN_BUY_INTENT };
      delete intent.contractVersion;
      expectThrow({ ...validBuyBase, intent });
    });
    it('93. wrong contractVersion rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, contractVersion: '2.0' } }));
    it('94. missing orderKind rejected', () => {
      const intent: any = { ...FROZEN_BUY_INTENT };
      delete intent.orderKind;
      expectThrow({ ...validBuyBase, intent });
    });
    it('95. wrong orderKind rejected', () => expectThrow({ ...validBuyBase, intent: { ...FROZEN_BUY_INTENT, orderKind: 'OTHER' } }));

    it('96. canonical frozen BUY intent still accepted', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(result.passed).toBe(true);
    });

    it('97. canonical rebuilt SELL intent still accepted', () => {
      const validSellBase = {
        ...validBuyBase,
        intent: FROZEN_SELL_INTENT,
        availableCashVnd: null,
        requiredCashVnd: null,
        sellableQuantity: 100n
      };
      const result = HardMarketIntegrityPolicyDomain.evaluate(validSellBase);
      expect(result.passed).toBe(true);
    });

    it('98. frozen BUY PASS resultHash remains unchanged', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate(validBuyBase);
      expect(result.resultHash).toBe('c8eeb780b903db47b0523618bc7e06bb811dddc1acd8ebdfb48cc67547ea8110');
    });

    it('99. frozen insufficient-cash resultHash remains unchanged', () => {
      const result = HardMarketIntegrityPolicyDomain.evaluate({
        ...validBuyBase,
        availableCashVnd: 2000000n,
        requiredCashVnd: 2500000n
      });
      expect(result.resultHash).toBe('eb113c3baa332b60a3f0663eba7fcd434579f9b8ad8611824050f3e6fd266349');
    });
  });
});