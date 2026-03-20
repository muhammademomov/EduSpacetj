const mysql = require('mysql2/promise');
require('dotenv').config();

const url = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL;

let pool;

if (url) {
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

pool.getConnection()
    .then(conn => { console.log('✅ MySQL подключён'); conn.release(); })
    .catch(err  => console.error('❌ MySQL ошибка:', err.message));

const db = {
    query: (sql, params) => pool.execute(sql, params),
    transaction: async (callback) => {
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
