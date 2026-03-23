const express = require('express');
const router = express.Router();
const db      = require('../db');
const { auth, teacherOnly } = require('../middleware/auth');
const { randomUUID } = require('crypto');
const { uploadPhoto, uploadDoc } = require('../cloudinary');

const safeJson = (v, d=[]) => { if (!v) return d; try { return JSON.parse(v); } catch { return d; } };

// ─── GET /api/teachers ─────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { search, sort = 'new' } = req.query;
        let sql = `
            SELECT u.id, u.first_name, u.last_name, u.initials, u.color, u.avatar_url, u.created_at,
                   tp.id AS profile_id, tp.subject, tp.bio, tp.tags, tp.price,
                   tp.platforms, tp.work_days, tp.work_hours, tp.is_moderated,
                   tp.rating, tp.review_count, tp.student_count, tp.video_url, tp.conditions
            FROM users u
            JOIN teacher_profiles tp ON tp.user_id = u.id
            WHERE u.role = 'teacher' AND u.is_active = 1 AND tp.is_moderated = 1`;
        const params = [];
        if (search) {
            sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR tp.subject LIKE ? OR tp.bio LIKE ?)';
            const q = `%${search}%`;
            params.push(q, q, q, q);
        }
        const sortMap = { new:'u.created_at DESC', rating:'tp.rating DESC', 'price-asc':'tp.price ASC', 'price-desc':'tp.price DESC', reviews:'tp.review_count DESC' };
        sql += ` ORDER BY ${sortMap[sort] || 'u.created_at DESC'}`;
        const [rows] = await db.query(sql, params);
        res.json(rows.map(fmt));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/teachers/:id ─────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.id, u.first_name, u.last_name, u.initials, u.color, u.avatar_url, u.created_at,
                    tp.id AS profile_id, tp.subject, tp.bio, tp.tags, tp.price,
                    tp.platforms, tp.work_days, tp.work_hours, tp.is_moderated,
                    tp.rating, tp.review_count, tp.student_count, tp.teacher_type, tp.video_url, tp.conditions
             FROM users u JOIN teacher_profiles tp ON tp.user_id = u.id
             WHERE u.id = ? AND u.is_active = 1`, [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
        const t = rows[0];

        const [courses] = await db.query(
            `SELECT id, title, description, category, level, price, emoji, rating, review_count, student_count, status
             FROM courses WHERE teacher_id = ? AND status IN ('active','moderation') ORDER BY created_at DESC`,
            [t.profile_id]
        );
        const [docs] = await db.query(
            `SELECT id, doc_type, doc_name, institution, year, file_url, is_verified
             FROM teacher_documents WHERE teacher_id = ?`, [t.profile_id]
        );
        const [reviews] = await db.query(
            `SELECT r.id, r.stars, r.text, r.tags, r.created_at,
                    u.first_name, u.last_name, u.initials, u.color, c.title AS course_title
             FROM reviews r
             JOIN users u ON u.id = r.student_id
             JOIN courses c ON c.id = r.course_id
             WHERE r.teacher_id = ? ORDER BY r.created_at DESC`, [t.profile_id]
        );

        res.json({
            ...fmt(t),
            courses: courses.map(c => ({ ...c, rating: parseFloat(c.rating)||0 })),
            documents: docs.map(d => ({ id:d.id, type:d.doc_type, name:d.doc_name, institution:d.institution, year:d.year, fileUrl:d.file_url, isVerified:!!d.is_verified })),
            reviews: reviews.map(r => ({
                id:r.id, stars:r.stars, text:r.text, tags:safeJson(r.tags,[]),
                date:r.created_at, courseTitle:r.course_title,
                student:{ name:`${r.first_name} ${r.last_name}`, initials:r.initials, color:r.color },
            })),
        });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── PUT /api/teachers/profile/update ─────────────────────────────
router.put('/profile/update', auth, teacherOnly, async (req, res) => {
    const { subject, bio, tags, price, platforms, workDays, workHours, teacherType, firstName, lastName, conditions } = req.body;
    try {
        await db.query(
            `UPDATE teacher_profiles SET
                subject    = COALESCE(?, subject),
                bio        = COALESCE(?, bio),
                tags       = COALESCE(?, tags),
                price      = COALESCE(?, price),
                platforms  = COALESCE(?, platforms),
                work_days  = COALESCE(?, work_days),
                work_hours = COALESCE(?, work_hours),
                teacher_type = COALESCE(?, teacher_type),
                conditions = COALESCE(?, conditions)
             WHERE user_id = ?`,
            [subject || null, bio || null,
             tags ? JSON.stringify(tags) : null,
             price || null,
             platforms ? JSON.stringify(platforms) : null,
             workDays ? JSON.stringify(workDays) : null,
             workHours || null,
             ['pro','specialist'].includes(teacherType) ? teacherType : null,
             conditions ? JSON.stringify(conditions) : null,
             req.user.id]
        );
        if (firstName || lastName) {
            await db.query(
                'UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name) WHERE id = ?',
                [firstName, lastName, req.user.id]
            );
        }
        res.json({ message: 'Профиль обновлён' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/teachers/profile/photo ─────────────────────────────
router.post('/profile/photo', auth, teacherOnly, uploadPhoto.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const url = req.file.path || req.file.secure_url;
    await db.query('UPDATE users SET avatar_url = ? WHERE id = ?', [url, req.user.id]);
    res.json({ avatarUrl: url });
});

// ─── POST /api/teachers/profile/video ──────────────────────────
// Use multer memoryStorage then upload to cloudinary directly
const multer = require('multer');
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const { cloudinary } = require('../cloudinary');

router.post('/profile/video', auth, teacherOnly, memUpload.single('video'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Видео не загружено' });
    try {
        // Upload buffer to cloudinary
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: 'eduspace/videos', resource_type: 'video', format: 'mp4' },
                (err, result) => err ? reject(err) : resolve(result)
            );
            stream.end(req.file.buffer);
        });
        const videoUrl = result.secure_url;
        await db.query('UPDATE teacher_profiles SET video_url = ? WHERE user_id = ?', [videoUrl, req.user.id]);
        res.json({ message: 'Видео загружено', videoUrl });
    } catch (err) { console.error('Video upload error:', err); res.status(500).json({ error: 'Ошибка загрузки видео: ' + err.message }); }
});

// ─── POST /api/teachers/profile/documents ─────────────────────────
router.post('/profile/documents', auth, teacherOnly, uploadDoc.single('document'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const { docType, docName, institution, year } = req.body;
    if (!docType || !docName) return res.status(400).json({ error: 'Тип и название обязательны' });
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id = ?', [req.user.id]);
        if (!tp.length) return res.status(404).json({ error: 'Профиль не найден' });
        const fileUrl = req.file.path || req.file.secure_url;
        await db.query(
            'INSERT INTO teacher_documents (id, teacher_id, doc_type, doc_name, institution, year, file_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [randomUUID(), tp[0].id, docType, docName, institution || null, year || null, fileUrl]
        );
        // Уведомление admin
        const [admins] = await db.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
        if (admins.length) {
            await db.query(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)',
                [randomUUID(), admins[0].id, 'doc_upload', 'Новый документ', `${req.user.first_name} загрузил документ: ${docName}`]
            );
        }
        res.status(201).json({ message: 'Документ загружен' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/teachers/my/stats ────────────────────────────────────
router.get('/my/stats', auth, teacherOnly, async (req, res) => {
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id = ?', [req.user.id]);
        if (!tp.length) return res.status(404).json({ error: 'Нет профиля' });
        const tpId = tp[0].id;
        const [e] = await db.query(
            `SELECT COUNT(*) AS cnt, COALESCE(SUM(price_paid),0) AS gross,
                    COALESCE(SUM(commission_amount),0) AS commission, COALESCE(SUM(teacher_amount),0) AS net
             FROM enrollments WHERE teacher_id = ? AND status != 'refunded'`, [tpId]
        );
        const [c] = await db.query(
            "SELECT COUNT(*) AS cnt FROM courses WHERE teacher_id = ? AND status != 'archived'", [tpId]
        );
        const r = e[0];
        res.json({
            totalStudents: r.cnt, totalCourses: c[0].cnt,
            grossRevenue: parseFloat(r.gross), commission: parseFloat(r.commission), netRevenue: parseFloat(r.net),
        });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/teachers/my/students ────────────────────────────────
router.get('/my/students', auth, teacherOnly, async (req, res) => {
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id = ?', [req.user.id]);
        if (!tp.length) return res.status(404).json({ error: 'Нет профиля' });
        const [rows] = await db.query(
            `SELECT u.id, u.first_name, u.last_name, u.initials, u.color,
                    c.title AS course_title, e.enrolled_at, e.price_paid, e.teacher_amount, e.status
             FROM enrollments e
             JOIN users u ON u.id = e.student_id
             JOIN courses c ON c.id = e.course_id
             WHERE e.teacher_id = ? ORDER BY e.enrolled_at DESC`, [tp[0].id]
        );
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

function fmt(t) {
    return {
        id: t.id, profileId: t.profile_id,
        firstName: t.first_name, lastName: t.last_name,
        fullName: `${t.first_name} ${t.last_name}`,
        initials: t.initials, color: t.color, avatarUrl: t.avatar_url,
        subject: t.subject, bio: t.bio,
        tags: safeJson(t.tags, []), platforms: safeJson(t.platforms, []), workDays: safeJson(t.work_days, []),
        workHours: t.work_hours, price: parseFloat(t.price)||0, videoUrl: t.video_url||null,
        conditions: safeJson(t.conditions, {trial:false,guarantee:false,homework:false,certificate:false}),
        isModerated: !!t.is_moderated, rating: parseFloat(t.rating)||0,
        reviewCount: t.review_count, studentCount: t.student_count, createdAt: t.created_at,
    };
}

module.exports = router;
