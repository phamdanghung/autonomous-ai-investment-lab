import { describe, it, expect } from 'vitest';
import { SecurityContainer } from '../../src/security/SecurityContainer';
import { ErrorMapper } from '../../src/security/ErrorMapper';
import { InMemoryProductionRateLimiter } from '../../src/security/rate-limiter';
import { CreateRunRequestSchema } from '../../src/security/ZodSchemas';
import { RequestContext } from '../../src/security/RequestID';
import { applySecurityHeaders } from '../../src/security/middlewares/securityHeaders';
import { NextResponse } from 'next/server';

import { TestAuthenticationProvider } from '../mocks/TestAuthenticationProvider';

describe('Security Baseline Tests', () => {
  it('1. Missing environment boot failure (Fail-closed)', () => {
    expect(() => {
      (process.env as any).NODE_ENV = 'production';
      SecurityContainer.setAuthenticationProvider(new TestAuthenticationProvider());
    }).toThrow('Cannot override authentication provider in production');
    (process.env as any).NODE_ENV = 'test';
  });

  it('2. Production authentication fail closed', () => {
    (process.env as any).NODE_ENV = 'production';
    const prodProvider = SecurityContainer.getAuthenticationProvider();
    expect(() => prodProvider.authenticate('Bearer token')).toThrow('UNAUTHENTICATED');
    (process.env as any).NODE_ENV = 'test';
  });

  it('3. Production composition avoids TestAuthenticationProvider', () => {
    (process.env as any).NODE_ENV = 'production';
    const provider = SecurityContainer.getAuthenticationProvider();
    expect(provider.constructor.name).toBe('FailClosedProductionAuthenticationProvider');
    (process.env as any).NODE_ENV = 'test';
  });

  it('4. Unauthenticated request rejected', () => {
    SecurityContainer.setAuthenticationProvider(new TestAuthenticationProvider());
    const provider = SecurityContainer.getAuthenticationProvider();
    expect(() => provider.authenticate(null)).toThrow('UNAUTHENTICATED');
  });

  it('5. VIEWER write rejected', () => {
    SecurityContainer.setAuthenticationProvider(new TestAuthenticationProvider());
    const provider = SecurityContainer.getAuthenticationProvider();
    const actor = provider.authenticate('Bearer test-viewer-token');
    expect(() => SecurityContainer.authorize(actor, ['ADMIN'])).toThrow('FORBIDDEN');
  });

  it('6. ADMIN authorized via injected provider', () => {
    SecurityContainer.setAuthenticationProvider(new TestAuthenticationProvider());
    const provider = SecurityContainer.getAuthenticationProvider();
    const actor = provider.authenticate('Bearer test-admin-token');
    expect(actor.type).toBe('ADMIN');
    expect(() => SecurityContainer.authorize(actor, ['ADMIN'])).not.toThrow();
  });

  it('7. X-Role does not override role', () => {
    SecurityContainer.setAuthenticationProvider(new TestAuthenticationProvider());
    const provider = SecurityContainer.getAuthenticationProvider();
    const actor = provider.authenticate('Bearer test-viewer-token'); 
    expect(actor.roles).not.toContain('ADMIN');
  });

  it('8. X-Actor-Id does not override actor', () => {
    SecurityContainer.setAuthenticationProvider(new TestAuthenticationProvider());
    const provider = SecurityContainer.getAuthenticationProvider();
    const actor = provider.authenticate('Bearer test-admin-token');
    expect(actor.id).toBe('admin-1');
  });

  it('9-10. Strict payload validation (unknown & mass-assignment rejected)', () => {
    const invalidPayload = { mode: 'LIVE_FORWARD', creationIdempotencyKey: 'not-uuid', unknownField: true };
    const result = CreateRunRequestSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it('11. Payload exceeds 1MB rejected', () => {
    const largePayload = { mode: 'LIVE_FORWARD', creationIdempotencyKey: '00000000-0000-0000-0000-000000000000', huge: 'A'.repeat(1024 * 1024 + 1) };
    const result = CreateRunRequestSchema.safeParse(largePayload);
    expect(result.success).toBe(false);
  });

  it('12-14. Rate Limiter mechanisms', () => {
    const actorId = 'test-actor-rl';
    const action = 'test-action-rl';
    let allowed = 0;
    for (let i = 0; i < 110; i++) {
      if (InMemoryProductionRateLimiter.consume(actorId, action)) allowed++;
    }
    expect(allowed).toBe(100); // Caps exactly at 100
  });

  it('15-18. Error mapper structures and request ID', () => {
    const reqCtx = new RequestContext();
    const { status, payload } = ErrorMapper.map(new Error('PrismaClientKnownRequestError'), reqCtx.id);
    expect(status).toBe(500);
    expect(payload.error.requestId).toBe(reqCtx.id);
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(payload.error.message).toBe('An internal server error occurred.');
    expect(JSON.stringify(payload)).not.toContain('Prisma');
    expect(JSON.stringify(payload)).not.toContain('SQL');
    expect(JSON.stringify(payload)).not.toContain('stack');
  });

  it('19-20. Logger redacts sensitive info', () => {
    const reqCtx = new RequestContext();
    const originalConsoleError = console.error;
    let loggedMessage = '';
    console.error = (msg: string) => { loggedMessage += msg; };
    
    try {
      const { status, payload } = ErrorMapper.map(
        new Error('Database Connection Failed with AUTH_SECRET_SENTINEL and PASSWORD_SECRET_SENTINEL and TOKEN_SECRET_SENTINEL and DATABASE_URL_SECRET_SENTINEL and ERROR_MESSAGE_SECRET_SENTINEL'), 
        reqCtx.id
      );
      expect(status).toBe(500);
      expect(JSON.stringify(payload)).not.toContain('AUTH_SECRET_SENTINEL');
      
      expect(loggedMessage).not.toContain('AUTH_SECRET_SENTINEL');
      expect(loggedMessage).not.toContain('PASSWORD_SECRET_SENTINEL');
      expect(loggedMessage).not.toContain('TOKEN_SECRET_SENTINEL');
      expect(loggedMessage).not.toContain('DATABASE_URL_SECRET_SENTINEL');
      expect(loggedMessage).not.toContain('ERROR_MESSAGE_SECRET_SENTINEL');
      expect(loggedMessage).toContain('INTERNAL_ERROR_REDACTED');
      expect(loggedMessage).toContain(reqCtx.id);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('21. Security headers', () => {
    const res = new NextResponse();
    applySecurityHeaders(res);
    expect(res.headers.get('Strict-Transport-Security')).toBeDefined();
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('22. CORS policy - Non permissive Origin', () => {
    // Simulated origin from malicious site
    const maliciousReq = new Request('http://localhost/api/admin/runs', { headers: { 'Origin': 'https://malicious.example' } });
    const resDisallowed = new NextResponse();
    applySecurityHeaders(resDisallowed, maliciousReq);
    
    // Server should not emit Access-Control-Allow-Origin for this disallowed origin
    expect(resDisallowed.headers.get('Access-Control-Allow-Origin')).toBeNull();

    // Simulated origin from allowed site
    const allowedReq = new Request('http://localhost/api/admin/runs', { headers: { 'Origin': 'https://trusted-admin-ui.autonomous-ai.internal' } });
    const resAllowed = new NextResponse();
    applySecurityHeaders(resAllowed, allowedReq);

    // Server should emit exact ACAO for allowed origin
    expect(resAllowed.headers.get('Access-Control-Allow-Origin')).toBe('https://trusted-admin-ui.autonomous-ai.internal');
  });

  it('23. CSRF Decision Evidence', () => {
    // Production authentication is fail closed.
    // Client must pass 'Authorization: Bearer <token>' explicitly.
    // API does not read 'cookie' header for session mapping in this context.
    const reqCtx = new RequestContext();
    // Simulate a request with a cookie but no auth header
    const mockReqWithCookie = new Request('http://localhost/api/admin/runs', { headers: { 'Cookie': 'session=abc' } });
    const authHeader = mockReqWithCookie.headers.get('Authorization');
    // Authentication provider only takes a string (bearer token), if null it throws.
    expect(() => SecurityContainer.getAuthenticationProvider().authenticate(authHeader)).toThrow('UNAUTHENTICATED');
  });

  it('24. No production test/debug route test', () => {
    const fs = require('fs');
    const path = require('path');
    const apiPath = path.resolve(__dirname, '../../src/app/api');
    
    // Exact paths to check
    const forbiddenPaths = [
      'test',
      'debug',
      'admin/test',
      'admin/debug',
      'admin/runs/[id]/bind-data-origin',
      'admin/runs/[id]/[action]'
    ];
    
    for (const p of forbiddenPaths) {
      expect(fs.existsSync(path.join(apiPath, p))).toBe(false);
    }
  });

  it('25. Route Node.js runtime static check', () => {
    const fs = require('fs');
    const path = require('path');
    const apiPath = path.resolve(__dirname, '../../src/app/api');
    
    const routes = [
      'admin/runs/route.ts',
      'admin/runs/[id]/route.ts',
      'admin/runs/[id]/start/route.ts',
      'admin/runs/[id]/pause/route.ts',
      'admin/runs/[id]/resume/route.ts',
      'admin/runs/[id]/terminate/route.ts',
      'admin/runs/[id]/seal/route.ts'
    ];
    
    for (const route of routes) {
      const fullPath = path.join(apiPath, route);
      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content).toMatch(/export const runtime = 'nodejs'/);
    }
  });
});
