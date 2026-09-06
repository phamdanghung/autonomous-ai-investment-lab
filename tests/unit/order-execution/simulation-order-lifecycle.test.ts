import { describe, it, expect } from 'vitest';
import { SimulationOrderLifecycleDomain, SimulationOrderTransitionInvalidError } from '../../../src/domain/order-execution/SimulationOrderLifecycle';
import { SimulationOrderStatus } from '../../../src/domain/contracts/SimulationOrderLifecycleContracts';

describe('SimulationOrderLifecycleDomain', () => {
  const ALL_STATUSES: SimulationOrderStatus[] = [
    'ACCEPTED',
    'ACTIVE',
    'PARTIALLY_FILLED',
    'FILLED',
    'CANCEL_PENDING',
    'CANCELLED',
    'EXPIRED'
  ];

  const ALLOWED_EDGES = [
    { from: 'ACCEPTED', to: 'ACTIVE' },
    { from: 'ACTIVE', to: 'FILLED' },
    { from: 'ACTIVE', to: 'PARTIALLY_FILLED' },
    { from: 'ACTIVE', to: 'CANCEL_PENDING' },
    { from: 'ACTIVE', to: 'EXPIRED' },
    { from: 'PARTIALLY_FILLED', to: 'FILLED' },
    { from: 'PARTIALLY_FILLED', to: 'CANCEL_PENDING' },
    { from: 'PARTIALLY_FILLED', to: 'EXPIRED' },
    { from: 'CANCEL_PENDING', to: 'CANCELLED' }
  ];

  const isAllowed = (from: string, to: string) => {
    return ALLOWED_EDGES.some(edge => edge.from === from && edge.to === to);
  };

  describe('Exhaustive matrix', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (isAllowed(from, to)) {
          it(`allows transition ${from} -> ${to}`, () => {
            const input = { from, to };
            const result = SimulationOrderLifecycleDomain.transition(input);
            expect(result.from).toBe(from);
            expect(result.to).toBe(to);
            expect(result.contractVersion).toBe('1.0');
            expect(result.transitionKind).toBe('SIMULATION_ORDER_STATE_TRANSITION');
            expect(Object.isFrozen(result)).toBe(true);
          });
        } else {
          it(`forbids transition ${from} -> ${to}`, () => {
            const input = { from, to };
            expect(() => SimulationOrderLifecycleDomain.transition(input))
              .toThrow(SimulationOrderTransitionInvalidError);
          });
        }
      }
    }
  });

  describe('Additional required tests', () => {
    it('1. null input rejected', () => {
      expect(() => SimulationOrderLifecycleDomain.transition(null as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('2. undefined input rejected', () => {
      expect(() => SimulationOrderLifecycleDomain.transition(undefined as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('3. array input rejected', () => {
      expect(() => SimulationOrderLifecycleDomain.transition([] as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('4. string input rejected', () => {
      expect(() => SimulationOrderLifecycleDomain.transition('string' as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('5. number input rejected', () => {
      expect(() => SimulationOrderLifecycleDomain.transition(123 as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('6. missing from', () => {
      expect(() => SimulationOrderLifecycleDomain.transition({ to: 'ACTIVE' } as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('7. missing to', () => {
      expect(() => SimulationOrderLifecycleDomain.transition({ from: 'ACCEPTED' } as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('8. lowercase from', () => {
      expect(() => SimulationOrderLifecycleDomain.transition({ from: 'accepted', to: 'ACTIVE' } as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('9. lowercase to', () => {
      expect(() => SimulationOrderLifecycleDomain.transition({ from: 'ACCEPTED', to: 'active' } as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('10. whitespace around from', () => {
      expect(() => SimulationOrderLifecycleDomain.transition({ from: ' ACCEPTED', to: 'ACTIVE' } as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('11. whitespace around to', () => {
      expect(() => SimulationOrderLifecycleDomain.transition({ from: 'ACCEPTED', to: 'ACTIVE ' } as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('12. unknown from', () => {
      expect(() => SimulationOrderLifecycleDomain.transition({ from: 'UNKNOWN', to: 'ACTIVE' } as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('13. unknown to', () => {
      expect(() => SimulationOrderLifecycleDomain.transition({ from: 'ACCEPTED', to: 'UNKNOWN' } as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    const getValidResult = () => SimulationOrderLifecycleDomain.transition({ from: 'ACCEPTED' as const, to: 'ACTIVE' as const });

    it('14. result exact key set', () => {
      const keys = Object.keys(getValidResult()).sort();
      expect(keys).toEqual(['contractVersion', 'from', 'to', 'transitionKind']);
    });
      
    it('15. result contractVersion exact', () => {
      expect(getValidResult().contractVersion).toBe('1.0');
    });
      
    it('16. result transitionKind exact', () => {
      expect(getValidResult().transitionKind).toBe('SIMULATION_ORDER_STATE_TRANSITION');
    });
      
    it('17. result from exact', () => {
      expect(getValidResult().from).toBe('ACCEPTED');
    });
      
    it('18. result to exact', () => {
      expect(getValidResult().to).toBe('ACTIVE');
    });
      
    it('19. result frozen', () => {
      expect(Object.isFrozen(getValidResult())).toBe(true);
    });

    it('20. input not mutated', () => {
      const input = { from: 'ACCEPTED' as const, to: 'ACTIVE' as const };
      const inputCopy = { ...input };
      SimulationOrderLifecycleDomain.transition(input);
      expect(input).toEqual(inputCopy);
    });

    const getError = () => {
      try {
        SimulationOrderLifecycleDomain.transition({ from: 'ACCEPTED', to: 'FILLED' } as any);
        throw new Error('should not reach here');
      } catch (e: any) {
        return e;
      }
    };

    it('21. error class instanceof correct', () => {
      const error = getError();
      expect(error instanceof SimulationOrderTransitionInvalidError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
        
    it('22. error code exact', () => {
      expect(getError().code).toBe('SIMULATION_ORDER_TRANSITION_INVALID');
    });
        
    it('23. error name exact', () => {
      expect(getError().name).toBe('SimulationOrderTransitionInvalidError');
    });
        
    it('24. default error contract message', () => {
      expect(getError().message).toBe('Simulation order state transition is invalid.');
    });

    it('25. deterministic repeated transition result', () => {
      const input1 = { from: 'ACCEPTED' as const, to: 'ACTIVE' as const };
      const input2 = { from: 'ACCEPTED' as const, to: 'ACTIVE' as const };
      const res1 = SimulationOrderLifecycleDomain.transition(input1);
      const res2 = SimulationOrderLifecycleDomain.transition(input2);
      expect(res1).toEqual(res2);
    });

    it('rejects REJECTED which is intentionally out of scope', () => {
      expect(() => SimulationOrderLifecycleDomain.transition({ from: 'ACCEPTED', to: 'REJECTED' } as any)).toThrow(SimulationOrderTransitionInvalidError);
    });

    it('rejects FAILED which is intentionally out of scope', () => {
      expect(() => SimulationOrderLifecycleDomain.transition({ from: 'ACCEPTED', to: 'FAILED' } as any)).toThrow(SimulationOrderTransitionInvalidError);
    });
  });
});
