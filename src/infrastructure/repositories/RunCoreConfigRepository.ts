import { PrismaClient, Prisma } from '@prisma/client';
import { RunMode } from '../../domain/types/RunMode';
import { RunStatus } from '../../domain/types/RunStatus';
import { CanonicalSerializer } from '../../domain/hashing/CanonicalSerializer';

import { IRunCoreConfigRepository } from '../../application/ports/repositories/IRunCoreConfigRepository';

const prisma = new PrismaClient();

export class RunCoreConfigRepository implements IRunCoreConfigRepository {
  async findByContentHash(contentHash: string) {
    return prisma.runCoreConfigVersion.findUnique({
      where: { contentHash },
    });
  }

  async createSealed(configData: any, contentHash: string) {
    try {
      return await prisma.runCoreConfigVersion.create({
        data: {
          contentHash,
          ...configData
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002' && error.meta?.target?.includes('contentHash')) {
        // Race condition: another thread created it
        return this.findByContentHash(contentHash);
      }
      throw error;
    }
  }

  async getById(id: string) {
    return prisma.runCoreConfigVersion.findUnique({
      where: { id },
    });
  }
}

export const runCoreConfigRepository = new RunCoreConfigRepository();
