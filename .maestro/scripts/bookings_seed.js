// Maestro runScript helper (LOCAL stub only): adds customer bookings at HOURS (comma list of hours from now; negatives = past).
var base = 'http://127.0.0.1:8787/__e2e/';
var list = String(typeof HOURS === 'undefined' ? '' : HOURS).split(',');
for (var i = 0; i < list.length; i++) {
  if (list[i].trim() === '') continue;
  http.post(base + 'booking', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Client ' + (i + 1) + ' Smith', hours: Number(list[i]) }) });
}
