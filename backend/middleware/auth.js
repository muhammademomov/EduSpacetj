const jwt = require('jsonwebtoken');
const db = require('../db');

const auth = async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Нет токена авторизации' });
    }
    const token = header.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await db.query(
            'SELECT id, email, role, first_name, last_name, initials, color FROM users WHERE id = ? AND is_active = 1',
            [decoded.id]
        );
        if (!rows.length) return res.status(401).json({ error: 'Пользователь не найден' });
        req.user = rows[0];
        next();
    } catch {
        return res.status(401).json({ error: 'Токен недействителен или истёк' });
    }
};

const studentOnly = (req, res, next) => {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Только для учеников' });
    next();
};
const teacherOnly = (req, res, next) => {
    if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Только для преподавателей' });
    next();
};
const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только для администраторов' });
    next();
};

module.exports = { auth, studentOnly, teacherOnly, adminOnly };
