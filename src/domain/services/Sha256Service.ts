import * as crypto from 'crypto';

export class Sha256Service {
  static hashString(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
