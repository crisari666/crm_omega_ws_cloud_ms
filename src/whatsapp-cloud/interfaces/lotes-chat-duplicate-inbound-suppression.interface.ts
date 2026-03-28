/**
 * Suppresses La Ceiba LLM replies when the user sends the same text again within a time window
 * (common with automatic away messages), configured in {@link config_lotes_chat.json}.
 */
export interface LotesChatDuplicateInboundSuppression {
  readonly enabled: boolean;
  /** Max seconds between the two identical inbound messages for suppression to apply. */
  readonly windowSeconds: number;
  /** Normalized text shorter than this does not trigger suppression. */
  readonly minTextLength: number;
}
