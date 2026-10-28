import { buildLeadConversationGraphPayload } from './build-lead-conversation-graph-payload.util';

describe('buildLeadConversationGraphPayload', () => {
  it('builds reply buttons capped at 3 with truncated titles', () => {
    const inputButtons = [
      { id: 'a', title: '300 m²' },
      { id: 'b', title: '400 a 500 m² y un poco más' },
      { id: 'c', title: '1.000 m²' },
      { id: 'd', title: 'extra' },
    ];
    const actual = buildLeadConversationGraphPayload({ to: '573001112233', kind: 'buttons', body: 'Elige', buttons: inputButtons });
    const interactive = actual.interactive as { action: { buttons: { reply: { title: string } }[] } };
    expect(interactive.action.buttons).toHaveLength(3);
    expect(interactive.action.buttons[1].reply.title.length).toBeLessThanOrEqual(20);
  });

  it('builds a list message', () => {
    const actual = buildLeadConversationGraphPayload({
      to: '573001112233',
      kind: 'list',
      body: '¿Cuál proyecto te interesa?',
      buttons: [{ id: 'p1', title: 'Valle del Sol' }],
    });
    expect((actual.interactive as { type: string }).type).toBe('list');
  });

  it('throws when image has no mediaUrl', () => {
    expect(() => buildLeadConversationGraphPayload({ to: '1', kind: 'image' })).toThrow();
  });

  it('builds a contacts card with one CELL phone', () => {
    const actual = buildLeadConversationGraphPayload({
      to: '573001112233',
      kind: 'contacts',
      contact: {
        firstName: 'Ana',
        lastName: 'López',
        phones: [{ phone: '+57 300 111 2233', type: 'CELL' }],
      },
    });
    expect(actual.type).toBe('contacts');
    const contacts = actual.contacts as {
      name: { formatted_name: string };
      phones: { phone: string; type: string; wa_id: string }[];
    }[];
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name.formatted_name).toBe('Ana López (Asesor La Ceiba)');
    expect(contacts[0].phones).toEqual([
      { phone: '+57 300 111 2233', type: 'CELL', wa_id: '573001112233' },
    ]);
  });

  it('builds a contacts card with CELL and WORK phones', () => {
    const actual = buildLeadConversationGraphPayload({
      to: '573001112233',
      kind: 'contacts',
      contact: {
        firstName: 'Ana',
        lastName: 'López',
        phones: [
          { phone: '3001112233', type: 'CELL', waId: '573001112233' },
          { phone: '6015551212', type: 'WORK' },
        ],
      },
    });
    const contacts = actual.contacts as { phones: { type: string; wa_id: string }[] }[];
    expect(contacts[0].phones).toHaveLength(2);
    expect(contacts[0].phones[0].type).toBe('CELL');
    expect(contacts[0].phones[1]).toEqual({ phone: '6015551212', type: 'WORK', wa_id: '6015551212' });
  });

  it('throws when contacts has no usable phones', () => {
    expect(() =>
      buildLeadConversationGraphPayload({
        to: '573001112233',
        kind: 'contacts',
        contact: { firstName: 'Ana', lastName: 'López', phones: [{ phone: '   ', type: 'CELL' }] },
      }),
    ).toThrow('contacts message requires at least one phone');
  });
});
