// Phase 2: document uploads (streamed, with progress), registrar review queue, audit log, dashboard stats.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), bcrypt = require('bcryptjs');
const DIR = path.join(__dirname, '..', 'uploads'), MAX = 5 * 1024 * 1024, OK = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const staffOnly = (req, res, next) => ['registrar', 'super_admin'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Registrar access only.' });

module.exports = async function (app, db, { auth, wrap }) {
    fs.mkdirSync(DIR, { recursive: true });
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'database', 'phase2.sql'), 'utf8'));
    const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM users WHERE role <> 'student'");
    if (!n) {   // demo staff logins, password: ptc12345
        const h = await bcrypt.hash('ptc12345', 10);
        await db.query(`INSERT INTO users (full_name, email, password_hash, role) VALUES
      ('Registrar Demo','registrar@ptc.edu',?,'registrar'),('Cashier Demo','cashier@ptc.edu',?,'cashier'),
      ('Program Head Demo','head@ptc.edu',?,'program_head'),('Admin Demo','admin@ptc.edu',?,'super_admin')`, [h, h, h, h]);
    }
    const q = (sql, p) => db.query(sql, p).then(r => r[0]);

    app.get('/api/documents', auth, wrap(async (req, res) => {
        const types = await q('SELECT code, label FROM document_types');
        const mine = await q('SELECT type_code, original_name, status, remarks FROM documents WHERE student_id = ?', [req.user.id]);
        res.json(types.map(t => ({ ...t, ...(mine.find(d => d.type_code === t.code) || {}) })));
    }));

    // The browser sends the raw file; we stream it to disk so memory stays flat even with many uploads at once.
    app.put('/api/documents/:code', auth, wrap(async (req, res) => {
        const ext = OK[req.headers['content-type']], size = +req.headers['content-length'];
        const [t] = await q('SELECT code FROM document_types WHERE code = ?', [req.params.code]);
        if (!t || !ext) return res.status(400).json({ error: 'Upload a PDF, JPG or PNG file.' });
        if (!size || size > MAX) return res.status(413).json({ error: 'File must be 5 MB or smaller.' });
        const [old] = await q('SELECT status, stored_name FROM documents WHERE student_id = ? AND type_code = ?', [req.user.id, t.code]);
        if (old && old.status === 'approved') return res.status(409).json({ error: 'This document is already approved.' });
        const name = crypto.randomBytes(12).toString('hex') + ext, out = fs.createWriteStream(path.join(DIR, name));
        let got = 0;
        req.on('data', c => { if ((got += c.length) > MAX) { req.destroy(); out.destroy(); } });
        req.pipe(out);
        out.on('error', () => res.status(500).json({ error: 'Upload failed.' }));
        out.on('finish', async () => {
            try {
                const orig = decodeURIComponent(req.headers['x-filename'] || 'document').slice(0, 150);
                await db.query(`INSERT INTO documents (student_id, type_code, original_name, stored_name) VALUES (?,?,?,?)
          ON DUPLICATE KEY UPDATE original_name = VALUES(original_name), stored_name = VALUES(stored_name),
          status = 'pending', remarks = NULL, reviewed_by = NULL, reviewed_at = NULL`, [req.user.id, t.code, orig, name]);
                if (old) fs.unlink(path.join(DIR, old.stored_name), () => {});
                res.json({ ok: true });
            } catch (e) { console.error(e); res.status(500).json({ error: 'Upload failed.' }); }
        });
    }));

    app.get('/api/staff/overview', auth, staffOnly, wrap(async (_, res) => res.json({
        students: (await q('SELECT COUNT(*) n FROM students'))[0].n,
        docs: await q('SELECT status, COUNT(*) n FROM documents GROUP BY status'),
        seats: await q(`SELECT c.code course, s.code section, s.capacity, COUNT(en.section_id) taken FROM sections s
      JOIN courses c ON c.id = s.course_id LEFT JOIN enrollments en ON en.section_id = s.id
      GROUP BY s.id, c.code, s.code, s.capacity ORDER BY c.code, s.code`),
        audit: await q('SELECT a.action, a.detail, a.created_at, u.full_name FROM audit_log a JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 8')
    })));

    app.get('/api/staff/documents', auth, staffOnly, wrap(async (_, res) => res.json(await q(`SELECT d.id, d.original_name, d.uploaded_at, dt.label, u.full_name, p.code program
    FROM documents d JOIN document_types dt ON dt.code = d.type_code JOIN users u ON u.id = d.student_id
    JOIN students st ON st.user_id = d.student_id JOIN programs p ON p.id = st.program_id
    WHERE d.status = 'pending' ORDER BY d.uploaded_at LIMIT 200`))));

    app.get('/api/staff/documents/:id/file', auth, staffOnly, wrap(async (req, res) => {
        const [d] = await q('SELECT stored_name FROM documents WHERE id = ?', [req.params.id]);
        d ? res.sendFile(path.join(DIR, d.stored_name)) : res.status(404).json({ error: 'File not found.' });
    }));

    // One endpoint for single and batch decisions; every decision is written to the audit log.
    app.post('/api/staff/review', auth, staffOnly, wrap(async (req, res) => {
        const { ids, decision, remarks } = req.body, why = (remarks || '').trim().slice(0, 150);
        if (!Array.isArray(ids) || !ids.length || !['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Select documents and a decision.' });
        if (decision === 'rejected' && !why) return res.status(400).json({ error: 'Add a reason so the student knows what to fix.' });
        const rows = await q(`SELECT d.id, dt.label, u.full_name FROM documents d JOIN document_types dt ON dt.code = d.type_code
      JOIN users u ON u.id = d.student_id WHERE d.id IN (?) AND d.status = 'pending'`, [ids]);
        if (!rows.length) return res.status(409).json({ error: 'Those documents were already reviewed.' });
        await db.query("UPDATE documents SET status = ?, remarks = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id IN (?) AND status = 'pending'",
            [decision, decision === 'rejected' ? why : null, req.user.id, rows.map(r => r.id)]);
        await db.query('INSERT INTO audit_log (user_id, action, document_id, detail) VALUES ?',
            [rows.map(r => [req.user.id, decision, r.id, `${r.label} of ${r.full_name}`.slice(0, 200)])]);
        res.json({ updated: rows.length });
    }));
};