import {
  buildWhatsappContactsMessagePayload,
  buildWhatsappContactsMessageSummary,
} from './build-whatsapp-contacts-message.util';

describe('buildWhatsappContactsMessagePayload', () => {
  it('builds a Meta contacts payload with org branding and digits-only wa_id', () => {
    const actual = buildWhatsappContactsMessagePayload({
      to: '573001234567',
      firstName: 'Ana',
      lastName: 'López',
      phone: '+57 300 1234567',
    });
    expect(actual).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '573001234567',
      type: 'contacts',
      contacts: [
        {
          name: {
            formatted_name: 'Ana López (Asesor La Ceiba)',
            first_name: 'Ana',
            last_name: 'López',
          },
          phones: [
            {
              phone: '+57 300 1234567',
              type: 'WORK',
              wa_id: '573001234567',
            },
          ],
          org: {
            company: 'La Ceiba Group',
            title: 'Asesor Comercial Asignado',
          },
        },
      ],
    });
  });

  it('prefers explicit waId when provided', () => {
    const actual = buildWhatsappContactsMessagePayload({
      to: '573009876543',
      firstName: 'Luis',
      lastName: 'Perez',
      phone: '+57 300 9876543',
      waId: '573009876543',
    });
    expect(actual.contacts[0].phones[0].wa_id).toBe('573009876543');
  });
});

describe('buildWhatsappContactsMessageSummary', () => {
  it('returns a short persistence summary', () => {
    const actual = buildWhatsappContactsMessageSummary({
      to: '573001234567',
      firstName: 'Ana',
      lastName: 'López',
      phone: '3001234567',
    });
    expect(actual).toBe('Contacto: Ana López (Asesor La Ceiba) — 3001234567');
  });
});
