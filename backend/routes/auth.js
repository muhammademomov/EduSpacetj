const express = require('express');
const { sendWelcomeEmail, sendVerificationEmail } = require('../email');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { auth } = require('../middleware/auth');

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
        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length) return res.status(409).json({ error: 'Email уже используется' });

        const passwordHash = await bcrypt.hash(password, 10);
        const initials = (firstName[0] + lastName[0]).toUpperCase();
        const color = randColor();
        const userId = newId();

        // Генерируем 6-значный код (10 минут)
        const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
        const verifyExpires = new Date(Date.now() + 10 * 60 * 1000);

        await db.transaction(async (conn) => {
            // Создаём пользователя с is_active = 0
            await conn.execute(
                `INSERT INTO users (id, first_name, last_name, email, phone, password_hash, role, color, initials, is_active, verify_code, verify_expires)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                [userId, firstName, lastName, email, phone, passwordHash, role, color, initials, verifyCode, verifyExpires]
            );

            if (role === 'student') {
                await conn.execute(
                    'INSERT INTO student_profiles (id, user_id) VALUES (?, ?)',
                    [newId(), userId]
                );
            } else {
                await conn.execute(
                    'INSERT INTO teacher_profiles (id, user_id, subject) VALUES (?, ?, ?)',
                    [newId(), userId, subject || null]
                );
                const [admins] = await conn.execute("SELECT id FROM users WHERE role='admin' LIMIT 1");
                if (admins.length) {
                    await conn.execute(
                        'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)',
                        [newId(), admins[0].id, 'new_teacher', 'Новый преподаватель',
                         `Зарегистрировался: ${firstName} ${lastName} (${email})`]
                    );
                }
            }
        });

        // Отправляем код на email
        await sendVerificationEmail({ email, firstName, code: verifyCode });

        res.status(201).json({
            message: 'Код подтверждения отправлен на email',
            userId,
            email,
        });

    } catch (err) {
        console.error('register error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── POST /api/auth/verify-email ──────────────────────────────────
router.post('/verify-email', async (req, res) => {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: 'userId и code обязательны' });

    try {
        const [rows] = await db.query(
            'SELECT * FROM users WHERE id = ? AND verify_code = ? AND verify_expires > NOW()',
            [userId, code]
        );

        if (!rows.length) return res.status(400).json({ error: 'Неверный или истёкший код' });

        const user = rows[0];

        // Активируем аккаунт
        await db.query(
            'UPDATE users SET is_active = 1, verify_code = NULL, verify_expires = NULL WHERE id = ?',
            [userId]
        );

        // Приветственное уведомление
        await db.query(
            'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)',
            [newId(), userId, 'welcome', 'Добро пожаловать в EduSpace.tj!',
             user.role === 'student'
                ? 'Найдите преподавателя и запишитесь на курс'
                : 'Заполните профиль — он уйдёт на проверку']
        );

        const token = jwt.sign({ id: userId, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });

        // Приветственное письмо
        sendWelcomeEmail({ email: user.email, firstName: user.first_name, role: user.role }).catch((e) => {
            console.error('welcome email error:', e.message);
        });

        res.json({
            message: 'Email подтверждён!',
            token,
            user: {
                id: user.id, firstName: user.first_name, lastName: user.last_name,
                email: user.email, role: user.role, initials: user.initials, color: user.color,
            },
        });

    } catch (err) {
        console.error('verify-email error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── POST /api/auth/resend-code ────────────────────────────────────
router.post('/resend-code', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId обязателен' });

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE id = ? AND is_active = 0', [userId]);
        if (!rows.length) return res.status(400).json({ error: 'Пользователь не найден' });

        const user = rows[0];
        const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
        const verifyExpires = new Date(Date.now() + 10 * 60 * 1000);

        await db.query(
            'UPDATE users SET verify_code = ?, verify_expires = ? WHERE id = ?',
            [verifyCode, verifyExpires, userId]
        );

        await sendVerificationEmail({ email: user.email, firstName: user.first_name, code: verifyCode });

        res.json({ message: 'Новый код отправлен' });
    } catch (err) {
        console.error('resend-code error:', err);
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
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        // Проверяем подтверждён ли email
        if (!user.is_active) {
            return res.status(403).json({
                error: 'Email не подтверждён',
                userId: user.id,
                needVerify: true,
            });
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
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Укажите email' });
    try {
        const [rows] = await db.query('SELECT id, first_name FROM users WHERE email=? AND is_active=1', [email.toLowerCase().trim()]);
        if (!rows.length) return res.json({ message: 'Если email зарегистрирован — письмо отправлено' });

        const user = rows[0];
        const token = require('crypto').randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000);

        await db.query(
            `INSERT INTO password_resets (id, user_id, token, expires_at)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE token=VALUES(token), expires_at=VALUES(expires_at)`,
            [newId(), user.id, token, expires]
        );

        const resetUrl = (process.env.FRONTEND_URL || 'https://eduspacetj-production.up.railway.app') + '#reset-password?token=' + token;
        await sendResetEmail(email, user.first_name, resetUrl);

        res.json({ message: 'Если email зарегистрирован — письмо отправлено' });
    } catch(err) {
        console.error('forgot-password error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ─── POST /api/auth/reset-password ────────────────────────────────
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

// ─── GET /api/auth/check-reset-token/:token ───────────────────────
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
            <h2 style="color:#18A96A">EduSpace.tj</h2>
            <h3>Привет, ${firstName}!</h3>
            <p>Нажмите на кнопку ниже — ссылка действует <strong>1 час</strong>.</p>
            <a href="${resetUrl}" style="display:block;background:#18A96A;color:#fff;text-align:center;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:700">
                Сбросить пароль →
            </a>
            <p style="color:#999;font-size:12px;margin:20px 0 0;text-align:center">
                Если вы не запрашивали сброс пароля — проигнорируйте это письмо.
            </p>
        </div>`,
    });
}

function safeJson(val, def) {
    if (!val) return def;
    try { return JSON.parse(val); } catch { return def; }
}

module.exports = router;
