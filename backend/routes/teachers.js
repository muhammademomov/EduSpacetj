const express = require('express');
const router = express.Router();
const db      = require('../db');
const { auth, teacherOnly } = require('../middleware/auth');
const { randomUUID } = require('crypto');
const { uploadPhoto, uploadDoc, uploadMaterial } = require('../cloudinary');

const safeJson = (v, d=[]) => { if (!v) return d; try { return JSON.parse(v); } catch { return d; } };

// ─── GET /api/teachers ─────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { search, sort = 'new', subject, level, platform } = req.query;
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
        if (subject) {
            const subjects = subject.split(',').map(s => s.trim()).filter(Boolean);
            if (subjects.length === 1) {
                sql += ' AND tp.subject LIKE ?';
                params.push('%' + subjects[0] + '%');
            } else if (subjects.length > 1) {
                sql += ' AND (' + subjects.map(() => 'tp.subject LIKE ?').join(' OR ') + ')';
                subjects.forEach(s => params.push('%' + s + '%'));
            }
        }
        if (platform) {
            sql += ' AND tp.platforms LIKE ?';
            params.push('%' + platform + '%');
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
        // Safely check if teacher_reply column exists before querying
        let reviewRows = [];
        try {
            const [cols] = await db.query(
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews' AND COLUMN_NAME = 'teacher_reply'`
            );
            const hasReplyCol = cols.length > 0;
            const replySelect = hasReplyCol ? ', r.teacher_reply, r.replied_at' : ', NULL AS teacher_reply, NULL AS replied_at';
            const [rows] = await db.query(
                `SELECT r.id, r.stars, r.text, r.tags, r.created_at${replySelect},
                        u.first_name, u.last_name, u.initials, u.color, c.title AS course_title
                 FROM reviews r
                 JOIN users u ON u.id = r.student_id
                 LEFT JOIN courses c ON c.id = r.course_id
                 WHERE r.teacher_id = ? ORDER BY r.created_at DESC`, [t.profile_id]
            );
            reviewRows = rows;
        } catch(reviewErr) {
            console.error('Reviews query error:', reviewErr.message);
            reviewRows = [];
        }

        res.json({
            ...fmt(t),
            courses: courses.map(c => ({ ...c, rating: parseFloat(c.rating)||0 })),
            documents: docs.map(d => ({ id:d.id, type:d.doc_type, name:d.doc_name, institution:d.institution, year:d.year, fileUrl:d.file_url, isVerified:!!d.is_verified })),
            reviews: reviewRows.map(r => ({
                id:r.id, stars:r.stars, text:r.text, tags:safeJson(r.tags,[]),
                date:r.created_at, courseTitle:r.course_title,
                teacherReply:r.teacher_reply||null, repliedAt:r.replied_at||null,
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
            `SELECT u.id, u.first_name, u.last_name, u.initials, u.color, u.avatar_url,
                    c.id AS course_id, c.title AS course_title, c.emoji, c.category,
                    e.id AS enrollment_id, e.enrolled_at, e.price_paid, e.teacher_amount, e.status
             FROM enrollments e
             JOIN users u ON u.id = e.student_id
             JOIN courses c ON c.id = e.course_id
             WHERE e.teacher_id = ? ORDER BY e.enrolled_at DESC`, [tp[0].id]
        );

        // Add progress for each student
        const result = [];
        for (const s of rows) {
            const [total]    = await db.query('SELECT COUNT(*) as cnt FROM course_lessons WHERE course_id=?', [s.course_id]);
            let done_cnt = 0;
            try {
                const [done] = await db.query(
                    'SELECT COUNT(*) as cnt FROM lesson_progress WHERE student_id=? AND course_id=? AND is_done=1',
                    [s.id, s.course_id]
                );
                done_cnt = done[0].cnt || 0;
            } catch(e) {} // table may not exist yet
            const pct = total[0].cnt > 0 ? Math.round((done_cnt / total[0].cnt) * 100) : 0;
            result.push({ ...s, progress: pct, totalLessons: total[0].cnt, doneLessons: done_cnt });
        }
        res.json(result);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// ─── GET /api/teachers/student/:studentId/course/:courseId ────────
// Страница ученика для учителя — полные данные
router.get('/student/:studentId/course/:courseId', auth, teacherOnly, async (req, res) => {
    try {
        const { studentId, courseId } = req.params;
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id=?', [req.user.id]);
        if (!tp.length) return res.status(403).json({ error: 'Нет профиля' });

        // Check enrollment belongs to this teacher
        const [enroll] = await db.query(
            'SELECT * FROM enrollments WHERE student_id=? AND course_id=? AND teacher_id=?',
            [studentId, courseId, tp[0].id]
        );
        if (!enroll.length) return res.status(404).json({ error: 'Запись не найдена' });
        const enrollment = enroll[0];

        // Student info
        const [[student]] = await db.query(
            'SELECT id, first_name, last_name, initials, color, avatar_url, email, phone FROM users WHERE id=?',
            [studentId]
        );

        // Course + lessons
        const [[course]] = await db.query('SELECT * FROM courses WHERE id=?', [courseId]);
        const [lessons]  = await db.query(
            'SELECT id, title, order_num FROM course_lessons WHERE course_id=? ORDER BY order_num',
            [courseId]
        );

        // Student progress
        let progress = [];
        try {
            const [p] = await db.query(
                'SELECT lesson_id, is_done, done_at FROM lesson_progress WHERE student_id=? AND course_id=?',
                [studentId, courseId]
            );
            progress = p;
        } catch(e) {}
        const progressMap = {};
        progress.forEach(p => { progressMap[p.lesson_id] = { isDone: !!p.is_done, doneAt: p.done_at }; });
        const doneLessons = lessons.filter(l => progressMap[l.id]?.isDone).length;

        // Homework
        let homework = [];
        try {
            const [hw] = await db.query(
                `SELECT h.*, cl.title as lesson_title FROM homework h
                  LEFT JOIN course_lessons cl ON cl.id = h.lesson_id
                  WHERE h.course_id=? AND (h.student_id=? OR h.student_id IS NULL)
                  ORDER BY h.created_at DESC`,
                [courseId, studentId]
            );
            homework = hw;
        } catch(e) {}

        // Schedule
        let schedule = [];
        try {
            const [s] = await db.query('SELECT * FROM schedule WHERE enrollment_id=?', [enrollment.id]);
            schedule = s;
        } catch(e) {}

        // Materials
        let materials = [];
        try {
            const [mats] = await db.query(
                `SELECT m.*, cl.title as lesson_title FROM course_materials m
                  LEFT JOIN course_lessons cl ON cl.id = m.lesson_id
                  WHERE m.course_id=? ORDER BY m.created_at DESC`,
                [courseId]
            );
            materials = mats;
        } catch(e) {}

        res.json({
            student: { id: student.id, firstName: student.first_name, lastName: student.last_name,
                       initials: student.initials, color: student.color, avatarUrl: student.avatar_url,
                       email: student.email, phone: student.phone },
            course:  { id: course.id, title: course.title, emoji: course.emoji,
                       category: course.category, level: course.level },
            enrollment: { id: enrollment.id, enrolledAt: enrollment.enrolled_at,
                          pricePaid: parseFloat(enrollment.price_paid),
                          teacherAmount: parseFloat(enrollment.teacher_amount) },
            lessons:  lessons.map(l => ({ id: l.id, title: l.title, order: l.order_num,
                          isDone: !!(progressMap[l.id]?.isDone), doneAt: progressMap[l.id]?.doneAt })),
            progress: { total: lessons.length, done: doneLessons,
                        percent: lessons.length > 0 ? Math.round(doneLessons/lessons.length*100) : 0 },
            homework: homework.map(h => ({ id: h.id, title: h.title, description: h.description,
                          lessonTitle: h.lesson_title, dueDate: h.due_date, status: h.status,
                          studentAnswer: h.student_answer, teacherComment: h.teacher_comment,
                          createdAt: h.created_at })),
            schedule: schedule.map(s => ({ id: s.id, dayOfWeek: s.day_of_week,
                          timeFrom: s.time_from, timeTo: s.time_to,
                          platform: s.platform, link: s.link, notes: s.notes })),
            materials: materials.map(m => ({ id: m.id, title: m.title, description: m.description,
                          fileUrl: m.file_url, fileType: m.file_type, fileSize: m.file_size,
                          lessonTitle: m.lesson_title, createdAt: m.created_at })),
        });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/teachers/homework ─────────────────────────────────
// Учитель добавляет домашнее задание
router.post('/homework', auth, teacherOnly, async (req, res) => {
    const { courseId, studentId, lessonId, title, description, dueDate } = req.body;
    if (!courseId || !title) return res.status(400).json({ error: 'courseId и title обязательны' });
    try {
        const { randomUUID } = require('crypto');
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id=?', [req.user.id]);
        await db.query(
            `INSERT INTO homework (id, course_id, lesson_id, teacher_id, student_id, title, description, due_date)
             VALUES (?,?,?,?,?,?,?,?)`,
            [randomUUID(), courseId, lessonId||null, tp[0].id, studentId||null,
             title, description||null, dueDate||null]
        );
        // Notify student
        if (studentId) {
            await db.query(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                [randomUUID(), studentId, 'homework', '📝 Новое домашнее задание', title]
            );
        }
        res.json({ message: 'Задание добавлено' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── PUT /api/teachers/homework/:hwId/comment ─────────────────────
// Учитель проверяет ДЗ и оставляет комментарий
router.put('/homework/:hwId/comment', auth, teacherOnly, async (req, res) => {
    const { comment } = req.body;
    try {
        await db.query(
            'UPDATE homework SET teacher_comment=?, status=?, updated_at=NOW() WHERE id=?',
            [comment, 'reviewed', req.params.hwId]
        );
        res.json({ message: 'Комментарий добавлен' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// ─── POST /api/teachers/materials/upload ─────────────────────────
// Учитель загружает файл-материал для курса
router.post('/materials/upload', auth, teacherOnly, uploadMaterial.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Файл не выбран' });
        const { courseId, lessonId, title, description } = req.body;
        if (!courseId || !title) return res.status(400).json({ error: 'courseId и title обязательны' });

        const { randomUUID } = require('crypto');
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id=?', [req.user.id]);
        if (!tp.length) return res.status(403).json({ error: 'Нет профиля' });

        // Detect file type
        // Cloudinary returns different fields depending on resource_type
        const fileUrl  = req.file.secure_url || req.file.path || '';
        const fileName = req.file.originalname || req.file.public_id || '';
        const ext      = fileName.split('.').pop().toLowerCase().split('?')[0];
        const fileSize = req.file.size || req.file.bytes || 0;
        
        // For Cloudinary raw files, append original filename for proper download
        let downloadUrl = fileUrl;
        if (fileUrl && ext && !fileUrl.endsWith('.' + ext)) {
            // Add fl_attachment flag for raw files so browser downloads with proper name
            downloadUrl = fileUrl.replace('/upload/', '/upload/fl_attachment:' + fileName.replace(/[^a-zA-Z0-9._-]/g, '_') + '/');
        }
        console.log('Material uploaded:', { fileUrl, downloadUrl, fileName, ext, fileSize });

        await db.query(
            `INSERT INTO course_materials (id, course_id, lesson_id, teacher_id, title, description, file_url, file_type, file_size)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [randomUUID(), courseId, lessonId||null, tp[0].id,
             title, description||null, downloadUrl || fileUrl, ext, fileSize]
        );

        // Notify all students of this course
        try {
            const [enrolls] = await db.query(
                'SELECT student_id FROM enrollments WHERE course_id=? AND status=\'active\'',
                [courseId]
            );
            for (const e of enrolls) {
                await db.query(
                    'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                    [randomUUID(), e.student_id, 'new_material',
                     '📎 Новый материал к курсу', title]
                );
            }
        } catch(e) {}

        res.json({ message: 'Материал загружен', fileUrl, fileType: ext });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка загрузки: ' + err.message }); }
});

// ─── DELETE /api/teachers/materials/:id ──────────────────────────
router.delete('/materials/:id', auth, teacherOnly, async (req, res) => {
    try {
        await db.query('DELETE FROM course_materials WHERE id=?', [req.params.id]);
        res.json({ message: 'Материал удалён' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// ─── GET /api/teachers/my/reviews ─────────────────────────────────
// Учитель получает все свои отзывы
router.get('/my/reviews', auth, teacherOnly, async (req, res) => {
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id=?', [req.user.id]);
        if (!tp.length) return res.json([]);
        const teacherProfileId = tp[0].id;

        const [cols] = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews' AND COLUMN_NAME = 'teacher_reply'`
        );
        const hasReplyCol = cols.length > 0;
        const replySelect = hasReplyCol ? ', r.teacher_reply, r.replied_at' : ', NULL AS teacher_reply, NULL AS replied_at';

        const [rows] = await db.query(`
            SELECT r.id, r.stars, r.text, r.created_at${replySelect},
                   u.first_name, u.last_name, u.color,
                   c.title as course_title
            FROM reviews r
            JOIN users u ON u.id = r.student_id
            LEFT JOIN courses c ON c.id = r.course_id
            WHERE r.teacher_id = ?
            ORDER BY r.created_at DESC
        `, [teacherProfileId]);

        res.json(rows.map(r => ({
            id: r.id,
            stars: r.stars,
            text: r.text,
            date: r.created_at,
            teacherReply: r.teacher_reply || null,
            repliedAt: r.replied_at || null,
            courseTitle: r.course_title || null,
            student: {
                name: r.first_name + ' ' + r.last_name,
                initials: (r.first_name[0]||'') + (r.last_name[0]||''),
                color: r.color || '#18A96A'
            }
        })));
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// ─── GET /api/teachers/reviews/:reviewId/comments ──────────────────
// Получить все комментарии к отзыву
router.get('/reviews/:reviewId/comments', async (req, res) => {
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
            id: r.id,
            text: r.text,
            role: r.author_role,
            date: r.created_at,
            author: {
                name: r.first_name + ' ' + r.last_name,
                initials: r.initials || (r.first_name[0]||'') + (r.last_name[0]||''),
                color: r.color || '#18A96A',
                avatarUrl: r.avatar_url || null
            }
        })));
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── POST /api/teachers/reviews/:reviewId/comments ──────────────────
// Добавить комментарий к отзыву (учитель или ученик)
router.post('/reviews/:reviewId/comments', auth, async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Текст обязателен' });
    try {
        // Проверяем что отзыв существует и получаем участников
        const [revRows] = await db.query(`
            SELECT r.id, r.student_id, tp.user_id AS teacher_user_id,
                   u_s.first_name AS s_fname, u_s.last_name AS s_lname,
                   u_t.first_name AS t_fname, u_t.last_name AS t_lname
            FROM reviews r
            JOIN teacher_profiles tp ON tp.id = r.teacher_id
            JOIN users u_s ON u_s.id = r.student_id
            JOIN users u_t ON u_t.id = tp.user_id
            WHERE r.id = ?
        `, [req.params.reviewId]);
        if (!revRows.length) return res.status(404).json({ error: 'Отзыв не найден' });
        const rev = revRows[0];

        // Только студент-автор или учитель могут комментировать
        const isStudent = req.user.id === rev.student_id;
        const isTeacher = req.user.id === rev.teacher_user_id;
        if (!isStudent && !isTeacher) return res.status(403).json({ error: 'Нет доступа' });

        const role = isTeacher ? 'teacher' : 'student';
        const commentId = randomUUID();
        await db.query(
            'INSERT INTO review_comments (id, review_id, author_id, author_role, text) VALUES (?,?,?,?,?)',
            [commentId, req.params.reviewId, req.user.id, role, text.trim()]
        );

        // Уведомление другой стороне
        if (isTeacher) {
            // Учитель ответил → уведомить студента
            await db.query(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                [randomUUID(), rev.student_id, 'review_comment',
                 '💬 Новый ответ на ваш отзыв',
                 `${rev.t_fname} ${rev.t_lname} ответил на ваш отзыв`]
            );
        } else {
            // Студент ответил → уведомить учителя
            await db.query(
                'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?,?,?,?,?)',
                [randomUUID(), rev.teacher_user_id, 'review_comment',
                 '💬 Ответ ученика на ваш комментарий',
                 `${rev.s_fname} ${rev.s_lname} ответил в обсуждении отзыва`]
            );
        }

        res.json({ id: commentId, message: 'Комментарий добавлен' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── DELETE /api/teachers/reviews/:reviewId/comments/:commentId ─────
// Удалить свой комментарий
router.delete('/reviews/:reviewId/comments/:commentId', auth, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT author_id FROM review_comments WHERE id=?', [req.params.commentId]);
        if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
        if (rows[0].author_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
        await db.query('DELETE FROM review_comments WHERE id=?', [req.params.commentId]);
        res.json({ message: 'Удалено' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// ─── POST /api/teachers/reviews/:reviewId/reply ───────────────────
// Учитель отвечает на отзыв
router.post('/reviews/:reviewId/reply', auth, teacherOnly, async (req, res) => {
    const { reply } = req.body;
    if (!reply || !reply.trim()) return res.status(400).json({ error: 'Текст ответа обязателен' });
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id=?', [req.user.id]);
        if (!tp.length) return res.status(403).json({ error: 'Нет профиля' });

        // Проверяем что отзыв принадлежит этому учителю
        const [rev] = await db.query(
            'SELECT id FROM reviews WHERE id=? AND teacher_id=?',
            [req.params.reviewId, tp[0].id]
        );
        if (!rev.length) return res.status(404).json({ error: 'Отзыв не найден' });

        await db.query(
            'UPDATE reviews SET teacher_reply=?, replied_at=NOW() WHERE id=?',
            [reply.trim(), req.params.reviewId]
        );
        res.json({ message: 'Ответ добавлен' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
});


// ─── PUT /api/teachers/reviews/:reviewId/reply ────────────────────
// Учитель отвечает на отзыв
router.put('/reviews/:reviewId/reply', auth, teacherOnly, async (req, res) => {
    const { reply } = req.body;
    if (!reply || !reply.trim()) return res.status(400).json({ error: 'Ответ не может быть пустым' });
    try {
        const [tp] = await db.query('SELECT id FROM teacher_profiles WHERE user_id=?', [req.user.id]);
        if (!tp.length) return res.status(403).json({ error: 'Нет профиля' });

        // Проверяем что отзыв принадлежит этому учителю
        const [review] = await db.query(
            'SELECT id FROM reviews WHERE id=? AND teacher_id=?',
            [req.params.reviewId, tp[0].id]
        );
        if (!review.length) return res.status(404).json({ error: 'Отзыв не найден' });

        await db.query(
            'UPDATE reviews SET teacher_reply=?, replied_at=NOW() WHERE id=?',
            [reply.trim(), req.params.reviewId]
        );
        res.json({ message: 'Ответ сохранён' });
    } catch(err) { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); }
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
