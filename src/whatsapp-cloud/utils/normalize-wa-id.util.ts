/**
 * Normalizes a WhatsApp id or phone string to digits-only for consistent chat keys.
 */
export function normalizeWaId(input: string): string {
  return input.replace(/\D/g, '');
}
