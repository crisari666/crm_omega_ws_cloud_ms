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
});
