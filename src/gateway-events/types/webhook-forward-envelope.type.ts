export interface WebhookForwardEnvelope {
  readonly source: string;
  readonly receivedAt: string;
  readonly payload: unknown;
}
