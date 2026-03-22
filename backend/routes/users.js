const express = require('express');
const router  = express.Router();
const db = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { randomUUID } = require('crypto');

// ─── GET /api/users/favorites ─────────────────────────────────────
router.get('/favorites', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.id, u.first_name, u.last_name, u.initials, u.color,
                    tp.subject, tp.rating, tp.review_count, tp.price
             FROM favorites f
             JOIN teacher_profiles tp ON tp.id = f.teacher_id
             JOIN users u ON u.id = tp.user_id
             WHERE f.student_id = ? ORDER BY f.created_at DESC`, [req.user.id]
        );
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/users/favorites/:teacherUserId ─────────────────────
router.post('/favorites/:teacherUserId', auth, async (req, res) => {
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id=?', [req.params.teacherUserId]);
        if (!tp.length) return res.status(404).json({ error: 'Преподаватель не найден' });
        const tpId = tp[0].id;
        const [existing] = await db.query('SELECT id FROM favorites WHERE student_id=? AND teacher_id=?', [req.user.id, tpId]);
        if (existing.length) {
            await db.query('DELETE FROM favorites WHERE student_id=? AND teacher_id=?', [req.user.id, tpId]);
            return res.json({ saved: false, message: 'Удалено из избранного' });
        }
        await db.query('INSERT INTO favorites (id, student_id, teacher_id) VALUES (?,?,?)', [randomUUID(), req.user.id, tpId]);
        res.json({ saved: true, message: 'Добавлено в избранное' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/users/notifications ────────────────────────────────
router.get('/notifications', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30', [req.user.id]
        );
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── PUT /api/users/notifications/read ───────────────────────────
router.put('/notifications/read', auth, async (req, res) => {
    try {
        await db.query('UPDATE notifications SET is_read=1 WHERE user_id=?', [req.user.id]);
        res.json({ message: 'Прочитано' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── PUT /api/users/profile ────────────────────────────────────────
router.put('/profile', auth, async (req, res) => {
    const { firstName, lastName, phone } = req.body;
    try {
        await db.query(
            'UPDATE users SET first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name), phone=COALESCE(?,phone) WHERE id=?',
            [firstName, lastName, phone, req.user.id]
        );
        res.json({ message: 'Профиль обновлён' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ═══════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════

// GET /api/users/admin/moderation — преподаватели на проверке
router.get('/admin/moderation', auth, adminOnly, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.id, u.first_name, u.last_name, u.email, u.created_at,
                    tp.id AS profile_id, tp.subject, tp.is_moderated, tp.teacher_type
             FROM users u JOIN teacher_profiles tp ON tp.user_id=u.id
             WHERE u.role='teacher' AND tp.is_moderated=0 ORDER BY u.created_at DESC`
        );
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// POST /api/users/admin/approve/:userId — одобрить преподавателя
router.post('/admin/approve/:userId', auth, adminOnly, async (req, res) => {
    try {
        await db.transaction(async (conn) => {
            await conn.execute(
                'UPDATE teacher_profiles SET is_moderated=1, is_visible=1, moderated_at=NOW() WHERE user_id=?',
                [req.params.userId]
            );
            await conn.execute(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                [randomUUID(), req.params.userId, 'approved', '✅ Профиль одобрен!', 'Ваш профиль проверен и опубликован в каталоге!']
            );
            // Одобряем все курсы этого преподавателя
            await conn.execute(
                `UPDATE courses SET status='active'
                 WHERE teacher_id=(SELECT id FROM teacher_profiles WHERE user_id=?) AND status='moderation'`,
                [req.params.userId]
            );
        });
        res.json({ message: 'Преподаватель одобрен' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// POST /api/users/admin/reject/:userId — отклонить
router.post('/admin/reject/:userId', auth, adminOnly, async (req, res) => {
    const { reason } = req.body;
    try {
        await db.transaction(async (conn) => {
            // is_moderated=2 = отклонён
            await conn.execute(
                'UPDATE teacher_profiles SET is_moderated=2, is_visible=0 WHERE user_id=?',
                [req.params.userId]
            );
            await conn.execute(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                [randomUUID(), req.params.userId, 'rejected', '❌ Профиль отклонён', reason||'Документы не прошли проверку. Обратитесь в поддержку.']
            );
        });
        res.json({ message: 'Отклонено' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// GET /api/users/admin/courses — курсы на модерации
router.get('/admin/courses', auth, adminOnly, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT c.id, c.title, c.category, c.price, c.status, c.created_at,
                    u.first_name, u.last_name, u.email
             FROM courses c
             JOIN teacher_profiles tp ON tp.id=c.teacher_id
             JOIN users u ON u.id=tp.user_id
             WHERE c.status='moderation' ORDER BY c.created_at DESC`
        );
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// POST /api/users/admin/courses/:id/approve — одобрить курс
router.post('/admin/courses/:id/approve', auth, adminOnly, async (req, res) => {
    try {
        const [r] = await db.query("UPDATE courses SET status='active' WHERE id=?", [req.params.id]);
        if (!r.affectedRows) return res.status(404).json({ error: 'Не найдено' });
        const [c] = await db.query('SELECT title, teacher_id FROM courses WHERE id=?', [req.params.id]);
        await db.query(
            `INSERT INTO notifications (id, user_id, type, title, body)
             SELECT ?,tp.user_id,'course_approved','✅ Курс одобрен',? FROM teacher_profiles tp WHERE tp.id=?`,
            [randomUUID(), `Курс "${c[0].title}" опубликован в каталоге`, c[0].teacher_id]
        );
        res.json({ message: 'Курс одобрен' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// GET /api/users/admin/stats — общая статистика
router.get('/admin/stats', auth, adminOnly, async (req, res) => {
    try {
        const [[students]]  = await db.query("SELECT COUNT(*) AS cnt FROM users WHERE role='student'");
        const [[teachers]]  = await db.query("SELECT COUNT(*) AS cnt FROM users WHERE role='teacher'");
        const [[courses]]   = await db.query("SELECT COUNT(*) AS cnt FROM courses WHERE status='active'");
        const [[pending_t]] = await db.query("SELECT COUNT(*) AS cnt FROM teacher_profiles WHERE is_moderated=0");
        const [[pending_c]] = await db.query("SELECT COUNT(*) AS cnt FROM courses WHERE status='moderation'");
        const [[revenue]]   = await db.query("SELECT COALESCE(SUM(commission_amount),0) AS total FROM enrollments");
        res.json({
            students: students.cnt, teachers: teachers.cnt, courses: courses.cnt,
            pendingTeachers: pending_t.cnt, pendingCourses: pending_c.cnt,
            totalRevenue: parseFloat(revenue.total),
        });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// GET /api/users/admin/rejected — отклонённые учителя
router.get('/admin/rejected', auth, adminOnly, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.id, u.first_name, u.last_name, u.email, u.created_at,
                    tp.id AS profile_id, tp.subject, tp.is_moderated, tp.teacher_type
             FROM users u JOIN teacher_profiles tp ON tp.user_id=u.id
             WHERE u.role='teacher' AND tp.is_moderated=2 ORDER BY u.created_at DESC`
        );
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// POST /api/users/admin/restore/:userId — восстановить отклонённого
router.post('/admin/restore/:userId', auth, adminOnly, async (req, res) => {
    try {
        await db.query('UPDATE teacher_profiles SET is_moderated=0 WHERE user_id=?', [req.params.userId]);
        res.json({ message: 'Возвращён на проверку' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
