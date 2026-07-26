import { ErrorMapper } from '../../../../security/ErrorMapper';
import { RequestContext } from '../../../../security/RequestID';
import { NextRequest, NextResponse } from 'next/server';
import { SecurityContainer } from '../../../../security/SecurityContainer';
import { ListSimulationRunsService } from '../../../../application/services/ListSimulationRunsService';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const reqCtx = new RequestContext(req.headers.get('x-request-id') || undefined);
  try {
    const actor = await SecurityContainer.getAuthenticationProvider().authenticate(req.headers.get('authorization'));
    // Parse pagination options if needed, but for now just simple list
    const searchParams = req.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);

    const result = await ListSimulationRunsService.execute({ page, pageSize }, actor);
    return NextResponse.json({
      data: result.runs,
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total
      }
    });
  } catch (error: any) {
    const { status, payload } = ErrorMapper.map(error, reqCtx.id);
    return NextResponse.json(payload, { status });
  }
}

export async function POST(req: NextRequest) {
  const reqCtx = new RequestContext(req.headers.get('x-request-id') || undefined);
  try {
    const actor = await SecurityContainer.getAuthenticationProvider().authenticate(req.headers.get('authorization'));
    const body = await req.json();
    const { configData, mode, creationIdempotencyKey } = body;
    
    const CreateSimulationRunService = (await import('../../../../application/services/CreateSimulationRunService')).CreateSimulationRunService;
    const run = await CreateSimulationRunService.execute(
      { configData, mode, creationIdempotencyKey },
      actor
    );
    return NextResponse.json({ data: run }, { status: 201 });
  } catch (error: any) {
    const { status, payload } = ErrorMapper.map(error, reqCtx.id);
    return NextResponse.json(payload, { status });
  }
}
