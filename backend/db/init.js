require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

async function init() {
    const conn = await mysql.createConnection({
        host:     process.env.MYSQLHOST     || 'localhost',
        port:     parseInt(process.env.MYSQLPORT || '3306'),
        user:     process.env.MYSQLUSER     || 'root',
        password: process.env.MYSQLPASSWORD || '',
        database: process.env.MYSQLDATABASE || 'eduspace',
        multipleStatements: true,
    });

    console.log('✅ Подключено к MySQL');

    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await conn.query(sql);
    console.log('✅ Таблицы созданы');

    const hash = await bcrypt.hash('admin123', 10);
    await conn.query(
        `INSERT IGNORE INTO users (id, first_name, last_name, email, phone, password_hash, role, color, initials)
         VALUES (?, 'Admin', 'EduSpace', 'admin@eduspace.tj', '000000000', ?, 'admin', '#7C3AED', 'AE')`,
        [randomUUID(), hash]
    );
    console.log('✅ Администратор создан');

    await conn.end();
    console.log('🎉 Готово!');
}

init().catch(err => { console.error('❌', err.message); process.exit(1); });
