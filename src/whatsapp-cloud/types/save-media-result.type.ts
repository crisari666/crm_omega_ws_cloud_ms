/**
 * Result of persisting inbound WhatsApp media bytes to local disk.
 */
export interface SaveMediaResult {
  readonly relativePath: string;
  readonly byteSize: number;
}
