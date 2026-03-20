const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { auth, studentOnly } = require('../middleware/auth');
const { randomUUID } = require('crypto');

const COMMISSION = 0.15;

// ─── GET /api/payments/balance ─────────────────────────────────────
router.get('/balance', auth, studentOnly, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT balance, total_added, total_spent FROM student_profiles WHERE user_id = ?', [req.user.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Профиль не найден' });
        const r = rows[0];
        res.json({ balance: parseFloat(r.balance), totalAdded: parseFloat(r.total_added), totalSpent: parseFloat(r.total_spent) });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/payments/topup ──────────────────────────────────────
router.post('/topup', auth, studentOnly, [
    body('amount').isFloat({ min: 10 }).withMessage('Минимум 10 смн'),
    body('method').isIn(['card','phone','bank']),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const amount = parseFloat(req.body.amount);
    const { method } = req.body;

    try {
        await db.transaction(async (conn) => {
            await conn.execute(
                'UPDATE student_profiles SET balance = balance + ?, total_added = total_added + ? WHERE user_id = ?',
                [amount, amount, req.user.id]
            );
            await conn.execute(
                'INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)',
                [randomUUID(), req.user.id, 'topup', amount, `Пополнение (${method}): ${amount} смн`]
            );
            await conn.execute(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)',
                [randomUUID(), req.user.id, 'topup', 'Баланс пополнен', `+${amount} смн зачислено на счёт`]
            );
        });

        const [rows] = await db.query(
            'SELECT balance, total_added FROM student_profiles WHERE user_id = ?', [req.user.id]
        );
        res.json({
            message: 'Баланс пополнен', amount,
            balance: parseFloat(rows[0].balance), totalAdded: parseFloat(rows[0].total_added),
        });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/payments/enroll ─────────────────────────────────────
router.post('/enroll', auth, studentOnly, [
    body('courseId').notEmpty(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { courseId } = req.body;

    try {
        // Уже записан?
        const [existing] = await db.query(
            'SELECT id FROM enrollments WHERE student_id=? AND course_id=?', [req.user.id, courseId]
        );
        if (existing.length) return res.status(409).json({ error: 'Вы уже записаны на этот курс' });

        // Курс существует?
        const [courses] = await db.query(
            `SELECT c.*, tp.id AS teacher_profile_id, tp.user_id AS teacher_user_id
             FROM courses c JOIN teacher_profiles tp ON tp.id = c.teacher_id
             WHERE c.id = ? AND c.status = 'active'`, [courseId]
        );
        if (!courses.length) return res.status(404).json({ error: 'Курс не найден или недоступен' });
        const course = courses[0];

        // Достаточно баланса?
        const [sp] = await db.query('SELECT balance FROM student_profiles WHERE user_id=?', [req.user.id]);
        const balance = parseFloat(sp[0]?.balance || 0);
        if (balance < course.price) {
            return res.status(402).json({
                error: 'Недостаточно средств', balance,
                required: parseFloat(course.price), shortage: course.price - balance,
            });
        }

        const price       = parseFloat(course.price);
        const commission  = Math.round(price * COMMISSION * 100) / 100;
        const teacherGet  = Math.round((price - commission) * 100) / 100;
        const enrollId    = randomUUID();

        await db.transaction(async (conn) => {
            // 1. Списываем у ученика
            await conn.execute(
                'UPDATE student_profiles SET balance = balance - ?, total_spent = total_spent + ? WHERE user_id = ?',
                [price, price, req.user.id]
            );
            // 2. Запись на курс
            await conn.execute(
                `INSERT INTO enrollments (id, student_id, course_id, teacher_id, price_paid, commission_amount, teacher_amount)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [enrollId, req.user.id, courseId, course.teacher_profile_id, price, commission, teacherGet]
            );
            // 3. Транзакция
            await conn.execute(
                'INSERT INTO transactions (id, user_id, type, amount, description, related_course_id, related_enrollment_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [randomUUID(), req.user.id, 'payment', price, `Оплата курса: ${course.title}`, courseId, enrollId]
            );
            // 4. Счётчики
            await conn.execute('UPDATE courses SET student_count = student_count + 1 WHERE id = ?', [courseId]);
            await conn.execute(
                'UPDATE teacher_profiles SET student_count = student_count + 1, total_earnings = total_earnings + ? WHERE id = ?',
                [teacherGet, course.teacher_profile_id]
            );
            // 5. Уведомление ученику
            await conn.execute(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)',
                [randomUUID(), req.user.id, 'enrollment', 'Вы записаны на курс', `Курс "${course.title}" куплен. Ожидайте контакт от преподавателя.`]
            );
            // 6. Уведомление преподавателю
            await conn.execute(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)',
                [randomUUID(), course.teacher_user_id, 'new_student', 'Новый ученик!', `Записался на курс "${course.title}". Доход: ${teacherGet} смн`]
            );
        });

        const [newBal] = await db.query('SELECT balance FROM student_profiles WHERE user_id=?', [req.user.id]);
        res.status(201).json({
            message: 'Оплата прошла успешно',
            enrollment: { id:enrollId, courseTitle:course.title, pricePaid:price, commissionAmount:commission, teacherAmount:teacherGet },
            newBalance: parseFloat(newBal[0].balance),
        });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/payments/history ─────────────────────────────────────
router.get('/history', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT t.id, t.type, t.amount, t.description, t.status, t.created_at,
                    c.title AS course_title, c.emoji AS course_emoji
             FROM transactions t
             LEFT JOIN courses c ON c.id = t.related_course_id
             WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT 50`, [req.user.id]
        );
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/payments/enrollments ────────────────────────────────
router.get('/enrollments', auth, studentOnly, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT e.id, e.status, e.enrolled_at, e.price_paid,
                    c.id AS course_id, c.title, c.category, c.level, c.price, c.emoji, c.rating,
                    u.first_name, u.last_name, u.initials, u.color
             FROM enrollments e
             JOIN courses c ON c.id = e.course_id
             JOIN teacher_profiles tp ON tp.id = e.teacher_id
             JOIN users u ON u.id = tp.user_id
             WHERE e.student_id = ? ORDER BY e.enrolled_at DESC`, [req.user.id]
        );
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
