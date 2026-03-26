const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { auth, teacherOnly, studentOnly } = require('../middleware/auth');
const { randomUUID } = require('crypto');


// ─── Авто-создание новых таблиц при старте ────────────────────────
const db_module = require('../db');
(async () => {
    try {
        // Без FOREIGN KEY — совместимо с любым charset
        await db_module.query(`CREATE TABLE IF NOT EXISTS lesson_progress (
            id         VARCHAR(36)  NOT NULL PRIMARY KEY,
            student_id VARCHAR(36)  NOT NULL,
            lesson_id  VARCHAR(36)  NOT NULL,
            course_id  VARCHAR(36)  NOT NULL,
            is_done    TINYINT(1)   DEFAULT 0,
            done_at    DATETIME     DEFAULT NULL,
            created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_progress (student_id, lesson_id),
            INDEX idx_course (course_id),
            INDEX idx_student (student_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

        await db_module.query(`CREATE TABLE IF NOT EXISTS homework (
            id              VARCHAR(36)  NOT NULL PRIMARY KEY,
            course_id       VARCHAR(36)  NOT NULL,
            lesson_id       VARCHAR(36)  DEFAULT NULL,
            teacher_id      VARCHAR(36)  NOT NULL,
            student_id      VARCHAR(36)  DEFAULT NULL,
            title           VARCHAR(300) NOT NULL,
            description     TEXT,
            due_date        DATE         DEFAULT NULL,
            file_url        VARCHAR(500) DEFAULT NULL,
            status          VARCHAR(20)  DEFAULT 'pending',
            student_answer  TEXT,
            teacher_comment TEXT,
            created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_course  (course_id),
            INDEX idx_student (student_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

        await db_module.query(`CREATE TABLE IF NOT EXISTS schedule (
            id            VARCHAR(36)  NOT NULL PRIMARY KEY,
            enrollment_id VARCHAR(36)  NOT NULL,
            course_id     VARCHAR(36)  NOT NULL,
            student_id    VARCHAR(36)  NOT NULL,
            teacher_id    VARCHAR(36)  NOT NULL,
            day_of_week   VARCHAR(10)  DEFAULT NULL,
            time_from     VARCHAR(10)  DEFAULT NULL,
            time_to       VARCHAR(10)  DEFAULT NULL,
            platform      VARCHAR(50)  DEFAULT NULL,
            link          VARCHAR(500) DEFAULT NULL,
            notes         TEXT,
            created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
            updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_student     (student_id),
            INDEX idx_course      (course_id),
            INDEX idx_enrollment  (enrollment_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

        await db_module.query(`CREATE TABLE IF NOT EXISTS course_materials (
            id          VARCHAR(36)  NOT NULL PRIMARY KEY,
            course_id   VARCHAR(36)  NOT NULL,
            lesson_id   VARCHAR(36)  DEFAULT NULL,
            teacher_id  VARCHAR(36)  NOT NULL,
            title       VARCHAR(300) NOT NULL,
            description TEXT,
            file_url    VARCHAR(500) DEFAULT NULL,
            file_type   VARCHAR(50)  DEFAULT NULL,
            file_size   INT          DEFAULT NULL,
            created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_course  (course_id),
            INDEX idx_teacher (teacher_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

        console.log('✅ Таблицы lesson_progress, homework, schedule, course_materials готовы');

        // Добавляем колонки ответов учителя на отзывы (если не существуют)
        try {
            await db_module.query('ALTER TABLE reviews ADD COLUMN teacher_reply TEXT DEFAULT NULL');
            console.log('✅ Колонка teacher_reply добавлена');
        } catch(e) { console.log('✅ Колонка teacher_reply уже существует'); }
        try {
            await db_module.query('ALTER TABLE reviews ADD COLUMN replied_at DATETIME DEFAULT NULL');
            console.log('✅ Колонка replied_at добавлена');
        } catch(e) { console.log('✅ Колонка replied_at уже существует'); }

        // Таблица комментариев к отзывам (цепочка учитель ↔ ученик)
        await db_module.query(`CREATE TABLE IF NOT EXISTS review_comments (
            id          VARCHAR(36)  PRIMARY KEY,
            review_id   VARCHAR(36)  NOT NULL,
            author_id   VARCHAR(36)  NOT NULL,
            author_role ENUM('teacher','student') NOT NULL,
            text        TEXT         NOT NULL,
            created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_review (review_id),
            FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
            FOREIGN KEY (author_id) REFERENCES users(id)   ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        console.log('✅ Таблица review_comments готова');

        // Таблица токенов сброса пароля
        await db_module.query(`CREATE TABLE IF NOT EXISTS password_resets (
            id         VARCHAR(36)  PRIMARY KEY,
            user_id    VARCHAR(36)  NOT NULL UNIQUE,
            token      VARCHAR(64)  NOT NULL UNIQUE,
            expires_at DATETIME     NOT NULL,
            created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        console.log('✅ Таблица password_resets готова');

        // Колонка link для уведомлений (переход к контексту)
        try {
            await db_module.query('ALTER TABLE notifications ADD COLUMN link VARCHAR(100) DEFAULT NULL');
            console.log('✅ Колонка notifications.link добавлена');
        } catch(e) { console.log('✅ Колонка notifications.link уже существует'); }

    } catch(e) {
        console.error('⚠️  Авто-миграция:', e.message);
    }
})();

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


// ═══════════════════════════════════════════════════════
// СТРАНИЦА КУРСА — полные данные для ученика
// ═══════════════════════════════════════════════════════

// GET /api/courses/:id/my — данные курса для записавшегося ученика
router.get('/:id/my', auth, async (req, res) => {
    try {
        const courseId   = req.params.id;
        const studentId  = req.user.id;

        // Проверяем запись
        const [enroll] = await db.query(
            `SELECT e.*, tp.work_days, tp.work_hours, tp.platforms, tp.conditions
             FROM enrollments e
             JOIN teacher_profiles tp ON tp.id = e.teacher_id
             WHERE e.course_id = ? AND e.student_id = ?`, [courseId, studentId]
        );
        if (!enroll.length) return res.status(403).json({ error: 'Вы не записаны на этот курс' });
        const enrollment = enroll[0];

        // Курс + уроки
        const [courseRows] = await db.query(
            `SELECT c.*, u.first_name, u.last_name, u.initials, u.color, u.avatar_url, u.id as teacher_user_id
             FROM courses c
             JOIN teacher_profiles tp ON tp.id = c.teacher_id
             JOIN users u ON u.id = tp.user_id
             WHERE c.id = ?`, [courseId]
        );
        if (!courseRows.length) return res.status(404).json({ error: 'Курс не найден' });
        const course = courseRows[0];

        const [lessons] = await db.query(
            'SELECT id, title, order_num FROM course_lessons WHERE course_id = ? ORDER BY order_num',
            [courseId]
        );

        // Прогресс уроков
        const [progress] = await db.query(
            'SELECT lesson_id, is_done, done_at FROM lesson_progress WHERE student_id = ? AND course_id = ?',
            [studentId, courseId]
        );
        const progressMap = {};
        progress.forEach(p => { progressMap[p.lesson_id] = { isDone: !!p.is_done, doneAt: p.done_at }; });

        // Домашние задания
        let hw = [];
        try {
            const [hwRows] = await db.query(
                `SELECT h.*, cl.title as lesson_title
                 FROM homework h
                 LEFT JOIN course_lessons cl ON cl.id = h.lesson_id
                 WHERE h.course_id = ? AND (h.student_id = ? OR h.student_id IS NULL)
                 ORDER BY h.created_at DESC`,
                [courseId, studentId]
            );
            hw = hwRows;
        } catch(e) { console.log('homework query skipped:', e.message); }

        // Материалы
        let materials = [];
        try {
            const [matRows] = await db.query(
                `SELECT m.id, m.title, m.description, m.file_url, m.file_type, m.file_size,
                        m.created_at, cl.title as lesson_title
                 FROM course_materials m
                 LEFT JOIN course_lessons cl ON cl.id = m.lesson_id
                 WHERE m.course_id = ?
                 ORDER BY m.created_at DESC`,
                [courseId]
            );
            materials = matRows;
            console.log('Materials found:', matRows.length, 'for course:', courseId);
        } catch(e) { console.log('materials query error:', e.message); }

        // Расписание
        const [sched] = await db.query(
            'SELECT * FROM schedule WHERE enrollment_id = ?',
            [enrollment.id]
        );

        const safeJson = (v, d) => { if (!v) return d; try { return JSON.parse(v); } catch { return d; } };
        const doneLessons = lessons.filter(l => progressMap[l.id]?.isDone).length;

        res.json({
            course: {
                id: course.id, title: course.title, description: course.description,
                category: course.category, level: course.level, price: parseFloat(course.price),
                emoji: course.emoji,
                teacher: {
                    id: course.teacher_user_id, firstName: course.first_name, lastName: course.last_name,
                    initials: course.initials, color: course.color, avatarUrl: course.avatar_url,
                },
            },
            enrollment: {
                id: enrollment.id, enrolledAt: enrollment.enrolled_at, status: enrollment.status,
                pricePaid: parseFloat(enrollment.price_paid),
            },
            teacher: {
                workDays: safeJson(enrollment.work_days, []),
                workHours: enrollment.work_hours,
                platforms: safeJson(enrollment.platforms, []),
                conditions: safeJson(enrollment.conditions, {}),
            },
            lessons: lessons.map(l => ({
                id: l.id, title: l.title, order: l.order_num,
                isDone: !!(progressMap[l.id]?.isDone),
                doneAt: progressMap[l.id]?.doneAt || null,
            })),
            progress: {
                total: lessons.length,
                done: doneLessons,
                percent: lessons.length > 0 ? Math.round((doneLessons / lessons.length) * 100) : 0,
            },
            homework: hw.map(h => ({
                id: h.id, title: h.title, description: h.description,
                lessonTitle: h.lesson_title, dueDate: h.due_date, fileUrl: h.file_url,
                status: h.status, studentAnswer: h.student_answer, teacherComment: h.teacher_comment,
                createdAt: h.created_at,
            })),
            materials: materials.map(m => ({
                id: m.id, title: m.title, description: m.description,
                fileUrl: m.file_url, fileType: m.file_type, fileSize: m.file_size,
                lessonTitle: m.lesson_title, createdAt: m.created_at,
            })),
            schedule: sched.map(s => ({
                id: s.id, dayOfWeek: s.day_of_week, timeFrom: s.time_from, timeTo: s.time_to,
                platform: s.platform, link: s.link, notes: s.notes,
            })),
        });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// POST /api/courses/:id/progress — отметить урок выполненным
router.post('/:id/progress', auth, async (req, res) => {
    const { lessonId, isDone } = req.body;
    if (!lessonId) return res.status(400).json({ error: 'lessonId обязателен' });
    try {
        const { randomUUID } = require('crypto');
        await db.query(
            `INSERT INTO lesson_progress (id, student_id, lesson_id, course_id, is_done, done_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE is_done=?, done_at=?`,
            [randomUUID(), req.user.id, lessonId, req.params.id,
             isDone ? 1 : 0, isDone ? new Date() : null,
             isDone ? 1 : 0, isDone ? new Date() : null]
        );
        // Recalculate progress
        const [total]  = await db.query('SELECT COUNT(*) as cnt FROM course_lessons WHERE course_id=?', [req.params.id]);
        const [done]   = await db.query('SELECT COUNT(*) as cnt FROM lesson_progress WHERE student_id=? AND course_id=? AND is_done=1', [req.user.id, req.params.id]);
        const percent  = total[0].cnt > 0 ? Math.round((done[0].cnt / total[0].cnt) * 100) : 0;
        res.json({ lessonId, isDone, done: done[0].cnt, total: total[0].cnt, percent });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// POST /api/courses/:id/homework/submit — ученик сдаёт ДЗ
router.post('/:id/homework/:hwId/submit', auth, async (req, res) => {
    const { answer } = req.body;
    if (!answer) return res.status(400).json({ error: 'Ответ обязателен' });
    try {
        await db.query(
            'UPDATE homework SET student_answer=?, status=?, updated_at=NOW() WHERE id=? AND course_id=?',
            [answer, 'submitted', req.params.hwId, req.params.id]
        );
        res.json({ message: 'Домашнее задание сдано' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// POST /api/courses/:id/schedule — сохранить расписание (учитель)
router.post('/:id/schedule', auth, async (req, res) => {
    const { enrollmentId, studentId, days } = req.body;
    if (!enrollmentId || !days) return res.status(400).json({ error: 'Неверные данные' });
    try {
        const { randomUUID } = require('crypto');
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id=?', [req.user.id]);
        if (!tp.length) return res.status(403).json({ error: 'Только для преподавателей' });
        // Delete old schedule for this enrollment
        await db.query('DELETE FROM schedule WHERE enrollment_id=?', [enrollmentId]);
        // Insert new
        for (const d of days) {
            await db.query(
                'INSERT INTO schedule (id, enrollment_id, course_id, student_id, teacher_id, day_of_week, time_from, time_to, platform, link, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [randomUUID(), enrollmentId, req.params.id, studentId, tp[0].id,
                 d.dayOfWeek, d.timeFrom, d.timeTo, d.platform||'', d.link||'', d.notes||'']
            );
        }
        res.json({ message: 'Расписание сохранено' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
