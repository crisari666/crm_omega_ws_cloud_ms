/** One phone entry on a Meta WhatsApp contacts (vCard) message. */
export interface LeadConversationContactPhone {
  readonly phone: string;
  readonly type: 'CELL' | 'WORK' | 'MAIN';
  readonly waId?: string;
}
