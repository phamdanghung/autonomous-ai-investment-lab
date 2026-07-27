/*
  Warnings:

  - Made the column `sealedAt` on table `MarketDataSourceVersion` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "MarketDataSourceVersion" ALTER COLUMN "sealedAt" SET NOT NULL;
