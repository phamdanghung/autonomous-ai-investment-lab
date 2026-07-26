export class CanonicalSerializer {
  static serialize(obj: any): string {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj === 'bigint') return `"${obj.toString()}"`; // BigInt decimal string
    if (typeof obj === 'number') {
      if (Number.isNaN(obj) || !Number.isFinite(obj)) return 'null';
      // No scientific notation - JavaScript JSON.stringify handles basic numbers, but let's ensure no e notation
      let s = obj.toString();
      if (s.includes('e')) {
        // Expand scientific notation if needed, but for simplicity, we can use toFixed or similar.
        // Usually, financial numbers shouldn't use scientific notation anyway.
        s = Number(s).toFixed(20).replace(/\.?0+$/, '');
      }
      return s;
    }
    if (typeof obj === 'boolean') return obj ? 'true' : 'false';
    if (typeof obj === 'string') return `"${obj.normalize('NFC')}"`; // Unicode NFC
    
    if (obj instanceof Date) {
      // DATE must be serialized as YYYY-MM-DD according to the deterministic hash contract
      const yyyy = obj.getUTCFullYear();
      const mm = String(obj.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(obj.getUTCDate()).padStart(2, '0');
      return `"${yyyy}-${mm}-${dd}"`;
    }

    if (Array.isArray(obj)) {
      const items = obj.map(item => this.serialize(item));
      return `[${items.join(',')}]`;
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj).sort(); // Stable object-key order
      const parts = keys.map(key => {
        const val = obj[key];
        // Enums to uppercase is handled by the caller or by virtue of Prisma enums being uppercase strings
        let serializedVal = this.serialize(val);
        // Special case: if val is a string that looks like an enum, caller should pass it uppercase.
        // We assume enum values are passed correctly.
        return `"${key}":${serializedVal}`;
      });
      return `{${parts.join(',')}}`;
    }

    return 'null';
  }
}
