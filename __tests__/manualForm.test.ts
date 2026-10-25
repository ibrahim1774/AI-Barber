import { manualInputs, validateManual } from '@/lib/manualForm';

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
  expect(manualInputs({ shopName: 'A', address: 'Austin', phone: '+1 512 555 0142', place: '' }, '#f4a100').phone).toBe('+1 512 555 0142');
});
