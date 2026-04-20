require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

async function init() {
    const config = {
        host:     process.env.MYSQLHOST     || 'localhost',
        port:     parseInt(process.env.MYSQLPORT || '3306'),
        user:     process.env.MYSQLUSER     || 'root',
        password: process.env.MYSQLPASSWORD || '',
        database: process.env.MYSQLDATABASE || 'eduspace',
        multipleStatements: false,
    };

    const conn = await mysql.createConnection(config);
    console.log('✅ Подключено к MySQL');

    // Создаём таблицы по одной
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(36) PRIMARY KEY,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            phone VARCHAR(20) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('student','teacher','admin') NOT NULL,
            avatar_url VARCHAR(500),
            color VARCHAR(10) DEFAULT '#18A96A',
            initials VARCHAR(5),
            is_active TINYINT(1) DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS student_profiles (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL UNIQUE,
            balance DECIMAL(12,2) DEFAULT 0,
            total_added DECIMAL(12,2) DEFAULT 0,
            total_spent DECIMAL(12,2) DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS teacher_profiles (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL UNIQUE,
            subject VARCHAR(200),
            bio TEXT,
            tags TEXT,
            price DECIMAL(10,2) DEFAULT 0,
            platforms TEXT,
            work_days TEXT,
            work_hours VARCHAR(20),
            teacher_type ENUM('pro','specialist') DEFAULT 'pro',
            is_moderated TINYINT(1) DEFAULT 0,
            is_visible TINYINT(1) DEFAULT 0,
            rating DECIMAL(3,2) DEFAULT 0,
            review_count INT DEFAULT 0,
            student_count INT DEFAULT 0,
            total_earnings DECIMAL(12,2) DEFAULT 0,
            video_url VARCHAR(500),
            moderated_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS teacher_documents (
            id VARCHAR(36) PRIMARY KEY,
            teacher_id VARCHAR(36) NOT NULL,
            doc_type ENUM('diploma','certificate','work_book') NOT NULL,
            doc_name VARCHAR(300) NOT NULL,
            institution VARCHAR(300),
            year VARCHAR(10),
            file_url VARCHAR(500),
            is_verified TINYINT(1) DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS courses (
            id VARCHAR(36) PRIMARY KEY,
            teacher_id VARCHAR(36) NOT NULL,
            title VARCHAR(300) NOT NULL,
            description TEXT,
            category VARCHAR(100) NOT NULL,
            level VARCHAR(50) DEFAULT 'Начинающий',
            price DECIMAL(10,2) NOT NULL,
            emoji VARCHAR(10) DEFAULT '📖',
            status ENUM('moderation','active','rejected','archived') DEFAULT 'moderation',
            rating DECIMAL(3,2) DEFAULT 0,
            review_count INT DEFAULT 0,
            student_count INT DEFAULT 0,
            rejection_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS course_lessons (
            id VARCHAR(36) PRIMARY KEY,
            course_id VARCHAR(36) NOT NULL,
            title VARCHAR(300) NOT NULL,
            order_num INT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS enrollments (
            id VARCHAR(36) PRIMARY KEY,
            student_id VARCHAR(36) NOT NULL,
            course_id VARCHAR(36) NOT NULL,
            teacher_id VARCHAR(36) NOT NULL,
            price_paid DECIMAL(10,2) NOT NULL,
            commission_amount DECIMAL(10,2) NOT NULL,
            teacher_amount DECIMAL(10,2) NOT NULL,
            status ENUM('active','completed','refunded') DEFAULT 'active',
            enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_student_course (student_id, course_id),
            FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
            FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS transactions (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,
            type ENUM('topup','payment','refund','payout') NOT NULL,
            amount DECIMAL(12,2) NOT NULL,
            description VARCHAR(500),
            related_course_id VARCHAR(36),
            related_enrollment_id VARCHAR(36),
            status VARCHAR(20) DEFAULT 'completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS favorites (
            id VARCHAR(36) PRIMARY KEY,
            student_id VARCHAR(36) NOT NULL,
            teacher_id VARCHAR(36) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_fav (student_id, teacher_id),
            FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS reviews (
            id VARCHAR(36) PRIMARY KEY,
            student_id VARCHAR(36) NOT NULL,
            teacher_id VARCHAR(36) NOT NULL,
            course_id VARCHAR(36) NOT NULL,
            stars TINYINT NOT NULL,
            text TEXT,
            tags TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_student_course_review (student_id, course_id),
            FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS notifications (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,
            type VARCHAR(50) NOT NULL,
            title VARCHAR(300) NOT NULL,
            body TEXT,
            is_read TINYINT(1) DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ];

    for (const sql of tables) {
        await conn.query(sql);
    }
    console.log('✅ Таблицы созданы');

    // Add video_url column to existing tables
    try {
        await conn.query('ALTER TABLE teacher_profiles ADD COLUMN video_url VARCHAR(500) DEFAULT NULL');
        console.log('✅ Колонка video_url добавлена');
    } catch(e) {
        console.log('✅ Колонка video_url уже существует');
    }
    try {
        await conn.query('ALTER TABLE teacher_profiles ADD COLUMN conditions TEXT DEFAULT NULL');
        console.log('✅ Колонка conditions добавлена');
    } catch(e) {
        console.log('✅ Колонка conditions уже существует');
    }
    try {
        await conn.query('ALTER TABLE reviews ADD COLUMN teacher_reply TEXT DEFAULT NULL');
        console.log('✅ Колонка teacher_reply добавлена');
    } catch(e) {
        console.log('✅ Колонка teacher_reply уже существует');
    }
    try {
        await conn.query('ALTER TABLE reviews ADD COLUMN replied_at DATETIME DEFAULT NULL');
        console.log('✅ Колонка replied_at добавлена');
    } catch(e) {
        console.log('✅ Колонка replied_at уже существует');
    }

    // Chat messages table
    await conn.query(`CREATE TABLE IF NOT EXISTS chat_messages (
        id VARCHAR(36) PRIMARY KEY,
        sender_id VARCHAR(36) NOT NULL,
        receiver_id VARCHAR(36) NOT NULL,
        text TEXT NOT NULL,
        is_read TINYINT(1) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_chat (sender_id, receiver_id),
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    console.log('✅ Таблица chat_messages готова');
        // Добавляем is_notified для однократного уведомления
        
        try {
            await db_module.query('ALTER TABLE teacher_profiles ADD COLUMN setup_done TINYINT(1) DEFAULT 0');
            console.log('✅ Колонка setup_done добавлена');
        } catch(e) { /* уже есть */ }
        try {
            await db_module.query('ALTER TABLE teacher_profiles ADD COLUMN is_notified TINYINT(1) DEFAULT 0');
            console.log('✅ Колонка is_notified добавлена');
        } catch(e) { /* уже есть */ }


    // Admin user
    const hash = await bcrypt.hash('admin123', 10);
    await conn.execute(
        `INSERT IGNORE INTO users (id, first_name, last_name, email, phone, password_hash, role, color, initials)
         VALUES (?, 'Admin', 'EduSpace', 'admin@eduspace.tj', '000000000', ?, 'admin', '#7C3AED', 'AE')`,
        [randomUUID(), hash]
    );
    console.log('✅ Администратор: admin@eduspace.tj / admin123');

    await conn.end();
    console.log('\n🎉 Готово!\n');
}

init().catch(err => { console.error('❌', err.message); process.exit(1); });
