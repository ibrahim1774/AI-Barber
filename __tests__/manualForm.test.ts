import { manualInputs, normalizeManualPhone, validateManual } from '@/lib/manualForm';

it('requires name, address and phone; phone accepts 10 digits, 1+10 digits, and punctuated numbers', () => {
  expect(validateManual({ shopName: '', address: '', phone: '', place: '' })).toEqual({ shopName: expect.any(String), address: expect.any(String), phone: expect.any(String) });
  expect(validateManual({ shopName: 'A', address: 'Austin, TX', phone: '5125550142', place: '' })).toEqual({});
  expect(validateManual({ shopName: 'A', address: 'Austin, TX', phone: '+1 (512) 555-0142', place: '' })).toEqual({});
  expect(validateManual({ shopName: 'A', address: 'Austin, TX', phone: '15125550142', place: '' })).toEqual({});
  expect(validateManual({ shopName: 'A', address: 'Austin, TX', phone: '+1 512 555 0142', place: '' })).toEqual({});
  expect(validateManual({ shopName: 'A', address: 'Austin, TX', phone: '512555', place: '' })).toEqual({ phone: 'Enter a 10-digit mobile number.' });
  expect(validateManual({ shopName: 'A', address: 'Austin, TX', phone: '5125550142', place: 'Suite 200' })).toEqual({ place: "Use the area's name, not an address." });
});

it('maps the form onto site inputs: city/state from the address, formatted phone, verbatim address', () => {
  const i = manualInputs({ shopName: ' Fade Lab ', address: '512 Congress Ave, Austin, TX 78701', phone: '5125550142', place: ' Downtown ' }, '#f4a100');
  expect(i).toMatchObject({ shopName: 'Fade Lab', area: 'Austin, TX', address: '512 Congress Ave, Austin, TX 78701', phone: '(512) 555-0142', place: 'Downtown' });
  expect(manualInputs({ shopName: 'A', address: 'Austin', phone: '1', place: '' }, '#f4a100').area).toBe('Austin');
  expect(manualInputs({ shopName: 'A', address: 'Austin', phone: '+1 512 555 0142', place: '' }, '#f4a100').phone).toBe('(512) 555-0142');
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
  expect(validateManual({ shopName: 'A', address: 'Austin', phone: '-', place: '' }).phone).toBeDefined();
  expect(validateManual({ shopName: 'A', address: 'Austin', phone: 'call me', place: '' }).phone).toBeDefined();
});
