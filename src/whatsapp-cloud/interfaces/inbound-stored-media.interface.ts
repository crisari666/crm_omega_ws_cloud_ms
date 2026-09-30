/**
 * Inbound WhatsApp media already downloaded to local disk.
 */
export interface InboundStoredMedia {
  readonly whatsappMessageId: string;
  readonly storedRelativePath: string;
  readonly absolutePath: string;
  readonly mimeType: string;
  readonly filename: string;
}
