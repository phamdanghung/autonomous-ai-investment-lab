import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function walkDir(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      walkDir(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }
  return fileList;
}

describe('MarketDataArchitecture', () => {
  it('should not contain any imports from Prisma, Next, Application, or Infrastructure in the Domain recursively', () => {
    const domainDir = path.resolve(__dirname, '../../../src/domain/market-data');
    const allFiles = walkDir(domainDir).filter(f => f.endsWith('.ts'));

    expect(allFiles.length).toBeGreaterThan(0);
    let scannedCount = 0;

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf8');

      // Look for prohibited imports
      expect(content).not.toMatch(/from\s+['"]@prisma\/client['"]/);
      expect(content).not.toMatch(/from\s+['"]next(\/.*)?['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/\.\.\/application(\/.*)?['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/\.\.\/infrastructure(\/.*)?['"]/);
      expect(content).not.toMatch(/from\s+['"]http['"]/);
      expect(content).not.toMatch(/from\s+['"]https['"]/);

      scannedCount++;
    }

    // Exact count expectation (9 domain files currently including Types, Validation, etc.)
    expect(scannedCount).toBe(allFiles.length);
    // Explicit list
    const fileBasenames = allFiles.map(f => path.basename(f)).sort();
    expect(fileBasenames).toEqual([
      'DailyMarketBar.ts',
      'DatasetSnapshot.ts',
      'MarketDataCanonicalization.ts',
      'MarketDataErrors.ts',
      'MarketDataImportBatch.ts',
      'MarketDataSourceVersion.ts',
      'MarketDataValidation.ts',
      'MarketInstrument.ts',
      'TradingCalendarDay.ts'
    ].sort());
  });
});
