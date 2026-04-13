/**
 * CTA copy from Meta templates: greeting (`saludo_aspirante`) vs video (`video_msj`).
 */
export const WHATSAPP_ONBOARDING_WEBHOOK_CTAS = {
  greetingInterested: 'Estoy Interesado',
  wantToKnowMore: 'Quiero saber',
  videoInterested: 'Interesado',
  trainingAgendar: 'AGENDAR',
} as const;

/** Meta template name: post-call training confirmation (body uses `contact_name`). */
export const WHATSAPP_TEMPLATE_CONFIRMAR_CAPACITACION = 'confirmar_capacitacion';

/** Outbound `textBody` marker persisted for the training slot list message. */
export const WHATSAPP_TRAINING_SLOTS_LIST_MARKER = 'training_slots_list';
