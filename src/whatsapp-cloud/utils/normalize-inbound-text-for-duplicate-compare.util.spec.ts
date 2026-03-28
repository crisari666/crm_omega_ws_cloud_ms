import { normalizeInboundTextForDuplicateCompare } from './normalize-inbound-text-for-duplicate-compare.util';

describe('normalizeInboundTextForDuplicateCompare', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    const inputText = '  Hola   Mundo  ';
    const actual = normalizeInboundTextForDuplicateCompare(inputText);
    const expected = 'hola mundo';
    expect(actual).toBe(expected);
  });
});
