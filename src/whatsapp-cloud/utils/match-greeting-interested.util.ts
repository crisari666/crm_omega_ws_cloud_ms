import { WHATSAPP_ONBOARDING_WEBHOOK_CTAS } from './onboarding-webhook.constants';

/**
 * @returns True when the payload matches the greeting template CTA (only full phrase).
 */
export function matchesGreetingInterestedInput(raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return normalized === WHATSAPP_ONBOARDING_WEBHOOK_CTAS.greetingInterested.toLowerCase() || normalized === WHATSAPP_ONBOARDING_WEBHOOK_CTAS.wantToKnowMore.toLowerCase();
}
