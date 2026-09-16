import { normalizeWaId } from './normalize-wa-id.util';

export type BuildWhatsappContactsMessageInput = {
  readonly to: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly waId?: string;
};

export type WhatsappContactsMessagePayload = {
  readonly messaging_product: 'whatsapp';
  readonly recipient_type: 'individual';
  readonly to: string;
  readonly type: 'contacts';
  readonly contacts: ReadonlyArray<{
    readonly name: {
      readonly formatted_name: string;
      readonly first_name: string;
      readonly last_name: string;
    };
    readonly phones: ReadonlyArray<{
      readonly phone: string;
      readonly type: 'WORK';
      readonly wa_id: string;
    }>;
    readonly org: {
      readonly company: string;
      readonly title: string;
    };
  }>;
};

const VENTOR_CONTACT_COMPANY = 'La Ceiba Group' as const;
const VENTOR_CONTACT_TITLE = 'Asesor Comercial Asignado' as const;

/**
 * Builds a Meta Graph WhatsApp `contacts` (vCard) message payload for the customers line.
 */
export function buildWhatsappContactsMessagePayload(
  input: BuildWhatsappContactsMessageInput,
): WhatsappContactsMessagePayload {
  const to: string = input.to.trim();
  const firstName: string = input.firstName.trim();
  const lastName: string = input.lastName.trim();
  const phone: string = input.phone.trim();
  const waIdSource: string =
    input.waId != null && input.waId.trim().length > 0 ? input.waId.trim() : phone;
  const waId: string = normalizeWaId(waIdSource);
  const displayName: string = `${firstName} ${lastName}`.trim();
  const formattedName: string =
    displayName.length > 0
      ? `${displayName} (Asesor La Ceiba)`
      : 'Asesor La Ceiba';
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'contacts',
    contacts: [
      {
        name: {
          formatted_name: formattedName,
          first_name: firstName.length > 0 ? firstName : 'Asesor',
          last_name: lastName,
        },
        phones: [
          {
            phone,
            type: 'WORK',
            wa_id: waId,
          },
        ],
        org: {
          company: VENTOR_CONTACT_COMPANY,
          title: VENTOR_CONTACT_TITLE,
        },
      },
    ],
  };
}

/**
 * Human-readable summary for chat persistence after sending a contacts message.
 */
export function buildWhatsappContactsMessageSummary(
  input: BuildWhatsappContactsMessageInput,
): string {
  const payload = buildWhatsappContactsMessagePayload(input);
  const contact = payload.contacts[0];
  return `Contacto: ${contact.name.formatted_name} — ${contact.phones[0].phone}`;
}
