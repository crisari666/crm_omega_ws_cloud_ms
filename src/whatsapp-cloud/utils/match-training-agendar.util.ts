import { WHATSAPP_ONBOARDING_WEBHOOK_CTAS } from './onboarding-webhook.constants';

/**
 * @returns True when the inbound text or button matches the post-call training CTA.
 */
export function matchesTrainingAgendarInput(raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  return normalized === WHATSAPP_ONBOARDING_WEBHOOK_CTAS.trainingAgendar.toLowerCase();
}
