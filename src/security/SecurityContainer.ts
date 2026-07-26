import { AuthenticationProvider, FailClosedProductionAuthenticationProvider } from './AuthenticationProviders';
import { ActorContext } from '../domain/types/ActorContext';

export class SecurityContainer {
  private static authProvider: AuthenticationProvider = new FailClosedProductionAuthenticationProvider();

  static setAuthenticationProvider(provider: AuthenticationProvider) {
    // Only allowed in non-production environments for testing
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot override authentication provider in production');
    }
    this.authProvider = provider;
  }

  static getAuthenticationProvider(): AuthenticationProvider {
    return this.authProvider;
  }

  static authorize(actor: ActorContext, allowedRoles: string[]) {
    if (!actor.roles.some(role => allowedRoles.includes(role))) {
      throw new Error('FORBIDDEN');
    }
  }
}
