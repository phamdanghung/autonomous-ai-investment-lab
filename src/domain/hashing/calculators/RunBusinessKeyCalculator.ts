import crypto from 'crypto';
import { RunMode } from '../../types/RunMode';
import { CanonicalDate } from '../../models/CanonicalDate';

export class RunBusinessKeyCalculator {
  static calculate(
    mode: RunMode,
    coreConfigHash: string,
    dataOriginHash: string,
    codeVersion: string,
    rngSeed: bigint,
    canonicalStartDate: CanonicalDate
  ): string {
    const raw = `${mode.toUpperCase()}${coreConfigHash}${dataOriginHash}${codeVersion}${rngSeed.toString()}${canonicalStartDate.value}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
