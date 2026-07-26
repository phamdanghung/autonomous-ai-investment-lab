export interface IRunCoreConfigRepository {
  findByContentHash(contentHash: string): Promise<any | null>;
  createSealed(configData: any, contentHash: string): Promise<any>;
  getById(id: string): Promise<any | null>;
}
