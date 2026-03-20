const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { auth, teacherOnly, studentOnly } = require('../middleware/auth');
const { randomUUID } = require('crypto');

const EMOJI = {'Математика':'📐','Физика':'⚡','Химия':'⚗️','Биология':'🌿','Английский язык':'🇬🇧','Русский язык':'📝','Таджикский язык':'🇹🇯','IT / Программирование':'💻','Дизайн':'🎨','Бизнес / Маркетинг':'📊','Другое':'📖'};
const safeJson = (v, d=[]) => { if (!v) return d; try { return JSON.parse(v); } catch { return d; } };

// ─── GET /api/courses ──────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { search, category } = req.query;
        let sql = `
            SELECT c.id, c.title, c.description, c.category, c.level, c.price, c.emoji,
                   c.rating, c.review_count, c.student_count, c.created_at,
                   u.id AS teacher_user_id, u.first_name, u.last_name, u.initials, u.color
            FROM courses c
            JOIN teacher_profiles tp ON tp.id = c.teacher_id
            JOIN users u ON u.id = tp.user_id
            WHERE c.status = 'active'`;
        const params = [];
        if (search)    { sql += ' AND c.title LIKE ?';    params.push(`%${search}%`); }
        if (category)  { sql += ' AND c.category = ?';    params.push(category); }
        sql += ' ORDER BY c.created_at DESC';
        const [rows] = await db.query(sql, params);
        res.json(rows.map(c => ({
            id:c.id, title:c.title, description:c.description, category:c.category, level:c.level,
            price:parseFloat(c.price), emoji:c.emoji, rating:parseFloat(c.rating)||0,
            reviewCount:c.review_count, studentCount:c.student_count,
            teacher:{ id:c.teacher_user_id, firstName:c.first_name, lastName:c.last_name, initials:c.initials, color:c.color },
        })));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/courses/my/list (только для преподавателя) ───────────
router.get('/my/list', auth, teacherOnly, async (req, res) => {
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id = ?', [req.user.id]);
        if (!tp.length) return res.status(404).json({ error: 'Профиль не найден' });
        const [rows] = await db.query(
            `SELECT c.*, GROUP_CONCAT(cl.title ORDER BY cl.order_num SEPARATOR '|||') AS lesson_titles
             FROM courses c
             LEFT JOIN course_lessons cl ON cl.course_id = c.id
             WHERE c.teacher_id = ?
             GROUP BY c.id ORDER BY c.created_at DESC`, [tp[0].id]
        );
        res.json(rows.map(c => ({ ...c, lessons: c.lesson_titles ? c.lesson_titles.split('|||') : [] })));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/courses/:id ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT c.*, tp.id AS teacher_profile_id, u.id AS teacher_user_id,
                    u.first_name, u.last_name, u.initials, u.color
             FROM courses c
             JOIN teacher_profiles tp ON tp.id = c.teacher_id
             JOIN users u ON u.id = tp.user_id
             WHERE c.id = ?`, [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Курс не найден' });
        const c = rows[0];
        const [lessons] = await db.query(
            'SELECT id, title, order_num FROM course_lessons WHERE course_id = ? ORDER BY order_num', [c.id]
        );
        res.json({ ...c, price: parseFloat(c.price), rating: parseFloat(c.rating)||0, lessons });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/courses ─────────────────────────────────────────────
router.post('/', auth, teacherOnly, [
    body('title').trim().notEmpty(),
    body('category').notEmpty(),
    body('price').isFloat({ min: 1 }),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { title, description, category, level, price, lessons = [] } = req.body;
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id = ?', [req.user.id]);
        if (!tp.length) return res.status(404).json({ error: 'Профиль преподавателя не найден' });

        const courseId = randomUUID();
        const emoji = EMOJI[category] || '📖';

        await db.transaction(async (conn) => {
            await conn.execute(
                `INSERT INTO courses (id, teacher_id, title, description, category, level, price, emoji, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'moderation')`,
                [courseId, tp[0].id, title, description, category, level||'Начинающий', price, emoji]
            );
            for (let i = 0; i < lessons.length; i++) {
                await conn.execute(
                    'INSERT INTO course_lessons (id, course_id, title, order_num) VALUES (?, ?, ?, ?)',
                    [randomUUID(), courseId, lessons[i], i + 1]
                );
            }
            // Уведомление admin
            const [admins] = await conn.execute("SELECT id FROM users WHERE role='admin' LIMIT 1");
            if (admins.length) {
                await conn.execute(
                    'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)',
                    [randomUUID(), admins[0].id, 'new_course', 'Новый курс на модерации', `"${title}" от ${req.user.first_name} ${req.user.last_name}`]
                );
            }
        });

        res.status(201).json({ message: 'Курс отправлен на проверку', courseId });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── PUT /api/courses/:id ──────────────────────────────────────────
router.put('/:id', auth, teacherOnly, async (req, res) => {
    const { title, description, category, level, price } = req.body;
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id = ?', [req.user.id]);
        const [r] = await db.query(
            `UPDATE courses SET title=COALESCE(?,title), description=COALESCE(?,description),
                category=COALESCE(?,category), level=COALESCE(?,level), price=COALESCE(?,price), status='moderation'
             WHERE id=? AND teacher_id=?`,
            [title, description, category, level, price, req.params.id, tp[0].id]
        );
        if (!r.affectedRows) return res.status(404).json({ error: 'Курс не найден' });
        res.json({ message: 'Обновлено, отправлено на повторную проверку' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/courses/:id/review ─────────────────────────────────
router.post('/:id/review', auth, studentOnly, [
    body('stars').isInt({ min:1, max:5 }),
], async (req, res) => {
    const { stars, text, tags } = req.body;
    try {
        const [enroll] = await db.query(
            'SELECT id, teacher_id FROM enrollments WHERE student_id=? AND course_id=?',
            [req.user.id, req.params.id]
        );
        if (!enroll.length) return res.status(403).json({ error: 'Вы не записаны на этот курс' });

        await db.transaction(async (conn) => {
            await conn.execute(
                `INSERT INTO reviews (id, student_id, teacher_id, course_id, stars, text, tags)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE stars=VALUES(stars), text=VALUES(text), tags=VALUES(tags)`,
                [randomUUID(), req.user.id, enroll[0].teacher_id, req.params.id, stars, text||null, tags ? JSON.stringify(tags) : null]
            );
            // Пересчёт рейтинга преподавателя
            await conn.execute(
                `UPDATE teacher_profiles SET
                    rating = (SELECT AVG(stars) FROM reviews WHERE teacher_id = ?),
                    review_count = (SELECT COUNT(*) FROM reviews WHERE teacher_id = ?)
                 WHERE id = ?`,
                [enroll[0].teacher_id, enroll[0].teacher_id, enroll[0].teacher_id]
            );
            // Пересчёт рейтинга курса
            await conn.execute(
                `UPDATE courses SET
                    rating = (SELECT AVG(stars) FROM reviews WHERE course_id = ?),
                    review_count = (SELECT COUNT(*) FROM reviews WHERE course_id = ?)
                 WHERE id = ?`,
                [req.params.id, req.params.id, req.params.id]
            );
        });
        res.status(201).json({ message: 'Отзыв добавлен' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
