// Запустите ПОСЛЕ деплоя на Railway:
// railway run node db/init.js
// или локально: node db/init.js (с заполненным .env)

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

async function init() {
    // Определяем конфиг — Railway или локально
    let config;
    if (process.env.DATABASE_URL) {
        const url = new URL(process.env.DATABASE_URL);
        config = {
            host: url.hostname, port: parseInt(url.port)||3306,
            user: url.username, password: url.password,
            database: url.pathname.slice(1),
            multipleStatements: true,
            ssl: { rejectUnauthorized: false },
        };
    } else {
        config = {
            host:     process.env.MYSQLHOST     || process.env.DB_HOST     || 'localhost',
            port:     parseInt(process.env.MYSQLPORT || process.env.DB_PORT || '3306'),
            user:     process.env.MYSQLUSER     || process.env.DB_USER     || 'root',
            password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
            database: process.env.MYSQLDATABASE || process.env.DB_NAME     || 'eduspace',
            multipleStatements: true,
        };
    }

    const conn = await mysql.createConnection(config);
    console.log('✅ Подключено к MySQL');

    // Если не Railway — создаём БД
    if (!process.env.DATABASE_URL) {
        await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await conn.execute(`USE \`${config.database}\``);
    }

    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await conn.query(sql);
    // Add video_url column if not exists
    await conn.query('ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS video_url VARCHAR(500) DEFAULT NULL').catch(function(){});
    console.log('✅ Таблицы созданы');

    // Администратор
    const hash = await bcrypt.hash('admin123', 10);
    await conn.execute(
        `INSERT IGNORE INTO users (id, first_name, last_name, email, phone, password_hash, role, color, initials)
         VALUES (?, 'Admin', 'EduSpace', 'admin@eduspace.tj', '000000000', ?, 'admin', '#7C3AED', 'AE')`,
        [randomUUID(), hash]
    );
    console.log('✅ Администратор: admin@eduspace.tj / admin123');

    await conn.end();
    console.log('\n🎉 Готово! Сайт работает.\n');
}

init().catch(err => { console.error('❌', err.message); process.exit(1); });
