import { ErrorMapper } from '../../../../../security/ErrorMapper';
import { RequestContext } from '../../../../../security/RequestID';
import { NextRequest, NextResponse } from 'next/server';
import { SecurityContainer } from '../../../../../security/SecurityContainer';
import { GetSimulationRunService } from '../../../../../application/services/GetSimulationRunService';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const reqCtx = new RequestContext(req.headers.get('x-request-id') || undefined);
  try {
    const actor = await SecurityContainer.getAuthenticationProvider().authenticate(req.headers.get('authorization'));
    const resolvedParams = await params;
    const run = await GetSimulationRunService.execute(resolvedParams.id, actor);
    return NextResponse.json({ data: run });
  } catch (error: any) {
    const { status, payload } = ErrorMapper.map(error, reqCtx.id);
    return NextResponse.json(payload, { status });
  }
}
