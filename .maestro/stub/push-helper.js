#!/usr/bin/env node
// Tutorial recordings only: POST /push/<booking|order|payment> makes the simulator show that demo push (xcrun simctl push).
// Usage: SIM=<udid> node push-helper.js [port]   (default 8799). Local only, no real services.
const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SIM = process.env.SIM || 'booted';
const BUNDLE = 'com.ibrahim1774.aibarber';
const MSG = {
  booking: ['New booking', 'Client 2 Smith booked a Haircut for 3:00 PM'],
  order: ['New order', 'Matte pomade x1, pickup. $12.50'],
  payment: ['Payment received', '$30.00 from Client 2 Smith'],
};
http.createServer((req, res) => {
  const m = /^\/push\/(\w+)/.exec(req.url || '');
  if (!m || !MSG[m[1]]) { res.statusCode = 404; return res.end('no'); }
  const f = path.join(os.tmpdir(), `push-${m[1]}.json`);
  fs.writeFileSync(f, JSON.stringify({ 'Simulator Target Bundle': BUNDLE, aps: { alert: { title: MSG[m[1]][0], body: MSG[m[1]][1] }, sound: 'default' } }));
  execFile('xcrun', ['simctl', 'push', SIM, BUNDLE, f], (e) => { res.end(e ? 'err' : 'ok'); });
}).listen(Number(process.argv[2] || 8799), '127.0.0.1');
