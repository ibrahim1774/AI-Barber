import { formatPhone } from '@/lib/phone';
import { setContact } from '@/lib/sections/aboutContact';
import { applyHomePrompts } from '@/lib/editor';
import * as gemini from '@/web/services/geminiService';

describe('formatPhone', () => {
  test('bare US digits get the imported-number shape', () => {
    expect(formatPhone('5125550142')).toBe('(512) 555-0142');
    expect(formatPhone(' 15125550142 ')).toBe('(512) 555-0142');
  });
  test('anything else is left as typed', () => {
    expect(formatPhone('512-555-0100')).toBe('512-555-0100');
    expect(formatPhone('(512) 555-0142')).toBe('(512) 555-0142');
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(formatPhone('555')).toBe('555');
    expect(formatPhone('')).toBe('');
  });
});

test('the Contact sheet and the area/phone prompt save the formatted number', async () => {
  const d: any = { phone: '', contact: { address: '', email: '' } };
  expect(setContact(d, { phone: '5125550142', address: '', email: '' }).phone).toBe('(512) 555-0142');
  jest.spyOn(gemini, 'generateContent').mockRejectedValueOnce(new Error('boom'));
  const out = await applyHomePrompts({ ...d, shopName: 'X' }, 'Austin, TX', '5125550142');
  expect(out.phone).toBe('(512) 555-0142');
});
