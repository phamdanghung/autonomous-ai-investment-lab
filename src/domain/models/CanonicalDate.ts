export class CanonicalDate {
  public readonly value: string;

  constructor(dateString: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      throw new Error(`Invalid canonical date format: ${dateString}. Expected YYYY-MM-DD.`);
    }
    
    // Validate if it's an actual date
    const dateObj = new Date(dateString);
    if (isNaN(dateObj.getTime())) {
      throw new Error(`Invalid date: ${dateString}`);
    }
    
    // Ensure it matches exactly (e.g. catch 2026-02-30)
    const isoString = dateObj.toISOString();
    if (!isoString.startsWith(dateString)) {
      throw new Error(`Invalid date components: ${dateString}`);
    }
    
    this.value = dateString;
  }
}
