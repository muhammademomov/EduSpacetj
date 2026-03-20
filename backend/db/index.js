const mysql = require('mysql2/promise');
require('dotenv').config();

// Railway даёт переменную DATABASE_URL или отдельные MYSQL_* переменные
// Поддерживаем оба варианта
let poolConfig;

if (process.env.DATABASE_URL) {
    // Railway MySQL URL формат: mysql://user:password@host:port/dbname
    poolConfig = { uri: process.env.DATABASE_URL };
} else {
    poolConfig = {
        host:     process.env.MYSQLHOST     || process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.MYSQLPORT || process.env.DB_PORT || '3306'),
        database: process.env.MYSQLDATABASE || process.env.DB_NAME     || 'eduspace',
        user:     process.env.MYSQLUSER     || process.env.DB_USER     || 'root',
        password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
    };
}

const pool = mysql.createPool({
    ...poolConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

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
