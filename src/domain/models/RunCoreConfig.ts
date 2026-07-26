export enum RunMode {
  HISTORICAL_REPLAY = 'HISTORICAL_REPLAY',
  LIVE_FORWARD = 'LIVE_FORWARD'
}

export enum RunStatus {
  INITIALIZED = 'INITIALIZED',
  CONFIGURED = 'CONFIGURED',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  FAILED = 'FAILED',
  TERMINATED = 'TERMINATED',
  SEALED = 'SEALED'
}

export enum ActorType {
  SYSTEM = 'SYSTEM',
  ADMIN = 'ADMIN',
  VIEWER = 'VIEWER'
}

export interface RunCoreConfigVersion {
  id: string;
  contentHash: string;
  mode: RunMode;
  initialCapital: bigint; // Used for BigInt mapping
  codeVersion: string;
  rngSeed: bigint;
  fillPolicyVersionKey: string;
  orchestrationVersionKey: string;
  createdAt: Date;
  sealedAt: Date;
}
