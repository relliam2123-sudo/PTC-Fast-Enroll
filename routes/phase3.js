// Phase 3: section management, fees + payments + cashier, admin tools (delete accounts, reset data).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DIR = path.join(__dirname, '..', 'uploads');
const can = (...roles) => (req, res, next) => [...roles, 'super_admin'].includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have access to that.' });

module.exports = async function (app, db, { auth, wrap, cache, TERM, stageFor }) {
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'database', 'phase3.sql'), 'utf8'));
    const q = (sql, p) => db.query(sql, p).then(r => r[0]);
    const log = (uid, action, detail) => db.query('INSERT INTO audit_log (user_id, action, detail) VALUES (?,?,?)', [uid, action, String(detail).slice(0, 200)]);
    const peso = n => 'PHP ' + Number(n).toFixed(2);
    const SEC = can('registrar', 'program_head');

    // ---- Sections: seats filled by student type, add sections, change capacity ----
    app.get('/api/staff/sections', auth, SEC, wrap(async (_, res) => {
        const sections = await q('SELECT s.id, s.code, s.capacity, c.code course, c.title FROM sections s JOIN courses c ON c.id = s.course_id WHERE s.term = ? ORDER BY c.code, s.code', [TERM]);
        const mix = await q(`SELECT en.section_id, st.student_type type, COUNT(*) n FROM enrollments en JOIN applications a ON a.id = en.application_id
      JOIN students st ON st.user_id = a.student_id GROUP BY en.section_id, st.student_type`);
        const mt = await q("SELECT section_id, day, TIME_FORMAT(start_time,'%H:%i') ts, TIME_FORMAT(end_time,'%H:%i') te FROM meetings ORDER BY section_id, day");
        res.json({
            courses: await q('SELECT id, code, title FROM courses ORDER BY code'),
            sections: sections.map(s => { const m = mix.filter(x => x.section_id === s.id);
                return { ...s, taken: m.reduce((a, x) => a + x.n, 0), mix: m.map(x => ({ type: x.type, n: x.n })), meetings: mt.filter(x => x.section_id === s.id) }; })
        });
    }));

    app.post('/api/staff/sections', auth, SEC, wrap(async (req, res) => {
        const { course_id, days, start, end, room } = req.body, cap = +req.body.capacity;
        const ds = [...new Set((days || []).map(Number))].filter(d => d >= 1 && d <= 6);
        if (!(cap >= 1 && cap <= 200) || !ds.length || !/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end) || end <= start)
            return res.status(400).json({ error: 'Check the seats, days and times (end must be after start).' });
        const [c] = await q('SELECT code FROM courses WHERE id = ?', [course_id]);
        if (!c) return res.status(400).json({ error: 'Pick a subject.' });
        const [last] = await q('SELECT code FROM sections WHERE course_id = ? AND term = ? ORDER BY code DESC LIMIT 1', [course_id, TERM]);
        const code = last ? String.fromCharCode(last.code.charCodeAt(0) + 1) : 'A';
        if (code > 'Z') return res.status(400).json({ error: 'That subject has too many sections.' });
        await db.query('INSERT INTO sections (id, course_id, code, capacity, term) SELECT COALESCE(MAX(id), 0) + 1, ?, ?, ?, ? FROM sections', [course_id, code, cap, TERM]);
        const [s] = await q('SELECT id FROM sections WHERE course_id = ? AND code = ? AND term = ?', [course_id, code, TERM]);
        await db.query('INSERT INTO meetings (section_id, day, start_time, end_time, room) VALUES ?', [ds.map(d => [s.id, d, start, end, (room || '').slice(0, 20)])]);
        cache.clear(); await log(req.user.id, 'added section', `${c.code} section ${code}, ${cap} seats`);
        res.json({ code });
    }));

    app.patch('/api/staff/sections/:id', auth, SEC, wrap(async (req, res) => {
        const cap = +req.body.capacity;
        const [s] = await q('SELECT c.code course, s.code FROM sections s JOIN courses c ON c.id = s.course_id WHERE s.id = ?', [req.params.id]);
        if (!s) return res.status(404).json({ error: 'Section not found.' });
        if (!(cap >= 1 && cap <= 200)) return res.status(400).json({ error: 'Seats must be between 1 and 200.' });
        const [t] = await q('SELECT COUNT(*) n FROM enrollments WHERE section_id = ?', [req.params.id]);
        if (cap < t.n) return res.status(409).json({ error: `${t.n} students are already in this section.` });
        await db.query('UPDATE sections SET capacity = ? WHERE id = ?', [cap, req.params.id]);
        cache.clear(); await log(req.user.id, 'set capacity', `${s.course} section ${s.code} to ${cap} seats`);
        res.json({ ok: true });
    }));

    app.get('/api/staff/sections/:id/students', auth, SEC, wrap(async (req, res) => res.json(await q(`SELECT u.full_name, st.student_type type, p.code program
    FROM enrollments en JOIN applications a ON a.id = en.application_id JOIN users u ON u.id = a.student_id
    JOIN students st ON st.user_id = u.id JOIN programs p ON p.id = st.program_id WHERE en.section_id = ? ORDER BY u.full_name`, [req.params.id]))));

    // ---- Student fees and payment ----
    async function bill(id) {
        const [{ u }] = await q(`SELECT COALESCE(SUM(c.units), 0) u FROM applications a JOIN enrollments en ON en.application_id = a.id
      JOIN sections s ON s.id = en.section_id JOIN courses c ON c.id = s.course_id WHERE a.student_id = ? AND a.term = ?`, [id, TERM]);
        const lines = (await q('SELECT label, amount, per_unit FROM fees')).map(f => ({ label: f.label, qty: f.per_unit ? +u : 1, amount: +f.amount * (f.per_unit ? +u : 1) }));
        return { units: +u, lines, total: lines.reduce((a, l) => a + l.amount, 0) };
    }
    app.get('/api/payment', auth, wrap(async (req, res) => {
        const [p] = await q('SELECT amount, method, status, reference, created_at FROM payments WHERE student_id = ? AND term = ?', [req.user.id, TERM]);
        res.json({ bill: await bill(req.user.id), payment: p || null });
    }));
    // GCash/Maya here are SIMULATED checkouts (no real money). Cashier payments stay pending until staff confirm them.
    app.post('/api/payment', auth, wrap(async (req, res) => {
        if ((await stageFor(req.user.id)) !== 5) return res.status(403).json({ error: 'Reserve your sections first. If you already paid, you are enrolled.' });
        const { method, mobile } = req.body;
        if (!['gcash', 'maya', 'cashier'].includes(method)) return res.status(400).json({ error: 'Choose a payment method.' });
        if (method !== 'cashier' && !/^09\d{9}$/.test(mobile || '')) return res.status(400).json({ error: 'Enter an 11-digit mobile number starting with 09.' });
        const b = await bill(req.user.id), paid = method !== 'cashier';
        const ref = { gcash: 'GC-', maya: 'MY-', cashier: 'PTC-' }[method] + crypto.randomBytes(4).toString('hex').toUpperCase();
        await db.query("DELETE FROM payments WHERE student_id = ? AND term = ? AND status = 'pending'", [req.user.id, TERM]);
        await db.query('INSERT INTO payments (student_id, term, amount, method, status, reference, confirmed_at) VALUES (?,?,?,?,?,?,?)',
            [req.user.id, TERM, b.total, method, paid ? 'paid' : 'pending', ref, paid ? new Date() : null]);
        res.json({ reference: ref, paid });
    }));

    // ---- Cashier ----
    app.get('/api/staff/payments', auth, can('cashier'), wrap(async (_, res) => {
        const base = `SELECT p.id, p.reference, p.amount, p.method, p.created_at, u.full_name, pr.code program FROM payments p
      JOIN users u ON u.id = p.student_id JOIN students st ON st.user_id = p.student_id JOIN programs pr ON pr.id = st.program_id`;
        const [t] = await q("SELECT COALESCE(SUM(amount), 0) total, COUNT(*) n FROM payments WHERE status = 'paid'");
        res.json({ collected: +t.total, paid: t.n,
            pending: await q(base + " WHERE p.status = 'pending' ORDER BY p.created_at"),
            recent: await q(base + " WHERE p.status = 'paid' ORDER BY p.confirmed_at DESC LIMIT 10") });
    }));
    app.post('/api/staff/payments/:id/confirm', auth, can('cashier'), wrap(async (req, res) => {
        const [p] = await q("SELECT p.amount, p.reference, u.full_name FROM payments p JOIN users u ON u.id = p.student_id WHERE p.id = ? AND p.status = 'pending' AND p.method = 'cashier'", [req.params.id]);
        if (!p) return res.status(409).json({ error: 'That payment is not waiting for the cashier.' });
        await db.query("UPDATE payments SET status = 'paid', confirmed_by = ?, confirmed_at = NOW() WHERE id = ?", [req.user.id, req.params.id]);
        await log(req.user.id, 'confirmed payment', `${peso(p.amount)} from ${p.full_name} (${p.reference})`);
        res.json({ ok: true });
    }));

    // ---- Admin tools: delete accounts, reset data ----
    const ADM = can('program_head');
    async function wipe(ids, removeAccounts) {
        if (!ids.length) return;
        const c = await db.getConnection();
        try {
            await c.beginTransaction();
            const [files] = await c.query('SELECT stored_name FROM documents WHERE student_id IN (?)', [ids]);
            await c.query('DELETE FROM payments WHERE student_id IN (?)', [ids]);
            await c.query('DELETE en FROM enrollments en JOIN applications a ON a.id = en.application_id WHERE a.student_id IN (?)', [ids]);
            await c.query('DELETE FROM applications WHERE student_id IN (?)', [ids]);
            await c.query('DELETE FROM documents WHERE student_id IN (?)', [ids]);
            if (removeAccounts) {
                await c.query('DELETE FROM completed_courses WHERE student_id IN (?)', [ids]);
                await c.query('DELETE FROM students WHERE user_id IN (?)', [ids]);
                await c.query('DELETE FROM users WHERE id IN (?)', [ids]);
            }
            await c.commit(); cache.clear();
            files.forEach(f => fs.unlink(path.join(DIR, f.stored_name), () => {}));
        } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
    }
    const student = async id => (await q('SELECT u.id, u.full_name FROM users u JOIN students st ON st.user_id = u.id WHERE u.id = ?', [id]))[0];

    app.get('/api/staff/users', auth, ADM, wrap(async (req, res) => { const like = `%${req.query.q || ''}%`;
        res.json(await q(`SELECT u.id, u.full_name, u.email, p.code program, st.student_type type FROM users u JOIN students st ON st.user_id = u.id
      JOIN programs p ON p.id = st.program_id WHERE u.full_name LIKE ? OR u.email LIKE ? ORDER BY u.id DESC LIMIT 30`, [like, like])); }));
    app.delete('/api/staff/users/:id', auth, ADM, wrap(async (req, res) => {
        const s = await student(req.params.id); if (!s) return res.status(404).json({ error: 'Student account not found.' });
        await wipe([s.id], true); await log(req.user.id, 'deleted account', s.full_name); res.json({ ok: true });
    }));
    app.post('/api/staff/users/:id/reset', auth, ADM, wrap(async (req, res) => {
        const s = await student(req.params.id); if (!s) return res.status(404).json({ error: 'Student account not found.' });
        await wipe([s.id], false); await log(req.user.id, 'reset student', s.full_name); res.json({ ok: true });
    }));
    app.post('/api/staff/reset', auth, ADM, wrap(async (req, res) => {
        const { scope, confirm } = req.body;
        if (confirm !== 'RESET' || !['enrollments', 'all'].includes(scope)) return res.status(400).json({ error: 'Type RESET to confirm.' });
        const ids = (await q('SELECT user_id FROM students')).map(r => r.user_id);
        await wipe(ids, scope === 'all');
        await log(req.user.id, 'reset data', scope === 'all' ? 'deleted every student account' : 'cleared all enrollments, documents and payments');
        res.json({ students: ids.length });
    }));
};