const mysql = require('mysql2/promise');
require('dotenv').config();

const url = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL;

let pool;
let ready = Promise.resolve();

if (process.env.DB_FILE) {
    // База — один файл на томе Railway (/data). Отдельный MySQL стоил ~$4/мес только за то, что включён.
    const fs = require('fs');
    const path = require('path');
    const { createPool, migrateFromMySQL } = require('./mysql-sqlite');
    pool = createPool(process.env.DB_FILE);
    ready = (async () => {
        if (process.env.MYSQLHOST) {  // один раз: перенести всё из старого MySQL (вместе со структурой таблиц)
            await migrateFromMySQL(pool, {
                host: process.env.MYSQLHOST, port: parseInt(process.env.MYSQLPORT || '3306'),
                user: process.env.MYSQLUSER, password: process.env.MYSQLPASSWORD, database: process.env.MYSQLDATABASE,
            });
        }
        // новые и недостающие таблицы — по schema.sql (существующие не трогаются)
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/--.*$/gm, '');
        for (const stmt of schema.split(';').map((x) => x.trim()).filter(Boolean)) {
            if (/^CREATE TABLE/i.test(stmt)) await pool.query(stmt);
        }
        console.log('✅ База-файл готова:', process.env.DB_FILE);
    })();
    ready.catch((err) => { console.error('❌ База-файл: ошибка', err); process.exit(1); });
} else if (url) {
    pool = mysql.createPool({
        uri: url,
        waitForConnections: true,
        connectionLimit: 10,
        ssl: { rejectUnauthorized: false }
    });
} else {
    pool = mysql.createPool({
        host:     process.env.MYSQLHOST     || 'localhost',
        port:     parseInt(process.env.MYSQLPORT || '3306'),
        database: process.env.MYSQLDATABASE || 'eduspace',
        user:     process.env.MYSQLUSER     || 'root',
        password: process.env.MYSQLPASSWORD || '',
        waitForConnections: true,
        connectionLimit: 10
    });
}

if (!process.env.DB_FILE) {
    pool.getConnection()
        .then(conn => { console.log('✅ MySQL подключён'); conn.release(); })
        .catch(err  => console.error('❌ MySQL ошибка:', err.message));
}

const db = {
    query: async (sql, params) => { await ready; return pool.execute(sql, params); },
    transaction: async (callback) => {
        await ready;
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
            const result = await callback(conn);
            await conn.commit();
            conn.release();
            return result;
        } catch (err) {
            await conn.rollback();
            conn.release();
            throw err;
        }
    },
};

module.exports = db;
