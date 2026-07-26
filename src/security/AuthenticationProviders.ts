import { ActorContext } from '../domain/types/ActorContext';

export interface AuthenticationProvider {
  authenticate(authHeader: string | null): ActorContext;
}

export class FailClosedProductionAuthenticationProvider implements AuthenticationProvider {
  authenticate(authHeader: string | null): ActorContext {
    // Phase 1A: No production credential issuer exists yet. 
    // Always fail closed to prevent unauthorized access.
    throw new Error('UNAUTHENTICATED');
  }
}
