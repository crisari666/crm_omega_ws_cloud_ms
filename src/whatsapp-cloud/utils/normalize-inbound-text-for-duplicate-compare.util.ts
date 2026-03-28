/**
 * Normalizes user text so duplicate auto-messages match despite spacing or casing.
 */
export function normalizeInboundTextForDuplicateCompare(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}
