import { MarketInstrumentInvalidError } from './MarketDataErrors';

export class MarketDataValidation {
  /**
   * Normalizes and validates a market symbol.
   */
  static normalizeSymbol(input: string): string {
    const trimmed = input.trim();
    if (!/^[A-Za-z0-9]{1,20}$/.test(trimmed)) {
      throw new MarketInstrumentInvalidError('Invalid symbol format');
    }

    const canonical = trimmed.toUpperCase();
    if (!/^[A-Z0-9]{1,20}$/.test(canonical)) {
      throw new MarketInstrumentInvalidError('Invalid symbol format');
    }

    return canonical;
  }


  /**
   * Validates and normalizes a YYYY-MM-DD date string.
   */
  static normalizeDateOnly(dateString: string): string {
    const trimmed = dateString.trim();
    const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;

    const match = trimmed.match(dateRegex);
    if (!match) {
      throw new Error(`Invalid date format, expected YYYY-MM-DD: ${dateString}`);
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);

    if (month < 1 || month > 12) {
      throw new Error(`Invalid month in date: ${dateString}`);
    }

    // Create UTC date to check calendar validity
    const d = new Date(Date.UTC(year, month - 1, day));

    // Check if the date object matches our input (detects leap year issues and invalid days like Feb 30)
    if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
      throw new Error(`Invalid calendar day in date: ${dateString}`);
    }

    return trimmed; // Already matches exactly YYYY-MM-DD
  }

  /**
   * Trims whitespace from calendar reason. If empty, returns null.
   */
  static normalizeCalendarReason(reason: string | null | undefined): string | null {
    if (!reason) return null;
    const trimmed = reason.trim();
    if (trimmed.length === 0) return null;
    return trimmed;
  }
}
