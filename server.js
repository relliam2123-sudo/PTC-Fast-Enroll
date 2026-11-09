// PTC Fast-Enroll API (phase 1: accounts + enrollment core). Run: npm install && npm start
const express = require('express'), mysql = require('mysql2/promise'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const app = express(), SECRET = process.env.JWT_SECRET || 'change-me-before-the-defense', TERM = '2026-1', MAX_UNITS = 21;
const db = mysql.createPool({ host: 'localhost', user: 'root', password: '', database: 'ptc_fast_enroll', connectionLimit: 20, multipleStatements: true });
const STAGES = ['Account created', 'Documents submitted', 'Registrar evaluating', 'Sections reserved', 'Payment pending', 'Officially enrolled'];
const TYPES = ['new', 'continuing', 'transferee', 'returnee', 'irregular'];

// Tiny cache for data everyone requests but rarely changes (swap for Redis in a later phase).
const cache = new Map();
async function cached(key, ttl, fn) {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.v;
    const v = await fn(); cache.set(key, { v, exp: Date.now() + ttl }); return v;
}
const mins = t => { const [h, m] = t.split(':'); return h * 60 + +m; };
const wrap = f => (req, res) => f(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error. Try again.' }); });
const auth = (req, res, next) => {
    try { req.user = jwt.verify((req.headers.authorization || '').slice(7), SECRET); next(); }
    catch { res.status(401).json({ error: 'Please log in again.' }); }
};
const sign = (id, role) => jwt.sign({ id, role }, SECRET, { expiresIn: '8h' });

app.use(express.json()); app.use(express.static('public'));

app.get('/api/programs', wrap(async (_, res) => res.json((await db.query('SELECT id, code, name FROM programs'))[0])));

app.post('/api/register', wrap(async (req, res) => {
    const { name, email, password, program_id, student_type } = req.body;
    if (!name || !email || !program_id || !password || password.length < 8) return res.status(400).json({ error: 'Fill in every field. Password needs 8+ characters.' });
    if (!TYPES.includes(student_type)) return res.status(400).json({ error: 'Choose a student type.' });
    const c = await db.getConnection();
    try {
        await c.beginTransaction();
        const [r] = await c.query('INSERT INTO users (full_name, email, password_hash) VALUES (?,?,?)', [name, email.toLowerCase(), await bcrypt.hash(password, 10)]);
        await c.query('INSERT INTO students (user_id, program_id, student_type) VALUES (?,?,?)', [r.insertId, program_id, student_type]);
        await c.commit(); res.json({ token: sign(r.insertId, 'student') });
    } catch (e) {
        await c.rollback();
        if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That email is already registered.' });
        throw e;
    } finally { c.release(); }
}));

app.post('/api/login', wrap(async (req, res) => {
    const [[u]] = await db.query('SELECT id, password_hash, role FROM users WHERE email = ?', [(req.body.email || '').toLowerCase()]);
    if (!u || !(await bcrypt.compare(req.body.password || '', u.password_hash))) return res.status(401).json({ error: 'Wrong email or password.' });
    res.json({ token: sign(u.id, u.role) });
}));

// Enrollment stage is computed from real data: documents uploaded -> reviewed -> approved -> sections reserved.
async function stageFor(id) {
    const [d] = await db.query('SELECT status FROM documents WHERE student_id = ?', [id]);
    const [[{ need }]] = await db.query('SELECT COUNT(*) need FROM document_types');
    const [[e]] = await db.query('SELECT COUNT(*) n FROM applications a JOIN enrollments en ON en.application_id = a.id WHERE a.student_id = ? AND a.term = ?', [id, TERM]);
    if (d.length < need) return 1;
    if (d.filter(x => x.status === 'approved').length === need) {
        if (!e.n) return 4;
        const [[p]] = await db.query("SELECT COUNT(*) n FROM payments WHERE student_id = ? AND term = ? AND status = 'paid'", [id, TERM]);
        return p.n ? 6 : 5;
    }
    return d.some(x => x.status !== 'pending') ? 3 : 2;
}

app.get('/api/me', auth, wrap(async (req, res) => {
    const [[u]] = await db.query('SELECT full_name, role FROM users WHERE id = ?', [req.user.id]);
    if (u.role !== 'student') return res.json({ ...u, staff: true });
    const [[s]] = await db.query('SELECT p.code program, st.student_type FROM students st JOIN programs p ON p.id = st.program_id WHERE st.user_id = ?', [req.user.id]);
    const [ids] = await db.query('SELECT en.section_id FROM applications a JOIN enrollments en ON en.application_id = a.id WHERE a.student_id = ? AND a.term = ?', [req.user.id, TERM]);
    res.json({ ...u, ...s, stages: STAGES, stage: await stageFor(req.user.id), section_ids: ids.map(x => x.section_id), max_units: MAX_UNITS });
}));

const catalog = () => cached('catalog', 60000, async () => {
    const [rows] = await db.query(`SELECT s.id, s.code, s.capacity, c.id course_id, c.code course_code, c.title, c.units,
                                          m.day, TIME_FORMAT(m.start_time,'%H:%i') ts, TIME_FORMAT(m.end_time,'%H:%i') te
                                   FROM sections s JOIN courses c ON c.id = s.course_id JOIN meetings m ON m.section_id = s.id
                                   WHERE s.term = ? ORDER BY c.code, s.code, m.day`, [TERM]);
    const map = {};
    for (const r of rows) {
        (map[r.id] ??= { id: r.id, code: r.code, capacity: r.capacity, course_id: r.course_id, course_code: r.course_code, title: r.title, units: r.units, meetings: [] })
            .meetings.push({ day: r.day, start: r.ts, end: r.te });
    }
    return Object.values(map);npm
});

app.get('/api/sections', auth, wrap(async (req, res) => {
    const secs = await catalog();
    const [taken] = await db.query('SELECT section_id, COUNT(*) n FROM enrollments GROUP BY section_id');
    const [done] = await db.query('SELECT course_id FROM completed_courses WHERE student_id = ?', [req.user.id]);
    const [pre] = await db.query('SELECT course_id, prereq_id FROM course_prereqs');
    const t = Object.fromEntries(taken.map(x => [x.section_id, x.n])), d = new Set(done.map(x => x.course_id));
    res.json(secs.map(s => ({ ...s, taken: t[s.id] || 0, missing: pre.some(p => p.course_id === s.course_id && !d.has(p.prereq_id)) })));
}));

app.post('/api/enroll', auth, wrap(async (req, res) => {
    const ids = [...new Set(req.body.section_ids || [])];
    if (!ids.length) return res.status(400).json({ error: 'Pick at least one section.' });
    const stg = await stageFor(req.user.id);
    if (stg < 4) return res.status(403).json({ error: 'Your documents must be approved before you can reserve sections.' });
    if (stg === 6) return res.status(409).json({ error: 'You are already officially enrolled. Ask the registrar to change sections.' });
    await db.query("DELETE FROM payments WHERE student_id = ? AND term = ? AND status = 'pending'", [req.user.id, TERM]);
    const all = await catalog(), chosen = ids.map(i => all.find(s => s.id === i));
    if (chosen.includes(undefined)) return res.status(400).json({ error: 'One of those sections does not exist.' });
    if (new Set(chosen.map(s => s.course_id)).size < chosen.length) return res.status(400).json({ error: 'You picked the same subject twice.' });
    const units = chosen.reduce((a, s) => a + s.units, 0);
    if (units > MAX_UNITS) return res.status(400).json({ error: `Unit limit is ${MAX_UNITS}. You picked ${units}.` });

    const ms = chosen.flatMap(s => s.meetings.map(m => ({ ...m, who: s.course_code })));
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i], b = ms[j];
        if (a.day === b.day && mins(a.start) < mins(b.end) && mins(b.start) < mins(a.end))
            return res.status(409).json({ error: `Schedule conflict between ${a.who} and ${b.who}.` });
    }
    const [bad] = await db.query(`SELECT DISTINCT c.code FROM course_prereqs p JOIN courses c ON c.id = p.course_id
                                  WHERE p.course_id IN (?) AND p.prereq_id NOT IN (SELECT course_id FROM completed_courses WHERE student_id = ?)`, [chosen.map(s => s.course_id), req.user.id]);
    if (bad.length) return res.status(400).json({ error: `Prerequisite not completed for ${bad.map(b => b.code).join(', ')}.` });

    const c = await db.getConnection();
    try {
        await c.beginTransaction();
        await c.query('INSERT INTO applications (student_id, term, stage) VALUES (?,?,4) ON DUPLICATE KEY UPDATE stage = GREATEST(stage, 4)', [req.user.id, TERM]);
        const [[a]] = await c.query('SELECT id FROM applications WHERE student_id = ? AND term = ?', [req.user.id, TERM]);
        await c.query('DELETE FROM enrollments WHERE application_id = ?', [a.id]);
        for (const s of chosen) {
            await c.query('SELECT id FROM sections WHERE id = ? FOR UPDATE', [s.id]);   // serialize seat checks per section
            const [[{ n }]] = await c.query('SELECT COUNT(*) n FROM enrollments WHERE section_id = ?', [s.id]);
            if (n >= s.capacity) { await c.rollback(); return res.status(409).json({ error: `${s.course_code} section ${s.code} just filled up.` }); }
            await c.query('INSERT INTO enrollments (application_id, section_id) VALUES (?,?)', [a.id, s.id]);
        }
        await c.commit(); res.json({ ok: true, units });
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}));

// 0.0.0.0 lets phones on the same Wi-Fi/hotspot open http://<your-PC-IP>:3000
const deps = { auth, wrap, cache, TERM, stageFor };
require('./routes/phase2')(app, db, deps)
    .then(() => require('./routes/phase3')(app, db, deps))
    .then(() => require('./routes/phase4')(app, db, deps))
    .then(() => app.listen(3000, '0.0.0.0', () => console.log('PTC Fast-Enroll running at http://localhost:3000')))
    .catch(e => { console.error('Startup failed:', e.message); process.exit(1); });