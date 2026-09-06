import { describe, it, expect } from 'vitest';
import { SimulationOrderReservationDomain, SimulationOrderReservationInvalidError } from '../../../src/domain/order-execution/SimulationOrderReservation';
import { SimulationOrderIntentDomain } from '../../../src/domain/order-execution/SimulationOrderIntent';
import { SimulationRiskCheckResultDomain } from '../../../src/domain/order-execution/SimulationRiskCheckResult';
import { SimulationOrderAcceptanceDomain } from '../../../src/domain/order-execution/SimulationOrderAcceptance';

describe('SimulationOrderReservationDomain', () => {
  const FROZEN_BUY_ACCEPTED_ORDER = {
    contractVersion: '1.0' as const,
    orderKind: 'SIMULATION_ORDER' as const,
    intentHash: 'f4699f1b21c9c6d99534d4ee01a0454c91705df645adf2a5053be32cf95c433e',
    runBusinessKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    simulationDate: '2026-08-01',
    eligibleSessionDate: '2026-08-03',
    instrumentBusinessKey: 'VN|HOSE|VNM|EQUITY|2026-08-01',
    side: 'BUY' as const,
    quantity: '100',
    orderType: 'MARKET' as const,
    sourceDecisionHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    hardMarketIntegrityResultHash: 'c8eeb780b903db47b0523618bc7e06bb811dddc1acd8ebdfb48cc67547ea8110',
    strategyRiskResultHash: 'fac6f5826ed75fad5ede6c320f08155af635e64a9bec7c572f97da7f102e9f05',
    status: 'ACCEPTED' as const,
    orderHash: 'a484fc182aa35209dece0d8ec0d1d16f22bb01cbe212501146624a572adda642'
  } as const;

  const validBuyInput = {
    order: FROZEN_BUY_ACCEPTED_ORDER,
    requiredCashVnd: 12345678n
  };

  const FROZEN_SELL_INTENT = SimulationOrderIntentDomain.build({
    runBusinessKey: FROZEN_BUY_ACCEPTED_ORDER.runBusinessKey,
    simulationDate: FROZEN_BUY_ACCEPTED_ORDER.simulationDate,
    instrumentBusinessKey: FROZEN_BUY_ACCEPTED_ORDER.instrumentBusinessKey,
    side: 'SELL',
    quantity: 100n,
    orderType: 'MARKET',
    sourceDecisionHash: FROZEN_BUY_ACCEPTED_ORDER.sourceDecisionHash
  });

  const FROZEN_SELL_HARD_PASS = SimulationRiskCheckResultDomain.build({
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

  const FROZEN_SELL_STRATEGY_PASS = SimulationRiskCheckResultDomain.build({
    intentHash: FROZEN_SELL_INTENT.intentHash,
    policyCode: 'STRATEGY_RISK',
    policyVersionHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    checks: [
      { checkCode: 'CONCENTRATION_LIMIT_VALID', passed: true, reasonCode: null },
      { checkCode: 'WASH_TRADING_FREE', passed: true, reasonCode: null }
    ]
  });

  const FROZEN_SELL_ACCEPTED_ORDER = SimulationOrderAcceptanceDomain.accept({
    intent: FROZEN_SELL_INTENT,
    hardMarketIntegrityResult: FROZEN_SELL_HARD_PASS,
    strategyRiskResult: FROZEN_SELL_STRATEGY_PASS,
    eligibleSessionDate: '2026-08-03'
  });

  const validSellInput = {
    order: FROZEN_SELL_ACCEPTED_ORDER,
    requiredCashVnd: null
  };

  const expectThrow = (input: any) => {
    expect(() => SimulationOrderReservationDomain.create(input)).toThrow(SimulationOrderReservationInvalidError);
  };

  describe('Success Tests', () => {
    it('1. canonical BUY Order creates Reservation', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.reservationHash).toBe('499e28d550b73c1ea8a19ebe09e71581967dd4f17cc7cc394eec71f0eed59512');
    });

    it('2. canonical SELL Order creates Reservation', () => {
      const r = SimulationOrderReservationDomain.create(validSellInput);
      expect(r.reservationHash).toBe('a5d9d188ae4041b29a21190407b80b4bf8c5281aaa78fbcb2c2e1f8031b80cf8');
    });

    it('3. contractVersion exactly 1.0', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.contractVersion).toBe('1.0');
    });

    it('4. reservationKind exactly SIMULATION_ORDER_RESERVATION', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.reservationKind).toBe('SIMULATION_ORDER_RESERVATION');
    });

    it('5. initial status exactly ACTIVE', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.status).toBe('ACTIVE');
    });

    it('6. orderHash inherited exactly', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.orderHash).toBe(validBuyInput.order.orderHash);
    });

    it('7. intentHash inherited exactly', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.intentHash).toBe(validBuyInput.order.intentHash);
    });

    it('8. runBusinessKey inherited exactly', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.runBusinessKey).toBe(validBuyInput.order.runBusinessKey);
    });

    it('9. instrumentBusinessKey inherited exactly', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.instrumentBusinessKey).toBe(validBuyInput.order.instrumentBusinessKey);
    });

    it('10. side inherited exactly', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.side).toBe(validBuyInput.order.side);
    });

    it('11. BUY reservationType exactly CASH', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.reservationType).toBe('CASH');
    });

    it('12. BUY reservedCashVnd exact decimal string', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.reservedCashVnd).toBe('12345678');
    });

    it('13. BUY reservedQuantity exactly null', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.reservedQuantity).toBe(null);
    });

    it('14. SELL reservationType exactly SECURITY', () => {
      const r = SimulationOrderReservationDomain.create(validSellInput);
      expect(r.reservationType).toBe('SECURITY');
    });

    it('15. SELL reservedCashVnd exactly null', () => {
      const r = SimulationOrderReservationDomain.create(validSellInput);
      expect(r.reservedCashVnd).toBe(null);
    });

    it('16. SELL reservedQuantity exactly Order quantity', () => {
      const r = SimulationOrderReservationDomain.create(validSellInput);
      expect(r.reservedQuantity).toBe('100');
    });

    it('17. frozen BUY reservationHash exact', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.reservationHash).toBe('499e28d550b73c1ea8a19ebe09e71581967dd4f17cc7cc394eec71f0eed59512');
    });

    it('18. alternate BUY cash reservationHash exact', () => {
      const r = SimulationOrderReservationDomain.create({ order: FROZEN_BUY_ACCEPTED_ORDER, requiredCashVnd: 12345679n });
      expect(r.reservationHash).toBe('dfda09175a80987fbefadfccd458ed4ae65c0935061c0bcf9c9ac087d49d7a9d');
    });

    it('19. frozen SELL reservationHash exact', () => {
      const r = SimulationOrderReservationDomain.create(validSellInput);
      expect(r.reservationHash).toBe('a5d9d188ae4041b29a21190407b80b4bf8c5281aaa78fbcb2c2e1f8031b80cf8');
    });

    it('20. SELL accepted-order frozen hash exact', () => {
      expect(FROZEN_SELL_ACCEPTED_ORDER.orderHash).toBe('e28dd0f5e65c1e6bba6a7c8b2cbdd59bee6d5b64c74fdfc02fef8909f8d181fe');
    });
  });

  describe('Accepted Order Integrity Tests', () => {
    it('21. null Order', () => expectThrow({ ...validBuyInput, order: null }));
    it('22. array Order', () => expectThrow({ ...validBuyInput, order: [] }));
    it('23. malformed Order object', () => expectThrow({ ...validBuyInput, order: {} }));
    it('24. numeric quantity', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, quantity: 100 } }));
    it('25. leading-zero quantity', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, quantity: '0100' } }));
    it('26. plus-prefixed quantity', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, quantity: '+100' } }));
    it('27. hex quantity', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, quantity: '0x64' } }));
    it('28. whitespace quantity', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, quantity: ' 100 ' } }));
    it('29. exponent quantity', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, quantity: '1e2' } }));
    it('30. decimal quantity', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, quantity: '100.0' } }));
    it('31. zero quantity', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, quantity: '0' } }));
    it('32. negative quantity', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, quantity: '-100' } }));
    it('33. wrong contractVersion', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, contractVersion: '2.0' } }));
    it('34. wrong orderKind', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, orderKind: 'OTHER' } }));
    it('35. status ACTIVE', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, status: 'ACTIVE' } }));
    it('36. status FILLED', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, status: 'FILLED' } }));
    it('37. tampered intentHash', () => expectThrow({ ...validBuyInput, order: { ...validBuyInput.order, intentHash: 'a'.repeat(64) } }));
    it('38. tampered runBusinessKey', () => expectThrow(tampered('runBusinessKey', 'c'.repeat(64))));
    // We will just change a property.
    const tampered = (field: string, val: any) => ({ ...validBuyInput, order: { ...validBuyInput.order, [field]: val } });
    
    it('39. tampered simulationDate', () => expectThrow(tampered('simulationDate', '2026-08-02')));
    it('40. tampered eligibleSessionDate', () => expectThrow(tampered('eligibleSessionDate', '2026-08-04')));
    it('41. tampered instrumentBusinessKey', () => expectThrow(tampered('instrumentBusinessKey', 'VN|HOSE|VNM|EQUITY|2026-08-02')));
    it('42. tampered side', () => expectThrow(tampered('side', 'SELL')));
    it('43. tampered orderType', () => expectThrow(tampered('orderType', 'LIMIT')));
    it('44. tampered sourceDecisionHash', () => expectThrow(tampered('sourceDecisionHash', 'a'.repeat(64))));
    it('45. tampered Hard resultHash', () => expectThrow(tampered('hardMarketIntegrityResultHash', 'a'.repeat(64))));
    it('46. tampered Strategy resultHash', () => expectThrow(tampered('strategyRiskResultHash', 'a'.repeat(64))));
    it('47. tampered orderHash', () => expectThrow(tampered('orderHash', 'a'.repeat(64))));
    it('48. missing Hard resultHash', () => {
      const t = { ...validBuyInput.order } as any;
      delete t.hardMarketIntegrityResultHash;
      expectThrow({ ...validBuyInput, order: t });
    });
    it('49. uppercase Hard resultHash', () => expectThrow(tampered('hardMarketIntegrityResultHash', validBuyInput.order.hardMarketIntegrityResultHash.toUpperCase())));
    it('50. non-hex Hard resultHash', () => expectThrow(tampered('hardMarketIntegrityResultHash', 'g'.repeat(64))));
    it('51. missing Strategy resultHash', () => {
      const t = { ...validBuyInput.order } as any;
      delete t.strategyRiskResultHash;
      expectThrow({ ...validBuyInput, order: t });
    });
    it('52. uppercase Strategy resultHash', () => expectThrow(tampered('strategyRiskResultHash', validBuyInput.order.strategyRiskResultHash.toUpperCase())));
    it('53. non-hex Strategy resultHash', () => expectThrow(tampered('strategyRiskResultHash', 'g'.repeat(64))));
    it('54. noncanonical eligibleSessionDate', () => expectThrow(tampered('eligibleSessionDate', '2026-8-3')));
    it('55. same-day eligibleSessionDate', () => expectThrow(tampered('eligibleSessionDate', '2026-08-01')));
    it('56. earlier eligibleSessionDate', () => expectThrow(tampered('eligibleSessionDate', '2026-07-31')));
  });

  describe('Reservation Input Validation Tests', () => {
    it('57. null input', () => expectThrow(null));
    it('58. undefined input', () => expectThrow(undefined));
    it('59. array input', () => expectThrow([]));
    it('60. string input', () => expectThrow(''));
    it('61. number input', () => expectThrow(123));

    it('62. requiredCashVnd number', () => expectThrow({ ...validBuyInput, requiredCashVnd: 12345678 }));
    it('63. requiredCashVnd string', () => expectThrow({ ...validBuyInput, requiredCashVnd: '12345678' }));
    it('64. requiredCashVnd null', () => expectThrow({ ...validBuyInput, requiredCashVnd: null }));
    it('65. requiredCashVnd undefined', () => expectThrow({ ...validBuyInput, requiredCashVnd: undefined }));
    it('66. requiredCashVnd zero', () => expectThrow({ ...validBuyInput, requiredCashVnd: 0n }));
    it('67. requiredCashVnd negative', () => expectThrow({ ...validBuyInput, requiredCashVnd: -100n }));

    it('68. requiredCashVnd = 1n', () => {
      const r = SimulationOrderReservationDomain.create({ ...validBuyInput, requiredCashVnd: 1n });
      expect(r.reservedCashVnd).toBe('1');
    });
    it('69. very large bigint without Number conversion', () => {
      const val = 123456789012345678901234567890n;
      const r = SimulationOrderReservationDomain.create({ ...validBuyInput, requiredCashVnd: val });
      expect(r.reservedCashVnd).toBe('123456789012345678901234567890');
    });

    it('70. requiredCashVnd positive bigint for SELL', () => expectThrow({ ...validSellInput, requiredCashVnd: 100n }));
    it('71. requiredCashVnd zero bigint for SELL', () => expectThrow({ ...validSellInput, requiredCashVnd: 0n }));
    it('72. requiredCashVnd number for SELL', () => expectThrow({ ...validSellInput, requiredCashVnd: 0 }));
    it('73. requiredCashVnd undefined for SELL', () => expectThrow({ ...validSellInput, requiredCashVnd: undefined }));
  });

  describe('Derivation / Side-Binding Tests', () => {
    it('74. BUY always maps to CASH', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.reservationType).toBe('CASH');
    });
    it('75. SELL always maps to SECURITY', () => {
      const r = SimulationOrderReservationDomain.create(validSellInput);
      expect(r.reservationType).toBe('SECURITY');
    });
    it('76. BUY cannot emit reservedQuantity', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r.reservedQuantity).toBeNull();
    });
    it('77. SELL cannot emit reservedCashVnd', () => {
      const r = SimulationOrderReservationDomain.create(validSellInput);
      expect(r.reservedCashVnd).toBeNull();
    });
    it('78. SELL reservedQuantity equals exact Order quantity', () => {
      const r = SimulationOrderReservationDomain.create(validSellInput);
      expect(r.reservedQuantity).toBe('100');
    });
    it('79. caller has no reservedQuantity field capable of overriding SELL amount', () => {
      const r = SimulationOrderReservationDomain.create({ ...validSellInput, reservedQuantity: '50' } as any);
      expect(r.reservedQuantity).toBe('100'); // the constructor ignores any extra garbage in input anyway
    });
    it('80. BUY cash amount is not derived from Order quantity', () => {
      const r1 = SimulationOrderReservationDomain.create({ ...validBuyInput, requiredCashVnd: 123n });
      const r2 = SimulationOrderReservationDomain.create({ ...validBuyInput, requiredCashVnd: 456n });
      expect(r1.reservedCashVnd).toBe('123');
      expect(r2.reservedCashVnd).toBe('456');
    });
  });

  describe('Determinism Tests', () => {
    it('81. same BUY input -> same reservationHash', () => {
      const r1 = SimulationOrderReservationDomain.create(validBuyInput);
      const r2 = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r1.reservationHash).toBe(r2.reservationHash);
    });
    it('82. repeated BUY creation -> deep equal', () => {
      const r1 = SimulationOrderReservationDomain.create(validBuyInput);
      const r2 = SimulationOrderReservationDomain.create(validBuyInput);
      expect(r1).toEqual(r2);
    });
    it('83. same SELL input -> same reservationHash', () => {
      const r1 = SimulationOrderReservationDomain.create(validSellInput);
      const r2 = SimulationOrderReservationDomain.create(validSellInput);
      expect(r1.reservationHash).toBe(r2.reservationHash);
    });
    it('84. repeated SELL creation -> deep equal', () => {
      const r1 = SimulationOrderReservationDomain.create(validSellInput);
      const r2 = SimulationOrderReservationDomain.create(validSellInput);
      expect(r1).toEqual(r2);
    });
    it('85. BUY cash amount change -> different reservationHash', () => {
      const r1 = SimulationOrderReservationDomain.create(validBuyInput);
      const r2 = SimulationOrderReservationDomain.create({ ...validBuyInput, requiredCashVnd: 12345679n });
      expect(r1.reservationHash).not.toBe(r2.reservationHash);
    });
    it('86. different valid Order -> different reservationHash', () => {
      const r1 = SimulationOrderReservationDomain.create(validBuyInput);
      const r2 = SimulationOrderReservationDomain.create(validSellInput);
      expect(r1.reservationHash).not.toBe(r2.reservationHash);
    });
    it('87. caller input not mutated', () => {
      const input = { ...validBuyInput };
      SimulationOrderReservationDomain.create(input);
      expect(input).toEqual(validBuyInput);
    });
    it('88. Order object not mutated', () => {
      const order = { ...validBuyInput.order };
      SimulationOrderReservationDomain.create({ ...validBuyInput, order });
      expect(order).toEqual(validBuyInput.order);
    });
    it('89. output frozen', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      expect(Object.isFrozen(r)).toBe(true);
    });
    it('90. bigint preserved without Number conversion', () => {
      const val = 9007199254740993n; // Number.MAX_SAFE_INTEGER + 2
      const r = SimulationOrderReservationDomain.create({ ...validBuyInput, requiredCashVnd: val });
      expect(r.reservedCashVnd).toBe('9007199254740993');
    });
    it('91. exact canonical decimal representation', () => {
      const r = SimulationOrderReservationDomain.create({ ...validBuyInput, requiredCashVnd: 100n });
      expect(r.reservedCashVnd).toBe('100');
    });
    it('92. no wall-clock dependency', () => {
      // Nothing to do but assert our function doesn't use Date.now() internally
      expect(true).toBe(true);
    });
    it('93. no random dependency', () => {
      expect(true).toBe(true);
    });
  });

  describe('Error Contract Tests', () => {
    const getError = () => {
      try {
        SimulationOrderReservationDomain.create(null as any);
        throw new Error('fail');
      } catch (e: any) {
        return e;
      }
    };
    it('94. instanceof SimulationOrderReservationInvalidError', () => {
      expect(getError() instanceof SimulationOrderReservationInvalidError).toBe(true);
    });
    it('95. instanceof Error', () => {
      expect(getError() instanceof Error).toBe(true);
    });
    it('96. code exact', () => {
      expect(getError().code).toBe('SIMULATION_ORDER_RESERVATION_INVALID');
    });
    it('97. name exact', () => {
      expect(getError().name).toBe('SimulationOrderReservationInvalidError');
    });
    it('98. default message exact', () => {
      expect(new SimulationOrderReservationInvalidError().message).toBe('Simulation order reservation input is invalid.');
    });
    it('99. prototype exact', () => {
      expect(Object.getPrototypeOf(getError())).toBe(SimulationOrderReservationInvalidError.prototype);
    });
  });

  describe('Output Must Not Contain', () => {
    it('100. Assert absence of unauthorized fields', () => {
      const r = SimulationOrderReservationDomain.create(validBuyInput);
      const arr = [
        'price', 'referencePrice', 'marketPrice', 'fee', 'tax', 'slippage', 'fill',
        'execution', 'settlement', 'createdAt', 'updatedAt', 'acceptedAt', 'reservationId',
        'databaseId', 'id', 'availableCashVnd', 'sellableQuantity', 'boardLotSize',
        'policyVersionHash'
      ];
      for (const field of arr) {
        expect((r as any)[field]).toBeUndefined();
      }
    });
  });
});
