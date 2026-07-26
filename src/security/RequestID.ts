import { v4 as uuidv4 } from 'uuid';

export class RequestContext {
  public readonly id: string;
  public readonly timestamp: Date;
  
  constructor(reqId?: string) {
    this.id = reqId || uuidv4();
    this.timestamp = new Date();
  }
}
