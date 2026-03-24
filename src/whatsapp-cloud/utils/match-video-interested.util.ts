import { WHATSAPP_ONBOARDING_WEBHOOK_CTAS } from './onboarding-webhook.constants';

/**
 * @returns True when the payload matches the video template CTA (`type: button` or `type: text`).
 */
export function matchesVideoInterestedInput(raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return normalized === WHATSAPP_ONBOARDING_WEBHOOK_CTAS.videoInterested.toLowerCase();
}
