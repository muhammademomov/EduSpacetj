const express = require('express');
const { sendWelcomeEmail } = require('../email');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { v4: uuid } = require('crypto');

const COLORS = ['#18A96A','#7C3AED','#2563EB','#DC2626','#D97706','#059669','#0891B2'];
const randColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];
const newId = () => require('crypto').randomUUID();

// ─── POST /api/auth/register ───────────────────────────────────────
router.post('/register', [
    body('firstName').trim().notEmpty().withMessage('Имя обязательно'),
    body('lastName').trim().notEmpty().withMessage('Фамилия обязательна'),
    body('email').isEmail().normalizeEmail(),
    body('phone').trim().notEmpty(),
    body('password').isLength({ min: 8 }).withMessage('Пароль минимум 8 символов'),
    body('role').isIn(['student', 'teacher']),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { firstName, lastName, email, phone, password, role, subject } = req.body;

    try {
        // Проверяем дубликат
        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length) return res.status(409).json({ error: 'Email уже используется' });

        const passwordHash = await bcrypt.hash(password, 10);
        const initials = (firstName[0] + lastName[0]).toUpperCase();
        const color = randColor();
        const userId = newId();

        await db.transaction(async (conn) => {
            // 1. Пользователь
            await conn.execute(
                `INSERT INTO users (id, first_name, last_name, email, phone, password_hash, role, color, initials)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, firstName, lastName, email, phone, passwordHash, role, color, initials]
            );

            if (role === 'student') {
                // 2a. Профиль ученика
                await conn.execute(
                    'INSERT INTO student_profiles (id, user_id) VALUES (?, ?)',
                    [newId(), userId]
                );
            } else {
                // 2b. Профиль преподавателя
                await conn.execute(
                    'INSERT INTO teacher_profiles (id, user_id, subject) VALUES (?, ?, ?)',
                    [newId(), userId, subject || null]
                );
                // Уведомление для admin
                const [admins] = await conn.execute("SELECT id FROM users WHERE role='admin' LIMIT 1");
                if (admins.length) {
                    await conn.execute(
                        'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)',
                        [newId(), admins[0].id, 'new_teacher', 'Новый преподаватель',
                         `Зарегистрировался: ${firstName} ${lastName} (${email})`]
                    );
                }
            }
            // Приветственное уведомление
            await conn.execute(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)',
                [newId(), userId, 'welcome', 'Добро пожаловать в EduSpace.tj!',
                 role === 'student'
                    ? 'Найдите преподавателя и запишитесь на курс'
                    : 'Заполните профиль — он уйдёт на проверку']
            );
        });

        const token = jwt.sign({ id: userId, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({
            message: 'Аккаунт создан',
            token,
            user: { id: userId, firstName, lastName, email, role, initials, color },
        });
        // Приветственное письмо (асинхронно)
        sendWelcomeEmail({ email, firstName, role }).catch(() => {});
    } catch (err) {
        console.error('register error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── POST /api/auth/login ──────────────────────────────────────────
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
], async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await db.query(
            'SELECT * FROM users WHERE email = ? AND is_active = 1', [email]
        );
        const user = rows[0];
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }
        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({
            token,
            user: {
                id: user.id, firstName: user.first_name, lastName: user.last_name,
                email: user.email, role: user.role, initials: user.initials, color: user.color,
                avatarUrl: user.avatar_url || null,
            },
        });
    } catch (err) {
        console.error('login error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── GET /api/auth/me ──────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        let extra = {};
        if (req.user.role === 'student') {
            const [rows] = await db.query(
                'SELECT balance, total_added, total_spent FROM student_profiles WHERE user_id = ?', [userId]
            );
            extra = rows[0] || {};
        } else if (req.user.role === 'teacher') {
            const [rows] = await db.query(
                'SELECT subject, bio, tags, price, platforms, work_days, work_hours, is_moderated, rating, review_count, student_count FROM teacher_profiles WHERE user_id = ?',
                [userId]
            );
            if (rows[0]) {
                const t = rows[0];
                extra = { ...t, tags: safeJson(t.tags, []), platforms: safeJson(t.platforms, []), workDays: safeJson(t.work_days, []) };
                // Get video_url separately (column may not exist yet)
                try {
                    const [vr] = await db.query('SELECT video_url FROM teacher_profiles WHERE user_id = ?', [userId]);
                    if (vr[0]) extra.videoUrl = vr[0].video_url || null;
                } catch(ve) { extra.videoUrl = null; }
            }
        }
        res.json({
            id: req.user.id, firstName: req.user.first_name, lastName: req.user.last_name,
            email: req.user.email, role: req.user.role, initials: req.user.initials, color: req.user.color,
            avatarUrl: req.user.avatar_url || null,
            ...extra,
        });
    } catch (err) {
        console.error('me error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── PUT /api/auth/password ────────────────────────────────────────
router.put('/password', auth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });
    try {
        const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
        if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
            return res.status(401).json({ error: 'Неверный текущий пароль' });
        }
        const hash = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
        res.json({ message: 'Пароль изменён' });
    } catch (err) {
        console.error(err); res.status(500).json({ error: 'Ошибка сервера' });
    }
});


// ─── POST /api/auth/forgot-password ───────────────────────────────
// Отправить email со ссылкой сброса
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Укажите email' });
    try {
        const [rows] = await db.query('SELECT id, first_name FROM users WHERE email=? AND is_active=1', [email.toLowerCase().trim()]);
        // Всегда отвечаем успехом — не раскрываем есть ли такой email
        if (!rows.length) return res.json({ message: 'Если email зарегистрирован — письмо отправлено' });

        const user = rows[0];
        const token = require('crypto').randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 час

        // Сохраняем токен в БД
        await db.query(
            `INSERT INTO password_resets (id, user_id, token, expires_at)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE token=VALUES(token), expires_at=VALUES(expires_at)`,
            [newId(), user.id, token, expires]
        );

        // Отправляем email
        const resetUrl = (process.env.FRONTEND_URL || 'https://eduspacetj-production.up.railway.app') + '#reset-password?token=' + token;
        await sendResetEmail(email, user.first_name, resetUrl);

        res.json({ message: 'Если email зарегистрирован — письмо отправлено' });
    } catch(err) {
        console.error('forgot-password error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── POST /api/auth/reset-password ────────────────────────────────
// Установить новый пароль по токену
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
        return res.status(400).json({ error: 'Токен и пароль (мин. 8 символов) обязательны' });
    }
    try {
        const [rows] = await db.query(
            'SELECT user_id FROM password_resets WHERE token=? AND expires_at > NOW()',
            [token]
        );
        if (!rows.length) return res.status(400).json({ error: 'Ссылка недействительна или истекла' });

        const hash = await bcrypt.hash(password, 10);
        await db.query('UPDATE users SET password_hash=? WHERE id=?', [hash, rows[0].user_id]);
        await db.query('DELETE FROM password_resets WHERE token=?', [token]);

        res.json({ message: 'Пароль успешно изменён' });
    } catch(err) {
        console.error('reset-password error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── POST /api/auth/check-reset-token ─────────────────────────────
// Проверить что токен валидный (для фронта)
router.get('/check-reset-token/:token', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT user_id FROM password_resets WHERE token=? AND expires_at > NOW()',
            [req.params.token]
        );
        res.json({ valid: rows.length > 0 });
    } catch(err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});


// ─── Email helper ──────────────────────────────────────────────────
async function sendResetEmail(to, firstName, resetUrl) {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
        from: 'EduSpace.tj <onboarding@resend.dev>',
        to,
        subject: 'Сброс пароля — EduSpace.tj',
        html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px">
            <div style="text-align:center;margin-bottom:24px">
                <div style="background:#18A96A;width:48px;height:48px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:24px">📚</div>
                <h2 style="color:#111;margin:12px 0 0;font-size:20px">EduSpace.tj</h2>
            </div>
            <h3 style="color:#111;margin:0 0 8px">Привет, ${firstName}!</h3>
            <p style="color:#555;margin:0 0 24px;line-height:1.6">
                Мы получили запрос на сброс пароля вашего аккаунта.<br>
                Нажмите на кнопку ниже — ссылка действует <strong>1 час</strong>.
            </p>
            <a href="${resetUrl}" style="display:block;background:#18A96A;color:#fff;text-align:center;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
                Сбросить пароль →
            </a>
            <p style="color:#999;font-size:12px;margin:20px 0 0;text-align:center">
                Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.
            </p>
        </div>
        `,
    });
}

function safeJson(val, def) {
    if (!val) return def;
    try { return JSON.parse(val); } catch { return def; }
}

module.exports = router;
