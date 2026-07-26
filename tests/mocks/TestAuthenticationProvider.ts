import { AuthenticationProvider } from '../../src/security/AuthenticationProviders';
import { ActorContext } from '../../src/domain/types/ActorContext';

export class TestAuthenticationProvider implements AuthenticationProvider {
  authenticate(authHeader: string | null): ActorContext {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('UNAUTHENTICATED');
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (token === 'test-admin-token') return { id: 'admin-1', type: 'ADMIN', roles: ['ADMIN'] };
    if (token === 'test-viewer-token') return { id: 'viewer-1', type: 'VIEWER', roles: ['VIEWER'] };
    throw new Error('UNAUTHENTICATED');
  }
}
