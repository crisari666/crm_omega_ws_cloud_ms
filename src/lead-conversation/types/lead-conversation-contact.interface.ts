import type { LeadConversationContactPhone } from './lead-conversation-contact-phone.interface';

/** Contact card fields for `lead_conversation.send.v1` kind `contacts`. */
export interface LeadConversationContact {
  readonly firstName: string;
  readonly lastName: string;
  readonly phones: readonly LeadConversationContactPhone[];
}
