import type { LeadConversationButton } from './lead-conversation-button.interface';
import type { LeadConversationContact } from './lead-conversation-contact.interface';
import type { LeadConversationMessageKind } from './lead-conversation-message-kind.type';

/**
 * RPC payload for `lead_conversation.send.v1` (crm-omega-customers-ms → whatsapp_cloud_ms).
 */
export interface LeadConversationSendCommand {
  readonly to: string;
  readonly kind: LeadConversationMessageKind;
  readonly body?: string;
  readonly mediaUrl?: string;
  readonly fileName?: string;
  readonly buttons?: readonly LeadConversationButton[];
  readonly listButtonLabel?: string;
  readonly contact?: LeadConversationContact;
  /** Required when `kind` is `template` (opens 24h window on leads line). */
  readonly templateName?: string;
  readonly languageCode?: string;
  readonly templateComponents?: readonly Record<string, unknown>[];
}
