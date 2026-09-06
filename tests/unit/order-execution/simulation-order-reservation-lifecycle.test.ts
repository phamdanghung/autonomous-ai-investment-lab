import { describe, it, expect, vi } from 'vitest';
import {
  SimulationOrderReservationLifecycleDomain,
  SimulationOrderReservationTransitionInvalidError
} from '../../../src/domain/order-execution/SimulationOrderReservationLifecycle';
import { SimulationOrderReservationStatus } from '../../../src/domain/contracts/SimulationOrderReservationContracts';

describe('SimulationOrderReservationLifecycleDomain', () => {
  const ALL_STATUSES: SimulationOrderReservationStatus[] = [
    'ACTIVE',
    'PARTIALLY_CONSUMED',
    'CONSUMED',
    'RELEASED',
    'FAILED'
  ];

  const ALLOWED = new Set([
    'ACTIVE->PARTIALLY_CONSUMED',
    'ACTIVE->CONSUMED',
    'ACTIVE->RELEASED',
    'ACTIVE->FAILED',
    'PARTIALLY_CONSUMED->CONSUMED',
    'PARTIALLY_CONSUMED->RELEASED',
    'PARTIALLY_CONSUMED->FAILED'
  ]);

  const expectThrow = (input: any) => {
    expect(() => SimulationOrderReservationLifecycleDomain.transition(input)).toThrow(SimulationOrderReservationTransitionInvalidError);
  };

  describe('1. Exhaustive 5x5 Matrix', () => {
    let i = 1;
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const edge = `${from}->${to}`;
        if (ALLOWED.has(edge)) {
          it(`${i++}. ALLOWED ${edge}`, () => {
            const out = SimulationOrderReservationLifecycleDomain.transition({ from, to });
            expect(out.from).toBe(from);
            expect(out.to).toBe(to);
            expect(out.contractVersion).toBe('1.0');
            expect(out.transitionKind).toBe('SIMULATION_ORDER_RESERVATION_STATE_TRANSITION');
            expect(Object.isFrozen(out)).toBe(true);
          });
        } else {
          it(`${i++}. FORBIDDEN ${edge}`, () => {
            expectThrow({ from, to });
          });
        }
      }
    }
  });

  describe('2. Explicit Allowed Edge Tests', () => {
    it('26. ACTIVE -> PARTIALLY_CONSUMED', () => {
      const out = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'PARTIALLY_CONSUMED' });
      expect(out.from).toBe('ACTIVE');
      expect(out.to).toBe('PARTIALLY_CONSUMED');
    });
    it('27. ACTIVE -> CONSUMED', () => {
      const out = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'CONSUMED' });
      expect(out.from).toBe('ACTIVE');
    });
    it('28. ACTIVE -> RELEASED', () => {
      const out = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'RELEASED' });
      expect(out.from).toBe('ACTIVE');
    });
    it('29. ACTIVE -> FAILED', () => {
      const out = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'FAILED' });
      expect(out.from).toBe('ACTIVE');
    });
    it('30. PARTIALLY_CONSUMED -> CONSUMED', () => {
      const out = SimulationOrderReservationLifecycleDomain.transition({ from: 'PARTIALLY_CONSUMED', to: 'CONSUMED' });
      expect(out.from).toBe('PARTIALLY_CONSUMED');
    });
    it('31. PARTIALLY_CONSUMED -> RELEASED', () => {
      const out = SimulationOrderReservationLifecycleDomain.transition({ from: 'PARTIALLY_CONSUMED', to: 'RELEASED' });
      expect(out.from).toBe('PARTIALLY_CONSUMED');
    });
    it('32. PARTIALLY_CONSUMED -> FAILED', () => {
      const out = SimulationOrderReservationLifecycleDomain.transition({ from: 'PARTIALLY_CONSUMED', to: 'FAILED' });
      expect(out.from).toBe('PARTIALLY_CONSUMED');
    });
  });

  describe('3. Terminal State Explicit Rejection', () => {
    let t = 33;
    for (const terminal of ['CONSUMED', 'RELEASED', 'FAILED']) {
      for (const to of ALL_STATUSES) {
        it(`${t++}. ${terminal} has zero valid outgoing transitions (to ${to})`, () => {
          expectThrow({ from: terminal, to });
        });
      }
    }
  }); // ends at 33 + 15 = 48

  describe('4. Self-Transition Rejection', () => {
    it('48. ACTIVE -> ACTIVE', () => expectThrow({ from: 'ACTIVE', to: 'ACTIVE' }));
    it('49. PARTIALLY_CONSUMED -> PARTIALLY_CONSUMED', () => expectThrow({ from: 'PARTIALLY_CONSUMED', to: 'PARTIALLY_CONSUMED' }));
    it('50. CONSUMED -> CONSUMED', () => expectThrow({ from: 'CONSUMED', to: 'CONSUMED' }));
    it('51. RELEASED -> RELEASED', () => expectThrow({ from: 'RELEASED', to: 'RELEASED' }));
    it('52. FAILED -> FAILED', () => expectThrow({ from: 'FAILED', to: 'FAILED' }));
  });

  describe('5. Invalid Input Rejection', () => {
    it('53. null input', () => expectThrow(null));
    it('54. undefined input', () => expectThrow(undefined));
    it('55. array input', () => expectThrow([]));
    it('56. string input', () => expectThrow('foo'));
    it('57. number input', () => expectThrow(123));
    it('58. boolean input', () => expectThrow(true));
    it('59. missing from', () => expectThrow({ to: 'RELEASED' }));
    it('60. missing to', () => expectThrow({ from: 'ACTIVE' }));
    it('61. null from', () => expectThrow({ from: null, to: 'RELEASED' }));
    it('62. null to', () => expectThrow({ from: 'ACTIVE', to: null }));
    it('63. numeric from', () => expectThrow({ from: 1, to: 'RELEASED' }));
    it('64. numeric to', () => expectThrow({ from: 'ACTIVE', to: 1 }));
    it('65. lowercase from', () => expectThrow({ from: 'active', to: 'RELEASED' }));
    it('66. lowercase to', () => expectThrow({ from: 'ACTIVE', to: 'released' }));
    it('67. leading whitespace from', () => expectThrow({ from: ' ACTIVE', to: 'RELEASED' }));
    it('68. trailing whitespace from', () => expectThrow({ from: 'ACTIVE ', to: 'RELEASED' }));
    it('69. leading whitespace to', () => expectThrow({ from: 'ACTIVE', to: ' RELEASED' }));
    it('70. trailing whitespace to', () => expectThrow({ from: 'ACTIVE', to: 'RELEASED ' }));
    it('71. unknown from', () => expectThrow({ from: 'UNKNOWN', to: 'RELEASED' }));
    it('72. unknown to', () => expectThrow({ from: 'ACTIVE', to: 'UNKNOWN' }));
  });

  describe('6. Out-of-Scope Status Tests', () => {
    const OOS = [
      'CREATED', 'PENDING', 'CANCELLED', 'EXPIRED', 'ACCEPTED',
      'ACTIVE_ORDER', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED'
    ];
    let t = 73;
    for (const status of OOS) {
      it(`${t++}. Reject OOS from ${status}`, () => expectThrow({ from: status, to: 'RELEASED' }));
      it(`${t++}. Reject OOS to ${status}`, () => expectThrow({ from: 'ACTIVE', to: status }));
    }
  });

  describe('7. Output Contract', () => {
    it('91. exact key set and exact contract constants', () => {
      const out = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'PARTIALLY_CONSUMED' });
      expect(Object.keys(out)).toEqual(['contractVersion', 'transitionKind', 'from', 'to']);
      expect(out.contractVersion).toBe('1.0');
      expect(out.transitionKind).toBe('SIMULATION_ORDER_RESERVATION_STATE_TRANSITION');
    });
    it('92. output is frozen', () => {
      const out = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'RELEASED' });
      expect(Object.isFrozen(out)).toBe(true);
    });
    it('93. caller input not mutated', () => {
      const input = { from: 'ACTIVE', to: 'FAILED' } as any;
      SimulationOrderReservationLifecycleDomain.transition(input);
      expect(input).toEqual({ from: 'ACTIVE', to: 'FAILED' });
    });
  });

  describe('8. Error Contract', () => {
    const getError = () => {
      try {
        SimulationOrderReservationLifecycleDomain.transition(null as any);
        throw new Error('fail');
      } catch (e: any) {
        return e;
      }
    };
    it('94. instanceof SimulationOrderReservationTransitionInvalidError', () => {
      expect(getError() instanceof SimulationOrderReservationTransitionInvalidError).toBe(true);
    });
    it('95. instanceof Error', () => {
      expect(getError() instanceof Error).toBe(true);
    });
    it('96. code exact', () => {
      expect(getError().code).toBe('SIMULATION_ORDER_RESERVATION_TRANSITION_INVALID');
    });
    it('97. name exact', () => {
      expect(getError().name).toBe('SimulationOrderReservationTransitionInvalidError');
    });
    it('98. exact default message', () => {
      expect(new SimulationOrderReservationTransitionInvalidError().message).toBe('Simulation order reservation state transition is invalid.');
    });
    it('99. prototype exact', () => {
      expect(Object.getPrototypeOf(getError())).toBe(SimulationOrderReservationTransitionInvalidError.prototype);
    });
  });

  describe('9. Determinism Tests', () => {
    it('100. repeated transition deep equality', () => {
      const first = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'CONSUMED' });
      const second = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'CONSUMED' });
      expect(second).toEqual(first);
    });
    it('101. different to produces different transition', () => {
      const first = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'CONSUMED' });
      const second = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'RELEASED' });
      expect(first).not.toEqual(second);
    });
    it('102. wall-clock independence', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2001-01-01T00:00:00.000Z'));
        const first = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'FAILED' });

        vi.setSystemTime(new Date('2049-12-31T23:59:59.000Z'));
        const second = SimulationOrderReservationLifecycleDomain.transition({ from: 'ACTIVE', to: 'FAILED' });

        expect(second).toEqual(first);
      } finally {
        vi.useRealTimers();
      }
    });
    it('103. random independence', () => {
      const spy = vi.spyOn(Math, 'random');
      try {
        SimulationOrderReservationLifecycleDomain.transition({ from: 'PARTIALLY_CONSUMED', to: 'RELEASED' });
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
