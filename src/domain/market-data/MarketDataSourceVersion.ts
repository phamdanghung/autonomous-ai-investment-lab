import { CanonicalSourceContractPayload, MARKET_DATA_CONTRACT_VERSIONS, MarketDatasetKind, MarketAdapterKind, MarketPriceUnit, SourceEncoding } from '../contracts/MarketDataContracts';
import { MarketDataCanonicalization } from './MarketDataCanonicalization';
import { MarketSourceVersionInvalidError } from './MarketDataErrors';

export interface MarketDataSourceVersion {
  id: string; // UUID
  sourceKey: string;
  contractHash: string; // 64-char lowercase hex
  providerCode: string;
  datasetKind: MarketDatasetKind;
  sealedAt: Date;
  adapterKind: MarketAdapterKind;
  adapterVersion: string;
  schemaVersion: string;
  canonicalizationVersion: string;
  priceUnit: MarketPriceUnit;
  encoding: SourceEncoding;
}

export const MARKET_SOURCE_MAX_LENGTHS = {
  PROVIDER_CODE: 50,
  ADAPTER_VERSION: 50,
  SCHEMA_VERSION: 50,
  CANONICALIZATION_VERSION: 50,
} as const;

export class MarketDataSourceVersionDomain {
  /**
   * Validates and normalizes string fields.
   */
  static validateFields(providerCode: string, adapterVersion: string, schemaVersion: string, canonicalizationVersion: string) {
    if (!providerCode.trim()) throw new MarketSourceVersionInvalidError('providerCode is empty');
    if (!adapterVersion.trim()) throw new MarketSourceVersionInvalidError('adapterVersion is empty');
    if (!schemaVersion.trim()) throw new MarketSourceVersionInvalidError('schemaVersion is empty');
    if (!canonicalizationVersion.trim()) throw new MarketSourceVersionInvalidError('canonicalizationVersion is empty');

    if (providerCode.length > MARKET_SOURCE_MAX_LENGTHS.PROVIDER_CODE) throw new MarketSourceVersionInvalidError('providerCode too long');
    if (adapterVersion.length > MARKET_SOURCE_MAX_LENGTHS.ADAPTER_VERSION) throw new MarketSourceVersionInvalidError('adapterVersion too long');
    if (schemaVersion.length > MARKET_SOURCE_MAX_LENGTHS.SCHEMA_VERSION) throw new MarketSourceVersionInvalidError('schemaVersion too long');
    if (canonicalizationVersion.length > MARKET_SOURCE_MAX_LENGTHS.CANONICALIZATION_VERSION) throw new MarketSourceVersionInvalidError('canonicalizationVersion too long');

    // Check for control characters
    const controlCharRegex = /[\x00-\x1F\x7F]/;
    if (controlCharRegex.test(providerCode)) throw new MarketSourceVersionInvalidError('providerCode contains control characters');
    if (controlCharRegex.test(adapterVersion)) throw new MarketSourceVersionInvalidError('adapterVersion contains control characters');
    if (controlCharRegex.test(schemaVersion)) throw new MarketSourceVersionInvalidError('schemaVersion contains control characters');
    if (controlCharRegex.test(canonicalizationVersion)) throw new MarketSourceVersionInvalidError('canonicalizationVersion contains control characters');
  }

  /**
   * Builds the canonical payload and hashes it.
   */
  static buildContractHash(payload: Omit<CanonicalSourceContractPayload, 'sourceContractVersion'>): { payload: CanonicalSourceContractPayload, hash: string } {
    this.validateFields(payload.providerCode, payload.adapterVersion, payload.schemaVersion, payload.canonicalizationVersion);

    const canonicalPayload: CanonicalSourceContractPayload = {
      sourceContractVersion: MARKET_DATA_CONTRACT_VERSIONS.SOURCE_CONTRACT,
      providerCode: payload.providerCode.trim(),
      datasetKind: payload.datasetKind,
      adapterKind: payload.adapterKind,
      adapterVersion: payload.adapterVersion.trim(),
      schemaVersion: payload.schemaVersion.trim(),
      canonicalizationVersion: payload.canonicalizationVersion.trim(),
      priceUnit: payload.priceUnit,
      encoding: payload.encoding,
    };

    const hash = MarketDataCanonicalization.hashPayload(canonicalPayload).toLowerCase();

    return { payload: canonicalPayload, hash };
  }

  /**
   * Generates the deterministic source key.
   */
  static buildSourceKey(contractHash: string): string {
    return `VN|MARKET_DATA_SOURCE|${contractHash}`;
  }
}
