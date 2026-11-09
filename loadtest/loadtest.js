// Load test with no extra packages (needs Node 18+). Start the server first, then:
//   node loadtest/loadtest.js --users 100 --concurrency 50 --seconds 15
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:3000'), USERS = +arg('users', 100), CONC = +arg('concurrency', 50), SECS = +arg('seconds', 15);
const JSONH = { 'Content-Type': 'application/json' };
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
const call = async (path, opt = {}) => {
    const t = performance.now();
    try { const r = await fetch(BASE + path, opt); const j = await r.json().catch(() => ({})); return { ok: r.ok, ms: performance.now() - t, j }; }
    catch { return { ok: false, ms: performance.now() - t, j: {} }; }
};
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); })); };
const report = (name, rs, secs) => {
    const ms = rs.map(r => r.ms), max = ms.reduce((a, b) => Math.max(a, b), 0);
    console.log(`${name}\n  ${rs.length} requests${secs ? `, ${(rs.length / secs).toFixed(0)} per second` : ''}, errors ${rs.filter(r => !r.ok).length}, median ${pct(ms, .5).toFixed(0)} ms, p95 ${pct(ms, .95).toFixed(0)} ms, p99 ${pct(ms, .99).toFixed(0)} ms, slowest ${max.toFixed(0)} ms\n`);
};

(async () => {
    const progs = (await call('/api/programs')).j;
    if (!Array.isArray(progs) || !progs.length) return console.error('Cannot reach the server or the database is empty. Run npm start first.');
    const run = Date.now(), users = Array.from({ length: USERS }, (_, i) => ({ email: `loadtest${run}_${i}@ptc.test`, password: 'loadtest123' }));
    console.log(`Testing ${BASE} with ${USERS} students, ${CONC} at a time, browsing for ${SECS} s\n`);

    const reg = [];
    await pool(users, 10, async u => { const r = await call('/api/register', { method: 'POST', headers: JSONH, body: JSON.stringify({ name: 'Load Test', ...u, program_id: progs[0].id, student_type: 'new' }) }); reg.push(r); u.token = r.j.token; });
    report('1. Sign-ups (10 at a time, password hashing is slow on purpose)', reg);

    const logins = [];
    await pool(users, CONC, async u => { const r = await call('/api/login', { method: 'POST', headers: JSONH, body: JSON.stringify(u) }); logins.push(r); if (r.ok) u.token = r.j.token; });
    report(`2. Login rush (${USERS} students logging in, ${CONC} at a time)`, logins);

    const ok = users.filter(u => u.token);
    if (!ok.length) return console.error('No test student could log in, so browsing was skipped.');
    const paths = ['/api/me', '/api/sections', '/api/documents'], browse = [], end = Date.now() + SECS * 1000;
    await Promise.all(Array.from({ length: CONC }, async (_, w) => {
        const h = { Authorization: 'Bearer ' + ok[w % ok.length].token };
        while (Date.now() < end) browse.push(await call(paths[Math.floor(Math.random() * paths.length)], { headers: h }));
    }));
    report(`3. Browsing (${CONC} students loading their page and sections nonstop)`, browse, SECS);
    console.log(`Test accounts are named loadtest${run}_N@ptc.test. Remove them in Admin tools: search "loadtest" and delete, or use "Delete ALL student accounts".`);
})();