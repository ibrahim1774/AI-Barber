// Maestro runScript helper for stub fault injection (LOCAL stub only). env: FPATH (prefix), FMODE (offline|hang|500|429|html500|malformed|lose), FTIMES (n or ""), FCLEAR ("true" clears all)
function g(n) { try { var v = eval(n); return (v === undefined || v === null || String(v).indexOf('${') >= 0 || String(v) === 'undefined') ? '' : String(v); } catch (e) { return ''; } }
var base = 'http://127.0.0.1:8787/__e2e/';
if (g('FCLEAR') === 'true') http.post(base + 'faults/clear', { headers: { 'Content-Type': 'application/json' }, body: '{}' });
if (g('FPATH')) http.post(base + 'fault', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: g('FPATH'), mode: g('FMODE'), times: g('FTIMES') ? Number(g('FTIMES')) : undefined }) });
