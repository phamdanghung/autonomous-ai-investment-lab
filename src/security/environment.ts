import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url(),
  SHADOW_DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Add other required env vars here
});

let envCache: z.infer<typeof EnvSchema> | null = null;

export const ConfigLoader = {
  load(): z.infer<typeof EnvSchema> {
    if (envCache) return envCache;
    
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      // Don't log the actual values or raw errors that might contain secrets
      console.error('Environment validation failed:', parsed.error.issues.map(i => i.path.join('.')));
      throw new Error('Invalid environment configuration');
    }
    
    envCache = parsed.data;
    return envCache;
  },
  
  get(key: keyof z.infer<typeof EnvSchema>) {
    return this.load()[key];
  }
};
