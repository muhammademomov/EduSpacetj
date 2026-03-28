const express = require('express');
const { sendTopupApprovedEmail, sendNewStudentEmail } = require('../email');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { auth, studentOnly } = require('../middleware/auth');
const { randomUUID } = require('crypto');

const COMMISSION = 0.15;

// ─── Telegram уведомление администратору ──────────────
async function tgNotify(text) {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) { console.log('TG: no token/chatId'); return; }
    return new Promise((resolve) => {
        const https = require('https');
        const body  = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
        const opts  = {
            hostname: 'api.telegram.org',
            path: `/bot${token}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => { console.log('TG sent:', res.statusCode); resolve(); });
        });
        req.on('error', e => { console.error('TG error:', e.message); resolve(); });
        req.write(body);
        req.end();
    });
}



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
                    u.first_name, u.last_name, u.initials, u.color, u.avatar_url
             FROM enrollments e
             JOIN courses c ON c.id = e.course_id
             JOIN teacher_profiles tp ON tp.id = e.teacher_id
             JOIN users u ON u.id = tp.user_id
             WHERE e.student_id = ? ORDER BY e.enrolled_at DESC`, [req.user.id]
        );
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// ─── POST /api/payments/topup-request ─────────────────────────────
// Студент создаёт заявку на пополнение баланса
router.post('/topup-request', auth, studentOnly, [
    body('amount').isFloat({ min: 10 }).withMessage('Минимум 10 смн'),
    body('method').isIn(['alif_mobi','card']).withMessage('Неверный метод'),
    body('transaction_id').trim().notEmpty().withMessage('Введите номер транзакции'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { amount, method, transaction_id, comment, course_id } = req.body;
    try {
        const reqId = randomUUID();
        await db.query(
            `INSERT INTO topup_requests (id, student_id, amount, method, transaction_id, comment, course_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [reqId, req.user.id, parseFloat(amount), method, transaction_id.trim(), comment || null, course_id || null]
        );

        // Уведомление студенту
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
            [randomUUID(), req.user.id, 'topup', '⏳ Заявка принята', `Пополнение на ${amount} смн отправлено на проверку`]
        );

        // Telegram уведомление администратору
        const [sInfo] = await db.query('SELECT first_name, last_name, email FROM users WHERE id=?', [req.user.id]);
        const s = sInfo[0] || {};
        await tgNotify(
            `💰 <b>Новая заявка на пополнение!</b>\n\n` +
            `👤 Студент: <b>${s.first_name} ${s.last_name}</b>\n` +
            `📧 Email: ${s.email}\n` +
            `💵 Сумма: <b>${amount} смн</b>\n` +
            `📱 Способ: ${method === 'alif_mobi' ? 'Алиф Моби' : 'Банковская карта'}\n` +
            `🔖 №транзакции: <code>${transaction_id}</code>\n` +
            (comment ? `💬 Комментарий: ${comment}\n` : '') +
            `\n⚡ Войди в <a href="https://eduspacetj-production.up.railway.app/admin.html">админ панель</a> чтобы одобрить`
        );

        // Уведомление всем админам
        const [admins] = await db.query("SELECT id FROM users WHERE role='admin' AND is_active=1");
        for (const admin of admins) {
            await db.query(
                'INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?,?,?,?,?,?)',
                [randomUUID(), admin.id, 'topup_request', '💰 Новая заявка на пополнение',
                 `Студент запросил пополнение ${amount} смн (${method === 'alif_mobi' ? 'Алиф Моби' : 'Карта'})`,
                 reqId]
            );
        }

        res.json({ message: 'Заявка отправлена', requestId: reqId });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/payments/topup-requests ─────────────────────────────
// Студент видит свои заявки
router.get('/topup-requests', auth, studentOnly, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, amount, method, transaction_id, comment, status, admin_comment, created_at, reviewed_at
             FROM topup_requests WHERE student_id=? ORDER BY created_at DESC LIMIT 20`,
            [req.user.id]
        );
        res.json(rows);
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/payments/admin/topup-requests ───────────────────────
// Админ видит все заявки
router.get('/admin/topup-requests', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
    try {
        const { status = 'pending' } = req.query;
        const [rows] = await db.query(
            `SELECT tr.id, tr.amount, tr.method, tr.transaction_id, tr.comment, tr.status,
                    tr.admin_comment, tr.created_at, tr.reviewed_at,
                    u.id AS student_user_id, u.first_name, u.last_name, u.email,
                    sp.balance AS current_balance
             FROM topup_requests tr
             JOIN users u ON u.id = tr.student_id
             JOIN student_profiles sp ON sp.user_id = u.id
             WHERE tr.status = ?
             ORDER BY tr.created_at DESC`,
            [status]
        );
        res.json(rows);
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/payments/admin/topup-approve/:id ───────────────────
// Админ одобряет заявку → пополняет баланс студента
router.post('/admin/topup-approve/:id', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
    const { admin_comment } = req.body;
    try {
        const [reqs] = await db.query('SELECT * FROM topup_requests WHERE id=?', [req.params.id]);
        if (!reqs.length) return res.status(404).json({ error: 'Заявка не найдена' });
        const topupReq = reqs[0];
        if (topupReq.status !== 'pending') return res.status(400).json({ error: 'Заявка уже обработана' });

        let enrollmentDone = false;
        let courseTitle = null;
        let remainingBalance = 0;

        await db.transaction(async (conn) => {
            // 1. Пополняем баланс на всю сумму
            await conn.execute(
                'UPDATE student_profiles SET balance = balance + ?, total_added = total_added + ? WHERE user_id = ?',
                [topupReq.amount, topupReq.amount, topupReq.student_id]
            );
            // 2. Транзакция пополнения
            await conn.execute(
                'INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?,?,?,?,?)',
                [randomUUID(), topupReq.student_id, 'topup', topupReq.amount,
                 `Пополнение: ${topupReq.amount} смн`]
            );
            // 3. Статус заявки
            await conn.execute(
                `UPDATE topup_requests SET status='approved', admin_comment=?, reviewed_at=NOW() WHERE id=?`,
                [admin_comment || null, req.params.id]
            );

            // 4. Если есть course_id — автоматически покупаем курс
            if (topupReq.course_id) {
                // Проверяем не записан ли уже
                const [existEnroll] = await conn.execute(
                    'SELECT id FROM enrollments WHERE student_id=? AND course_id=?',
                    [topupReq.student_id, topupReq.course_id]
                );
                if (!existEnroll.length) {
                    const [courses] = await conn.execute(
                        `SELECT c.*, tp.id AS teacher_profile_id, tp.user_id AS teacher_user_id
                         FROM courses c JOIN teacher_profiles tp ON tp.id = c.teacher_id
                         WHERE c.id = ? AND c.status = 'active'`, [topupReq.course_id]
                    );
                    if (courses.length) {
                        const course = courses[0];
                        const price = parseFloat(course.price);
                        // Получаем текущий баланс после пополнения
                        const [sp] = await conn.execute(
                            'SELECT balance FROM student_profiles WHERE user_id=?', [topupReq.student_id]
                        );
                        const balNow = parseFloat(sp[0].balance);
                        if (balNow >= price) {
                            const commission = Math.round(price * COMMISSION * 100) / 100;
                            const teacherGet  = Math.round((price - commission) * 100) / 100;
                            const enrollId    = randomUUID();
                            // Списываем с баланса студента
                            await conn.execute(
                                'UPDATE student_profiles SET balance = balance - ?, total_spent = total_spent + ? WHERE user_id = ?',
                                [price, price, topupReq.student_id]
                            );
                            // Запись на курс
                            await conn.execute(
                                `INSERT INTO enrollments (id, student_id, course_id, teacher_id, price_paid, commission_amount, teacher_amount)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [enrollId, topupReq.student_id, topupReq.course_id, course.teacher_profile_id, price, commission, teacherGet]
                            );
                            // Транзакция оплаты
                            await conn.execute(
                                'INSERT INTO transactions (id, user_id, type, amount, description, related_course_id) VALUES (?,?,?,?,?,?)',
                                [randomUUID(), topupReq.student_id, 'payment', price,
                                 `Оплата курса: ${course.title}`, topupReq.course_id]
                            );
                            // Счётчики
                            await conn.execute('UPDATE courses SET student_count = student_count + 1 WHERE id = ?', [topupReq.course_id]);
                            await conn.execute(
                                'UPDATE teacher_profiles SET student_count = student_count + 1, total_earnings = total_earnings + ? WHERE id = ?',
                                [teacherGet, course.teacher_profile_id]
                            );
                            // Уведомление учителю
                            await conn.execute(
                                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                                [randomUUID(), course.teacher_user_id, 'new_student',
                                 '🎉 Новый ученик!',
                                 `Записался на курс "${course.title}". Доход: ${teacherGet} смн`]
                            );
                            courseTitle = course.title;
                            enrollmentDone = true;
                            remainingBalance = balNow - price;
                        }
                    }
                }
            }

            // 5. Уведомление студенту
            const [finalBal] = await conn.execute(
                'SELECT balance FROM student_profiles WHERE user_id=?', [topupReq.student_id]
            );
            remainingBalance = parseFloat(finalBal[0].balance);

            const notifTitle = enrollmentDone ? '🎉 Курс куплен!' : '✅ Баланс пополнен!';
            const notifBody  = enrollmentDone
                ? `Курс "${courseTitle}" оплачен. Остаток на балансе: ${remainingBalance} смн`
                : `+${topupReq.amount} смн зачислено на ваш счёт`;

            await conn.execute(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                [randomUUID(), topupReq.student_id, enrollmentDone ? 'enrollment' : 'topup',
                 notifTitle, notifBody]
            );
        });

        const [bal] = await db.query('SELECT balance FROM student_profiles WHERE user_id=?', [topupReq.student_id]);
        // Email уведомления асинхронно
        try {
            const [studentUser] = await db.query('SELECT email, first_name FROM users WHERE id=?', [topupReq.student_id]);
            if (studentUser.length) {
                sendTopupApprovedEmail(
                    { email: studentUser[0].email, firstName: studentUser[0].first_name },
                    topupReq.amount,
                    enrollmentDone ? courseTitle : null
                ).catch(() => {});
            }
        } catch(e) {}
        res.json({
            message: enrollmentDone ? `Курс куплен! Остаток: ${remainingBalance} смн` : 'Баланс пополнен',
            newBalance: parseFloat(bal[0].balance),
            enrollmentDone,
            courseTitle
        });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/payments/admin/topup-reject/:id ────────────────────
// Админ отклоняет заявку
router.post('/admin/topup-reject/:id', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
    const { admin_comment } = req.body;
    try {
        const [reqs] = await db.query('SELECT * FROM topup_requests WHERE id=?', [req.params.id]);
        if (!reqs.length) return res.status(404).json({ error: 'Заявка не найдена' });
        if (reqs[0].status !== 'pending') return res.status(400).json({ error: 'Заявка уже обработана' });

        await db.query(
            `UPDATE topup_requests SET status='rejected', admin_comment=?, reviewed_at=NOW() WHERE id=?`,
            [admin_comment || 'Заявка отклонена', req.params.id]
        );
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
            [randomUUID(), reqs[0].student_id, 'topup',
             '❌ Заявка отклонена',
             admin_comment || 'Проверьте данные и попробуйте снова']
        );

        res.json({ message: 'Заявка отклонена' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/payments/teacher/balance ────────────────────────────
// Учитель видит свой баланс к выводу
router.get('/teacher/balance', auth, async (req, res) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Нет доступа' });
    try {
        const [tp] = await db.query(
            'SELECT total_earnings, withdrawn FROM teacher_profiles WHERE user_id=?', [req.user.id]
        );
        if (!tp.length) return res.status(404).json({ error: 'Профиль не найден' });
        const totalEarned   = parseFloat(tp[0].total_earnings || 0);
        const totalWithdrawn = parseFloat(tp[0].withdrawn || 0);
        const available     = totalEarned - totalWithdrawn;
        res.json({ totalEarned, totalWithdrawn, available });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/payments/teacher/withdraw ──────────────────────────
// Учитель создаёт заявку на вывод средств
router.post('/teacher/withdraw', auth, async (req, res) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Нет доступа' });
    const { amount, method, card_or_phone } = req.body;
    if (!amount || parseFloat(amount) < 50) return res.status(400).json({ error: 'Минимальная сумма вывода 50 смн' });
    if (!card_or_phone) return res.status(400).json({ error: 'Укажите номер карты или телефона' });

    try {
        const [tp] = await db.query('SELECT id, total_earnings, withdrawn FROM teacher_profiles WHERE user_id=?', [req.user.id]);
        if (!tp.length) return res.status(404).json({ error: 'Профиль не найден' });

        const available = parseFloat(tp[0].total_earnings || 0) - parseFloat(tp[0].withdrawn || 0);
        if (parseFloat(amount) > available) {
            return res.status(400).json({ error: `Недостаточно средств. Доступно: ${available.toFixed(2)} смн` });
        }

        const wdId = randomUUID();
        await db.query(
            `INSERT INTO withdraw_requests (id, teacher_id, amount, method, card_or_phone, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [wdId, req.user.id, parseFloat(amount), method || 'alif_mobi', card_or_phone.trim()]
        );

        // Уведомление учителю
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
            [randomUUID(), req.user.id, 'withdraw', '⏳ Заявка на вывод принята',
             `Заявка на вывод ${amount} смн отправлена на обработку`]
        );

        // Telegram уведомление администратору
        const [tInfo] = await db.query('SELECT first_name, last_name, email FROM users WHERE id=?', [req.user.id]);
        const t = tInfo[0] || {};
        await tgNotify(
            `💸 <b>Запрос на вывод средств!</b>\n\n` +
            `👨‍🏫 Учитель: <b>${t.first_name} ${t.last_name}</b>\n` +
            `📧 Email: ${t.email}\n` +
            `💵 Сумма: <b>${amount} смн</b>\n` +
            `📱 Способ: ${method === 'alif_mobi' ? 'Алиф Моби' : 'Банковская карта'}\n` +
            `💳 Реквизиты: <code>${card_or_phone}</code>\n` +
            `\n⚡ Войди в <a href="https://eduspacetj-production.up.railway.app/admin.html">админ панель</a> чтобы обработать`
        );

        // Уведомление всем админам
        const [admins] = await db.query("SELECT id FROM users WHERE role='admin' AND is_active=1");
        for (const admin of admins) {
            await db.query(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                [randomUUID(), admin.id, 'withdraw_request', '💸 Запрос на вывод средств',
                 `Учитель запросил вывод ${amount} смн на ${card_or_phone}`]
            );
        }

        res.json({ message: 'Заявка на вывод отправлена', requestId: wdId });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET /api/payments/admin/withdraw-requests ────────────────────
// Админ видит заявки на вывод
router.get('/admin/withdraw-requests', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
    try {
        const { status = 'pending' } = req.query;
        const [rows] = await db.query(
            `SELECT wr.id, wr.amount, wr.method, wr.card_or_phone, wr.status,
                    wr.admin_comment, wr.created_at, wr.reviewed_at,
                    u.id AS teacher_user_id, u.first_name, u.last_name, u.email,
                    tp.total_earnings, tp.withdrawn
             FROM withdraw_requests wr
             JOIN users u ON u.id = wr.teacher_id
             JOIN teacher_profiles tp ON tp.user_id = u.id
             WHERE wr.status = ?
             ORDER BY wr.created_at DESC`,
            [status]
        );
        res.json(rows);
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/payments/admin/withdraw-approve/:id ────────────────
// Админ одобряет вывод → деньги переведены вручную
router.post('/admin/withdraw-approve/:id', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
    const { admin_comment } = req.body;
    try {
        const [wrs] = await db.query('SELECT * FROM withdraw_requests WHERE id=?', [req.params.id]);
        if (!wrs.length) return res.status(404).json({ error: 'Заявка не найдена' });
        const wr = wrs[0];
        if (wr.status !== 'pending') return res.status(400).json({ error: 'Заявка уже обработана' });

        await db.transaction(async (conn) => {
            // Фиксируем вывод
            await conn.execute(
                'UPDATE teacher_profiles SET withdrawn = withdrawn + ? WHERE user_id=?',
                [wr.amount, wr.teacher_id]
            );
            await conn.execute(
                `UPDATE withdraw_requests SET status='approved', admin_comment=?, reviewed_at=NOW() WHERE id=?`,
                [admin_comment || null, req.params.id]
            );
            // Уведомление учителю
            await conn.execute(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                [randomUUID(), wr.teacher_id, 'withdraw',
                 '✅ Вывод средств выполнен!',
                 `${wr.amount} смн переведено на ${wr.card_or_phone}`]
            );
        });

        res.json({ message: 'Вывод подтверждён' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/payments/admin/withdraw-reject/:id ─────────────────
router.post('/admin/withdraw-reject/:id', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
    const { admin_comment } = req.body;
    try {
        const [wrs] = await db.query('SELECT * FROM withdraw_requests WHERE id=?', [req.params.id]);
        if (!wrs.length) return res.status(404).json({ error: 'Заявка не найдена' });
        if (wrs[0].status !== 'pending') return res.status(400).json({ error: 'Заявка уже обработана' });

        await db.query(
            `UPDATE withdraw_requests SET status='rejected', admin_comment=?, reviewed_at=NOW() WHERE id=?`,
            [admin_comment || 'Заявка отклонена', req.params.id]
        );
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
            [randomUUID(), wrs[0].teacher_id, 'withdraw',
             '❌ Заявка на вывод отклонена',
             admin_comment || 'Свяжитесь с поддержкой']
        );

        res.json({ message: 'Заявка отклонена' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
