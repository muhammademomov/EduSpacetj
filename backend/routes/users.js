const express = require('express');
const router  = express.Router();
const db = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { randomUUID } = require('crypto');
const { uploadPhoto } = require('../cloudinary');
const { sendEmail } = require('../email');

// ─── Письмо об одобрении преподавателя ────────────────────────────
async function sendApprovedEmail(teacher) {
    const { email, firstName, subject } = teacher;
    const dashUrl = 'https://eduspace.tj/#teacher-dash';
    const isEnglish = subject && subject.toLowerCase().includes('english') ||
                      subject && subject.toLowerCase().includes('английск');

    let html;

    if (isEnglish) {
        // Английский + Таджикский
        html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#f9fafb;padding:32px;border-radius:16px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:48px">🎉</div>
            <h2 style="color:#18A96A;margin:8px 0">EduSpace.tj</h2>
          </div>

          <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:16px">
            <h3 style="color:#042C53;margin:0 0 12px">Congratulations, ${firstName}!</h3>
            <p style="color:#4A5E52;line-height:1.7;margin:0 0 16px">
              Your teacher profile has been verified and is now visible to all students on EduSpace.tj.
            </p>
            <p style="color:#4A5E52;line-height:1.7;margin:0 0 16px">You can now:</p>
            <ul style="color:#4A5E52;line-height:2;padding-left:20px;margin:0 0 20px">
              <li>Receive enrollment requests from students</li>
              <li>Chat with your students</li>
              <li>Add new courses</li>
              <li>Manage your schedule</li>
            </ul>
            <div style="text-align:center">
              <a href="${dashUrl}" style="background:#18A96A;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">
                Go to Dashboard →
              </a>
            </div>
          </div>

          <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:16px">
            <h3 style="color:#042C53;margin:0 0 12px">Табрик, ${firstName}!</h3>
            <p style="color:#4A5E52;line-height:1.7;margin:0 0 16px">
              Профили муаллими шумо тасдиқ карда шуд ва ҳоло барои ҳамаи хонандагон дар EduSpace.tj намоён аст.
            </p>
            <ul style="color:#4A5E52;line-height:2;padding-left:20px;margin:0 0 16px">
              <li>Аз хонандагон дархостҳо қабул кунед</li>
              <li>Бо хонандагон чат кунед</li>
              <li>Курсҳои нав илова кунед</li>
            </ul>
          </div>

          <p style="color:#999;font-size:12px;text-align:center;margin:0">
            EduSpace.tj · Душанбе, Тоҷикистон · <a href="mailto:eduspacedushanbe@gmail.com" style="color:#18A96A">eduspacedushanbe@gmail.com</a>
          </p>
        </div>`;
    } else {
        // Русский + Таджикский
        html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#f9fafb;padding:32px;border-radius:16px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:48px">🎉</div>
            <h2 style="color:#18A96A;margin:8px 0">EduSpace.tj</h2>
          </div>

          <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:16px">
            <h3 style="color:#042C53;margin:0 0 12px">Поздравляем, ${firstName}!</h3>
            <p style="color:#4A5E52;line-height:1.7;margin:0 0 16px">
              Ваш профиль преподавателя прошёл проверку и теперь виден всем ученикам на EduSpace.tj.
            </p>
            <p style="color:#4A5E52;line-height:1.7;margin:0 0 8px">Теперь вы можете:</p>
            <ul style="color:#4A5E52;line-height:2;padding-left:20px;margin:0 0 20px">
              <li>Получать записи от учеников</li>
              <li>Общаться с ними через чат</li>
              <li>Добавлять новые курсы</li>
              <li>Управлять своим расписанием</li>
            </ul>
            <div style="text-align:center">
              <a href="${dashUrl}" style="background:#18A96A;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">
                Перейти в кабинет →
              </a>
            </div>
          </div>

          <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:16px">
            <h3 style="color:#042C53;margin:0 0 12px">Табрик, ${firstName}!</h3>
            <p style="color:#4A5E52;line-height:1.7;margin:0 0 16px">
              Профили муаллими шумо тасдиқ карда шуд ва ҳоло барои ҳамаи хонандагон дар EduSpace.tj намоён аст.
            </p>
            <ul style="color:#4A5E52;line-height:2;padding-left:20px;margin:0 0 16px">
              <li>Аз хонандагон дархостҳо қабул кунед</li>
              <li>Бо хонандагон чат кунед</li>
              <li>Курсҳои нав илова кунед</li>
            </ul>
          </div>

          <p style="color:#999;font-size:12px;text-align:center;margin:0">
            EduSpace.tj · Душанбе, Тоҷикистон · <a href="mailto:eduspacedushanbe@gmail.com" style="color:#18A96A">eduspacedushanbe@gmail.com</a>
          </p>
        </div>`;
    }

    const subjectLine = isEnglish
        ? 'Your profile is approved on EduSpace.tj 🎉 | Профили шумо тасдиқ шуд'
        : 'Ваш профиль одобрен на EduSpace.tj 🎉 | Профили шумо тасдиқ шуд';

    await sendEmail({ to: email, subject: subjectLine, html });
}

// ─── GET /api/users/favorites ─────────────────────────────────────
// POST /api/users/profile/photo — загрузить аватарку студента
router.post('/profile/photo', auth, uploadPhoto.single('photo'), async (req, res) => {
    try {
        if (!req.file || !req.file.path) return res.status(400).json({ error: 'Файл не загружен' });
        const url = req.file.path;
        await db.query('UPDATE users SET avatar_url = ? WHERE id = ?', [url, req.user.id]);
        res.json({ avatarUrl: url });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка загрузки фото' }); }
});

router.get('/favorites', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.id, u.first_name, u.last_name, u.initials, u.color, u.avatar_url,
                    tp.subject, tp.rating, tp.review_count, tp.price, tp.student_count, tp.is_moderated
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
            `SELECT u.id, u.first_name, u.last_name, u.email, u.created_at, u.avatar_url, u.initials, u.color,
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
        // Отправляем письмо об одобрении
        try {
            const [u] = await db.query(
                `SELECT u.email, u.first_name, tp.subject
                 FROM users u
                 JOIN teacher_profiles tp ON tp.user_id = u.id
                 WHERE u.id = ?`,
                [req.params.userId]
            );
            if (u.length) {
                await sendApprovedEmail({
                    email: u[0].email,
                    firstName: u[0].first_name,
                    subject: u[0].subject || ''
                });
                console.log('✅ Письмо об одобрении отправлено:', u[0].email);
            }
        } catch(e) { console.error('Approval email error:', e.message); }

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
            `SELECT u.id, u.first_name, u.last_name, u.email, u.created_at, u.avatar_url, u.initials, u.color,
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


// POST /api/users/admin/verify-doc/:docId — одобрить документ
router.post('/admin/verify-doc/:docId', auth, adminOnly, async (req, res) => {
    try {
        await db.query('UPDATE teacher_documents SET is_verified=1 WHERE id=?', [req.params.docId]);
        res.json({ message: 'Документ одобрен' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// POST /api/users/reviews — оставить отзыв
router.post('/reviews', auth, async (req, res) => {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Только ученики могут оставлять отзывы' });
    const { teacherId, courseId, stars, text } = req.body;
    if (!stars || stars < 1 || stars > 5) return res.status(400).json({ error: 'Оценка от 1 до 5' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'Напишите текст отзыва' });
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id=?', [teacherId]);
        if (!tp.length) return res.status(404).json({ error: 'Учитель не найден' });
        
        const { randomUUID } = require('crypto');

        // Если courseId не передан — ищем любой курс этого учителя у студента
        let safeCourseId = courseId || null;
        if (!safeCourseId) {
            const [enroll] = await db.query(
                'SELECT course_id FROM enrollments WHERE student_id=? AND teacher_id=? LIMIT 1',
                [req.user.id, tp[0].id]
            );
            if (enroll.length) safeCourseId = enroll[0].course_id;
        }
        // Если совсем нет курса — берём любой курс этого учителя
        if (!safeCourseId) {
            const [anyCourse] = await db.query(
                'SELECT id FROM courses WHERE teacher_id=? AND status=\'active\' LIMIT 1',
                [tp[0].id]
            );
            if (anyCourse.length) safeCourseId = anyCourse[0].id;
        }
        // Если курсов нет вообще — возвращаем ошибку
        if (!safeCourseId) {
            return res.status(400).json({ error: 'У преподавателя нет курсов для отзыва' });
        }

        // Проверяем есть ли уже отзыв от этого студента этому учителю
        const [existing] = await db.query(
            'SELECT id FROM reviews WHERE student_id=? AND teacher_id=?',
            [req.user.id, tp[0].id]
        );
        if (existing.length) {
            await db.query(
                'UPDATE reviews SET stars=?, text=?, created_at=NOW() WHERE student_id=? AND teacher_id=?',
                [stars, text.trim(), req.user.id, tp[0].id]
            );
        } else {
            await db.query(
                'INSERT INTO reviews (id, student_id, teacher_id, course_id, stars, text) VALUES (?,?,?,?,?,?)',
                [randomUUID(), req.user.id, tp[0].id, safeCourseId, stars, text.trim()]
            );
        }
        
        // Update teacher rating
        const [ratingRes] = await db.query(
            'SELECT AVG(stars) as avg, COUNT(*) as cnt FROM reviews WHERE teacher_id=?', [tp[0].id]
        );
        await db.query(
            'UPDATE teacher_profiles SET rating=?, review_count=? WHERE id=?',
            [parseFloat(ratingRes[0].avg||0).toFixed(2), ratingRes[0].cnt, tp[0].id]
        );

        // Уведомление учителю о новом/обновлённом отзыве
        try {
            const [studentInfo] = await db.query('SELECT first_name, last_name FROM users WHERE id=?', [req.user.id]);
            const sName = studentInfo.length ? studentInfo[0].first_name + ' ' + studentInfo[0].last_name : 'Ученик';
            const isUpdate = existing.length > 0;
            await db.query(
                'INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?,?,?,?,?,?)',
                [randomUUID(), teacherId, 'review_comment',
                 isUpdate ? '⭐ Ученик обновил отзыв' : '⭐ Новый отзыв!',
                 `${sName} оставил${isUpdate ? ' обновлённый' : ''} отзыв — ${stars} ${stars === 1 ? 'звезда' : stars < 5 ? 'звезды' : 'звёзд'}`,
                 req.user.id]
            );
        } catch(notifErr) { console.error('notif error:', notifErr.message); }

        res.json({ message: 'Отзыв добавлен' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// GET /api/users/reviews/:reviewId/comments — получить комментарии (студент)
router.get('/reviews/:reviewId/comments', auth, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT rc.id, rc.text, rc.author_role, rc.created_at,
                   u.first_name, u.last_name, u.initials, u.color, u.avatar_url
            FROM review_comments rc
            JOIN users u ON u.id = rc.author_id
            WHERE rc.review_id = ?
            ORDER BY rc.created_at ASC
        `, [req.params.reviewId]);
        res.json(rows.map(r => ({
            id: r.id, text: r.text, role: r.author_role, date: r.created_at,
            author: {
                name: r.first_name + ' ' + r.last_name,
                initials: r.initials || (r.first_name[0]||'') + (r.last_name[0]||''),
                color: r.color || '#18A96A',
                avatarUrl: r.avatar_url || null
            }
        })));
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// GET /api/users/chat/:teacherId — получить сообщения
router.get('/chat/:teacherId', auth, async (req, res) => {
    try {
        const otherId = req.params.teacherId;
        const myId = req.user.id;
        const [msgs] = await db.query(
            `SELECT * FROM chat_messages
             WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
             ORDER BY created_at ASC LIMIT 100`,
            [myId, otherId, otherId, myId]
        );
        // Mark as read
        await db.query('UPDATE chat_messages SET is_read=1 WHERE receiver_id=? AND sender_id=?', [myId, otherId]);
        res.json(msgs);
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// POST /api/users/chat/:teacherId — отправить сообщение
router.post('/chat/:teacherId', auth, async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Пустое сообщение' });
    try {
        const { randomUUID } = require('crypto');
        const receiverId = req.params.teacherId;
        const senderId   = req.user.id;
        const msgText    = text.trim();

        // Insert message
        await db.query(
            'INSERT INTO chat_messages (id, sender_id, receiver_id, text) VALUES (?,?,?,?)',
            [randomUUID(), senderId, receiverId, msgText]
        );

        // Check if there's already an unread notification for this conversation
        // Only notify if this is the FIRST unread message (avoid notification spam)
        const [unread] = await db.query(
            'SELECT COUNT(*) as cnt FROM chat_messages WHERE sender_id=? AND receiver_id=? AND is_read=0',
            [senderId, receiverId]
        );

        // Данные отправителя
        const [sender] = await db.query(
            'SELECT first_name, last_name, role FROM users WHERE id=?', [senderId]
        );
        if (sender.length) {
            const name = sender[0].first_name + ' ' + sender[0].last_name;
            const preview = msgText.length > 50 ? msgText.substring(0, 50) + '...' : msgText;

            // Уведомление в кабинет — только если нет непрочитанных (не спамим)
            if (unread[0].cnt <= 1) {
                await db.query(
                    'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                    [randomUUID(), receiverId, 'new_message',
                     '💬 Новое сообщение от ' + name,
                     preview]
                );
            }

                // Email на почту — если отправитель администратор
                if (sender[0].role === 'admin') {
                    try {
                        console.log('📧 Отправляем email учителю, receiverId:', receiverId);
                        const [receiver] = await db.query(
                            'SELECT email, first_name FROM users WHERE id=?', [receiverId]
                        );
                        if (!receiver.length) {
                            console.log('❌ Получатель не найден:', receiverId);
                        } else {
                            console.log('📧 Получатель:', receiver[0].email);
                            const { Resend } = require('resend');
                            const resend = new Resend(process.env.RESEND_API_KEY);
                            const dashUrl = 'https://eduspace.tj/#teacher-dash';
                            await resend.emails.send({
                                from: process.env.FROM_EMAIL || 'EduSpace.tj <onboarding@resend.dev>',
                                to: receiver[0].email,
                                subject: '💬 Сообщение от администрации EduSpace.tj',
                                html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f9fafb;padding:32px;border-radius:16px">
                              <div style="text-align:center;margin-bottom:20px"><h2 style="color:#18A96A;margin:0">EduSpace.tj</h2></div>
                              <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:16px">
                                <h3 style="color:#042C53;margin:0 0 12px">💬 Новое сообщение от администратора</h3>
                                <p style="color:#4A5E52;line-height:1.7;margin:0 0 16px">
                                  Здравствуйте, <b>${receiver[0].first_name}</b>!<br>
                                  Администрация EduSpace.tj отправила вам сообщение:
                                </p>
                                <div style="background:#F0FDF4;border-left:4px solid #18A96A;padding:14px 18px;border-radius:0 8px 8px 0;color:#065F46;font-size:15px;line-height:1.7;margin-bottom:20px">${msgText}</div>
                                <div style="text-align:center">
                                  <a href="${dashUrl}" style="background:#18A96A;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">Ответить в кабинете →</a>
                                </div>
                              </div>
                              <p style="color:#999;font-size:12px;text-align:center;margin:0">EduSpace.tj · Душанбе, Тоҷикистон</p>
                            </div>`
                            });
                            console.log('✅ Email отправлен:', receiver[0].email);
                        }
                    } catch(emailErr) {
                        console.error('Chat email error:', emailErr.message, emailErr.stack);
                    }
                }
        }

        res.json({ message: 'Отправлено' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// GET /api/users/chats — все чаты пользователя
router.get('/chats', auth, async (req, res) => {
    try {
        const myId = req.user.id;

        // Step 1: get unique conversation partners
        const [partners] = await db.query(
            `SELECT DISTINCT
                CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other_id
             FROM chat_messages
             WHERE sender_id = ? OR receiver_id = ?`,
            [myId, myId, myId]
        );

        if (!partners.length) return res.json([]);

        // Step 2: for each partner get user info + last message + unread count
        const results = [];
        for (const p of partners) {
            const otherId = p.other_id;

            const [[user]] = await db.query(
                `SELECT id, first_name, last_name, initials, color, avatar_url FROM users WHERE id = ?`,
                [otherId]
            );
            if (!user) continue;

            const [[lastMsgRow]] = await db.query(
                `SELECT text, created_at FROM chat_messages
                 WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
                 ORDER BY created_at DESC LIMIT 1`,
                [myId, otherId, otherId, myId]
            );

            const [[unreadRow]] = await db.query(
                `SELECT COUNT(*) AS cnt FROM chat_messages
                 WHERE receiver_id = ? AND sender_id = ? AND is_read = 0`,
                [myId, otherId]
            );

            results.push({
                id:         user.id,
                first_name: user.first_name,
                last_name:  user.last_name,
                initials:   user.initials,
                color:      user.color,
                avatar_url: user.avatar_url,
                last_msg:   lastMsgRow ? lastMsgRow.text : '',
                last_time:  lastMsgRow ? lastMsgRow.created_at : null,
                unread:     unreadRow.cnt || 0,
            });
        }

        // Sort by last message time descending
        results.sort((a, b) => new Date(b.last_time) - new Date(a.last_time));

        res.json(results);
    } catch(err) { console.error('GET /chats error:', err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// ─── GET /api/users/admin/students ────────────────────────
// Список всех студентов
router.get('/admin/students', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
    try {
        const [students] = await db.query(`
            SELECT u.id, u.first_name, u.last_name, u.email, u.initials, u.color, u.avatar_url, u.created_at, u.is_active,
                   sp.balance, sp.total_spent,
                   COUNT(DISTINCT e.id) AS courses_count
            FROM users u
            LEFT JOIN student_profiles sp ON sp.user_id = u.id
            LEFT JOIN enrollments e ON e.student_id = u.id
            WHERE u.role = 'student'
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `);
        res.json(students);
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// ─── POST /admin/block/:userId — скрыть учителя ──────────
router.post('/admin/block/:userId', auth, adminOnly, async (req, res) => {
    try {
        await db.query('UPDATE teacher_profiles SET is_visible=0 WHERE user_id=?', [req.params.userId]);
        res.json({ message: 'Учитель скрыт' });
    } catch(err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /admin/unblock/:userId — показать учителя ───────
router.post('/admin/unblock/:userId', auth, adminOnly, async (req, res) => {
    try {
        await db.query('UPDATE teacher_profiles SET is_visible=1 WHERE user_id=?', [req.params.userId]);
        res.json({ message: 'Учитель показан' });
    } catch(err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── DELETE /admin/teacher/:userId — удалить учителя ──────
router.delete('/admin/teacher/:userId', auth, adminOnly, async (req, res) => {
    try {
        await db.query('DELETE FROM users WHERE id=?', [req.params.userId]);
        res.json({ message: 'Учитель удалён' });
    } catch(err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /admin/hide-student/:userId — скрыть студента ───
router.post('/admin/hide-student/:userId', auth, adminOnly, async (req, res) => {
    try {
        // is_active=2 означает "заблокирован администратором"
        await db.query('UPDATE users SET is_active=2 WHERE id=?', [req.params.userId]);
        res.json({ message: 'Студент скрыт' });
    } catch(err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /admin/show-student/:userId — показать студента ─
router.post('/admin/show-student/:userId', auth, adminOnly, async (req, res) => {
    try {
        await db.query('UPDATE users SET is_active=1 WHERE id=?', [req.params.userId]);
        res.json({ message: 'Студент показан' });
    } catch(err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── DELETE /admin/student/:userId — удалить студента ─────
router.delete('/admin/student/:userId', auth, adminOnly, async (req, res) => {
    try {
        await db.query('DELETE FROM users WHERE id=?', [req.params.userId]);
        res.json({ message: 'Студент удалён' });
    } catch(err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
