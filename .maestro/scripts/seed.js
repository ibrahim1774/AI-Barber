// Maestro runScript helper: talks to the LOCAL stub only (127.0.0.1:8787). Every env var is optional.
// TIER website|bookings|store | LAPSE days | STRIPE json | SIGNIN true | SIGNOUT true | EMAIL | SITEBASE https://host | BOOKING_NAME
function g(n) { try { var v = eval(n); return (v === undefined || v === null || String(v).indexOf('${') >= 0 || String(v) === 'undefined') ? '' : String(v); } catch (e) { return ''; } }
var base = 'http://127.0.0.1:8787/__e2e/';
function post(path, obj) { return http.post(base + path, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj || {}) }); }
if (g('TIER') && g('TIER') !== 'none') post('tier', { tier: g('TIER') });
if (g('LAPSE')) post('lapse', { days: Number(g('LAPSE')) });
if (g('STRIPE')) post('stripe', JSON.parse(g('STRIPE')));
if (g('SIGNIN') === 'true') post('signin', { email: g('EMAIL') || 'qa@example.com' });
if (g('SIGNOUT') === 'true') post('signout', {});
if (g('SITEBASE')) post('siteBase', { url: g('SITEBASE') });
if (g('BOOKING_NAME')) post('booking', { name: g('BOOKING_NAME'), hours: 3 });
