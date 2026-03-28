/**
 * Converts WhatsApp Cloud API unix seconds (string or number) to a Date.
 */
export function parseWhatsappTimestampSeconds(value: string | number | undefined): Date {
  if (value === undefined || value === '') {
    return new Date();
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) {
    return new Date();
  }
  return new Date(n * 1000);
}
