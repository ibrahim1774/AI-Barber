// Maestro runScript helper (LOCAL stub only): MLIMIT (number, "" = by plan), MREPORT (limit number the 409 body carries), MPROFILE (true|false = migration 015 live)
function g(n) { try { var v = eval(n); return (v === undefined || v === null || String(v).indexOf('${') >= 0 || String(v) === 'undefined') ? '' : String(v); } catch (e) { return ''; } }
var body = {};
if (g('MLIMIT') === 'plan') body.limit = null; else if (g('MLIMIT')) body.limit = Number(g('MLIMIT'));
if (g('MREPORT') === 'plan') body.report = null; else if (g('MREPORT')) body.report = Number(g('MREPORT'));
if (g('MPROFILE')) body.profile = g('MPROFILE') === 'true';
http.post('http://127.0.0.1:8787/__e2e/members', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
