import { ZodError } from 'zod';
import { DomainError, RunVersionConflictError, InvalidStateTransitionError, IdempotencyKeyReusedError, InvalidOperationError } from './../domain/errors/DomainErrors';

export class ErrorMapper {
  static map(error: any, requestId?: string): { status: number, payload: any } {
    const withRequestId = (payload: any) => requestId ? { ...payload, error: { ...payload.error, requestId } } : payload;
    
    if (error instanceof ZodError) {
      return {
        status: 400,
        payload: withRequestId({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request payload',
            details: error.issues.map((e: any) => ({ path: e.path.join('.'), message: e.message }))
          }
        })
      };
    }

    if (error instanceof IdempotencyKeyReusedError) {
      return {
        status: 409,
        payload: withRequestId({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: error.message } })
      };
    }

    if (error instanceof RunVersionConflictError) {
      return {
        status: 409, // CAS failure
        payload: withRequestId({ error: { code: 'RUN_VERSION_CONFLICT', message: error.message } })
      };
    }

    if (error instanceof InvalidStateTransitionError) {
      return {
        status: 400,
        payload: withRequestId({ error: { code: 'INVALID_STATE_TRANSITION', message: error.message } })
      };
    }
    
    if (error instanceof InvalidOperationError) {
      return {
        status: 400,
        payload: withRequestId({ error: { code: 'INVALID_OPERATION', message: error.message } })
      };
    }

    if (error instanceof DomainError) {
      return {
        status: 400,
        payload: withRequestId({ error: { code: error.code, message: error.message } })
      };
    }
    
    if (error && error.message === 'UNAUTHENTICATED') {
      return { status: 401, payload: withRequestId({ error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } }) };
    }
    if (error && error.message === 'FORBIDDEN') {
      return { status: 403, payload: withRequestId({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }) };
    }

    if (error && (error.code === 'P2002' || error.name === 'PrismaClientKnownRequestError')) {
      console.error(`[DATABASE_ERROR_REDACTED] reqId: ${requestId}`);
      return {
        status: 500,
        payload: withRequestId({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } })
      };
    }

    console.error(`[INTERNAL_ERROR_REDACTED] reqId: ${requestId || 'unknown'} ErrorType: ${error?.name || 'Unknown'}`);
    return {
      status: 500,
      payload: withRequestId({ error: { code: 'INTERNAL_ERROR', message: 'An internal server error occurred.' } })
    };
  }
}
