import { NextResponse } from 'next/server';

export function applySecurityHeaders(response: NextResponse, request?: Request) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.headers.set('Content-Security-Policy', "default-src 'self'");
  
  // CORS: Allowlist or Same-Origin
  const allowedOrigin = 'https://trusted-admin-ui.autonomous-ai.internal';
  const origin = request ? request.headers.get('origin') : null;
  
  if (origin === allowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Idempotency-Key, X-Request-ID');
  }
  
  return response;
}
