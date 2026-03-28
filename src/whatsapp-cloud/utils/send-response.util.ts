import type { SendMessageResponse } from '@kapso/whatsapp-cloud-api';

/**
 * Returns the first Graph message id from a send response, if present.
 */
export function getFirstSentWhatsappMessageId(
  response: SendMessageResponse,
): string | undefined {
  const first = response.messages?.[0];
  return first?.id;
}
