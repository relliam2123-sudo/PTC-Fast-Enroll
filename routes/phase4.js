// Phase 4: Certificate of Registration (PDF + QR code) and the public page the QR code opens.
const path = require('path'), PDFDocument = require('pdfkit'), QRCode = require('qrcode');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = { new: 'New student', continuing: 'Continuing student', transferee: 'Transferee', returnee: 'Returnee', irregular: 'Irregular student' };

module.exports = async function (app, db, { auth, wrap, TERM, stageFor }) {
    const q = (sql, p) => db.query(sql, p).then(r => r[0]);

    app.get('/api/cor', auth, wrap(async (req, res) => {
        if ((await stageFor(req.user.id)) !== 6) return res.status(403).json({ error: 'Your certificate is available once you are officially enrolled.' });
        const [s] = await q('SELECT u.full_name, u.email, p.name program, st.student_type FROM users u JOIN students st ON st.user_id = u.id JOIN programs p ON p.id = st.program_id WHERE u.id = ?', [req.user.id]);
        const subjects = await q(`SELECT c.code, c.title, sec.code section, c.units,
        GROUP_CONCAT(CONCAT(ELT(m.day,'Mon','Tue','Wed','Thu','Fri','Sat'),' ',TIME_FORMAT(m.start_time,'%H:%i'),'-',TIME_FORMAT(m.end_time,'%H:%i')) ORDER BY m.day SEPARATOR ', ') sched
      FROM applications a JOIN enrollments en ON en.application_id = a.id JOIN sections sec ON sec.id = en.section_id
      JOIN courses c ON c.id = sec.course_id JOIN meetings m ON m.section_id = sec.id WHERE a.student_id = ? AND a.term = ?
      GROUP BY sec.id, c.code, c.title, sec.code, c.units ORDER BY c.code`, [req.user.id, TERM]);
        const [pay] = await q("SELECT amount, method, reference, confirmed_at FROM payments WHERE student_id = ? AND term = ? AND status = 'paid'", [req.user.id, TERM]);
        const qr = await QRCode.toBuffer(`${req.protocol}://${req.headers.host}/verify/${encodeURIComponent(pay.reference)}`, { margin: 1, width: 240 });

        const doc = new PDFDocument({ size: 'A4', margin: 40 }), W = 595.28;
        res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="PTC-Certificate-of-Registration.pdf"');
        doc.pipe(res);
        doc.rect(0, 0, W, 92).fill('#08381b'); doc.rect(0, 92, W, 4).fill('#f4c20d');
        try { doc.image(path.join(__dirname, '..', 'public', 'logo.png'), 40, 14, { width: 64 }); } catch {}
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17).text('PATEROS TECHNOLOGICAL COLLEGE', 118, 26, { lineBreak: false });
        doc.font('Helvetica').fontSize(12).text(`Certificate of Registration  |  Term ${TERM}`, 118, 52, { lineBreak: false });
        [['Name', s.full_name], ['Program', s.program], ['Student type', TYPES[s.student_type]], ['Email', s.email]].forEach(([k, v], i) => {
            doc.font('Helvetica').fontSize(9).fillColor('#53695b').text(k, 40, 118 + i * 26, { lineBreak: false });
            doc.font('Helvetica-Bold').fontSize(12).fillColor('#10241a').text(String(v), 40, 130 + i * 26, { width: 380, lineBreak: false, ellipsis: true });
        });
        doc.image(qr, W - 136, 112, { width: 96 });
        doc.font('Helvetica').fontSize(8).fillColor('#53695b').text('Scan to verify', W - 136, 210, { width: 96, align: 'center', lineBreak: false });

        const cols = [[40, 58, 'Code'], [98, 170, 'Subject'], [268, 34, 'Sec'], [302, 36, 'Units'], [338, 217, 'Schedule']];
        let y = 244; doc.rect(40, y - 4, W - 80, 20).fill('#e3efe6');
        cols.forEach(([x, w, h]) => doc.font('Helvetica-Bold').fontSize(9).fillColor('#08381b').text(h, x + 4, y, { width: w - 6, lineBreak: false }));
        y += 24;
        subjects.forEach(r => {
            if (y > 730) { doc.addPage(); y = 50; }
            [r.code, r.title, r.section, r.units, r.sched].forEach((v, i) => doc.font('Helvetica').fontSize(9).fillColor('#10241a').text(String(v), cols[i][0] + 4, y, { width: cols[i][1] - 6, lineBreak: false, ellipsis: true }));
            doc.moveTo(40, y + 14).lineTo(W - 40, y + 14).lineWidth(0.5).strokeColor('#d9e5dc').stroke(); y += 20;
        });
        if (y > 650) { doc.addPage(); y = 50; }
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#08381b').text(`Total units: ${subjects.reduce((a, r) => a + r.units, 0)}`, 40, y + 6, { lineBreak: false });
        doc.fontSize(11).text('Payment', 40, y + 36, { lineBreak: false });
        doc.font('Helvetica').fontSize(10).fillColor('#10241a');
        [`Amount paid: PHP ${Number(pay.amount).toFixed(2)}`, `Method: ${pay.method}`, `Reference: ${pay.reference}`, `Paid on: ${new Date(pay.confirmed_at).toLocaleString('en-PH')}`]
            .forEach((t, i) => doc.text(t, 40, y + 56 + i * 15, { lineBreak: false }));
        doc.font('Helvetica').fontSize(8).fillColor('#53695b').text('System-generated certificate. Scan the QR code to check it against the registrar records.', 40, y + 140, { width: W - 80, align: 'center', lineBreak: false });
        doc.end();
    }));

    // Public page opened by the QR code: confirms the registration is real without exposing anything private.
    app.get('/verify/:ref', wrap(async (req, res) => {
        const [r] = await q(`SELECT u.full_name, p.code program, pay.term, pay.confirmed_at FROM payments pay JOIN users u ON u.id = pay.student_id
      JOIN students st ON st.user_id = u.id JOIN programs p ON p.id = st.program_id WHERE pay.reference = ? AND pay.status = 'paid'`, [req.params.ref]);
        res.status(r ? 200 : 404).type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify certificate</title>
<body style="font-family:Bahnschrift,'Segoe UI',sans-serif;background:#f4f7f2;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="background:#fff;border:1px solid #d9e5dc;border-top:6px solid ${r ? '#12733a' : '#b3261e'};border-radius:14px;padding:28px;max-width:420px;margin:16px">
${r ? `<h2 style="margin:0 0 8px;color:#12733a">Valid certificate</h2><p style="margin:0"><b>${esc(r.full_name)}</b><br>${esc(r.program)}, term ${esc(r.term)}<br>Paid on ${new Date(r.confirmed_at).toLocaleDateString('en-PH')}</p>`
            : '<h2 style="margin:0;color:#b3261e">Not found</h2><p>No paid registration matches this code.</p>'}
<p style="color:#53695b;font-size:.85rem;margin-bottom:0">Pateros Technological College, PTC Fast-Enroll</p></div></body></html>`);
    }));
};