/**
 * One line in a WhatsApp thread as seen by the LLM (inbound = user, outbound = assistant).
 */
export interface WhatsappLlmConversationTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}
