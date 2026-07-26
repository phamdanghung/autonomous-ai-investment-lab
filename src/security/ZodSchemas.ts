import { z } from 'zod';
import { RunMode } from '../domain/types/RunMode';
import { RunStatus } from '../domain/types/RunStatus';

export const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url(),
  SHADOW_DATABASE_URL: z.string().url(),
}).strip();

export const CreateRunRequestSchema = z.object({
  configData: z.record(z.string(), z.any()), // Can be more specific but it's arbitrary JSON config
  mode: z.nativeEnum(RunMode),
  creationIdempotencyKey: z.string().uuid(),
}).strict();

export const TransitionRequestSchema = z.object({
  version: z.number().int().positive(),
  expectedStatus: z.nativeEnum(RunStatus),
  payload: z.record(z.string(), z.any()).optional().default({}),
  idempotencyKey: z.string().uuid(),
}).strict();

// Internal binding request, no public route should hit this
export const BindDataOriginSchema = z.object({
  dataOriginHash: z.string().length(64), // sha256 hex
  canonicalStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idempotencyKey: z.string().uuid(),
  version: z.number().int().positive(),
}).strict();
