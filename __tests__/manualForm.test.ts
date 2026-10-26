import { manualInputs, normalizeManualPhone, validateManual } from '@/lib/manualForm';

it('requires name, local service area and phone; phone accepts 10 digits, 1+10 digits, and punctuated numbers', () => {
  expect(validateManual({ shopName: '', place: '', phone: '' })).toEqual({ shopName: expect.any(String), place: expect.any(String), phone: expect.any(String) });
  expect(validateManual({ shopName: 'A', place: 'Austin, TX', phone: '5125550142' })).toEqual({});
  expect(validateManual({ shopName: 'A', place: 'Austin, TX', phone: '+1 (512) 555-0142' })).toEqual({});
  expect(validateManual({ shopName: 'A', place: 'Austin, TX', phone: '15125550142' })).toEqual({});
  expect(validateManual({ shopName: 'A', place: 'Austin, TX', phone: '+1 512 555 0142' })).toEqual({});
  expect(validateManual({ shopName: 'A', place: 'Austin, TX', phone: '512555' })).toEqual({ phone: 'Enter a 10-digit mobile number.' });
  expect(validateManual({ shopName: 'A', place: 'Suite 200', phone: '5125550142' })).toEqual({ place: expect.stringContaining('not an address') });
});

it('maps the form onto site inputs: the service area is the area and the place label, no street address', () => {
  const i = manualInputs({ shopName: ' Fade Lab ', place: ' Austin, TX ', phone: '5125550142' }, '#f4a100');
  expect(i).toMatchObject({ shopName: 'Fade Lab', area: 'Austin, TX', address: '', phone: '(512) 555-0142', place: 'Austin, TX' });
  expect(manualInputs({ shopName: 'A', place: 'Downtown Austin', phone: '+1 512 555 0142' }, '#f4a100').phone).toBe('(512) 555-0142');
  expect(Object.keys(manualInputs({ shopName: 'A', place: 'Austin', phone: '1' }, '#f4a100')).sort()).toEqual(['address', 'area', 'colorTheme', 'phone', 'place', 'shopName']);
});

it('normalises every US phone shape to one that gives a valid tel: link', () => {
  for (const raw of ['+1 (512) 555-0142', '1-512-555-0142', '512.555.0142', '(512) 555 0142', '5125550142', '15125550142', ' +1 512-555-0142 ']) {
    const out = normalizeManualPhone(raw);
    expect(out).toBe('(512) 555-0142');
    expect(`tel:+1${out.replace(/\D/g, '')}`).toBe('tel:+15125550142');
  }
  expect(normalizeManualPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
});

it('rejects phones with fewer than 7 digits (for example "-")', () => {
  expect(validateManual({ shopName: 'A', place: 'Austin', phone: '-' }).phone).toBeDefined();
  expect(validateManual({ shopName: 'A', place: 'Austin', phone: 'call me' }).phone).toBeDefined();
});
