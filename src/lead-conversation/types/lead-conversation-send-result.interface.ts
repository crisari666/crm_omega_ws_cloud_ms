/** RPC reply for `lead_conversation.send.v1`. */
export interface LeadConversationSendResult {
  readonly success: boolean;
  readonly wamid?: string;
  readonly error?: string;
}
