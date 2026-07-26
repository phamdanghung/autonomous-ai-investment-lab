import { NextRequest, NextResponse } from 'next/server';
import { SecurityContainer } from '../../../../../../security/auth';
import { InMemoryProductionRateLimiter } from '../../../../../../security/rate-limiter';
import { ErrorMapper } from '../../../../../../security/ErrorMapper';
import { TransitionRequestSchema } from '../../../../../../security/ZodSchemas';
import { PauseSimulationRunService } from '../../../../../../application/services/PauseSimulationRunService';
import { applySecurityHeaders } from '../../../../../../security/middlewares/securityHeaders';
import { RequestContext } from '../../../../../../security/RequestID';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const reqCtx = new RequestContext(req.headers.get('x-request-id') || undefined);
  const reqContext = new RequestContext(req.headers.get('X-Request-ID') || undefined);
  if (req.method === 'OPTIONS') return applySecurityHeaders(new NextResponse(null, { status: 204 }));

  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 1024 * 1024) {
    return applySecurityHeaders(NextResponse.json({ error: 'Payload too large', reqId: reqContext.id }, { status: 413 }));
  }

  try {
    const { id } = await params;
    const authHeader = req.headers.get('authorization') || '';
    const authProvider = SecurityContainer.getAuthenticationProvider();
    const actor = authProvider.authenticate(authHeader);
    SecurityContainer.authorize(actor, ['ADMIN']); 
    
    InMemoryProductionRateLimiter.consume(actor.id, `POST_ADMIN_RUNS_PAUSE`);

    const text = await req.text();
    if (text.length > 1024 * 1024) {
      return applySecurityHeaders(NextResponse.json({ error: 'Payload too large', reqId: reqContext.id }, { status: 413 }));
    }
    
    const body = text ? JSON.parse(text) : {};
    const parsed = TransitionRequestSchema.parse(body);

    const run = await PauseSimulationRunService.execute(id, parsed.version, parsed, actor);
    
    const res = NextResponse.json(run, { status: 200 });
    return applySecurityHeaders(res);
  } catch (error) {
    const { status, payload } = ErrorMapper.map(error);
    const res = NextResponse.json({ ...payload, reqId: reqContext.id }, { status });
    return applySecurityHeaders(res);
  }
}
