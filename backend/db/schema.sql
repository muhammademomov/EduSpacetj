SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
    id          VARCHAR(36)  PRIMARY KEY,
    first_name  VARCHAR(100) NOT NULL,
    last_name   VARCHAR(100) NOT NULL,
    email       VARCHAR(255) NOT NULL UNIQUE,
    phone       VARCHAR(20)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role        ENUM('student','teacher','admin') NOT NULL,
    avatar_url  VARCHAR(500),
    color       VARCHAR(10)  DEFAULT '#18A96A',
    initials    VARCHAR(5),
    is_active   TINYINT(1)   DEFAULT 1,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role  (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_profiles (
    id          VARCHAR(36) PRIMARY KEY,
    user_id     VARCHAR(36) NOT NULL UNIQUE,
    balance     DECIMAL(12,2) DEFAULT 0,
    total_added DECIMAL(12,2) DEFAULT 0,
    total_spent DECIMAL(12,2) DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_profiles (
    id            VARCHAR(36)  PRIMARY KEY,
    user_id       VARCHAR(36)  NOT NULL UNIQUE,
    subject       VARCHAR(200),
    bio           TEXT,
    tags          TEXT,
    price         DECIMAL(10,2) DEFAULT 0,
    platforms     TEXT,
    work_days     TEXT,
    work_hours    VARCHAR(20),
    teacher_type  ENUM('pro','specialist') DEFAULT 'pro',
    is_moderated  TINYINT(1)   DEFAULT 0,
    is_visible    TINYINT(1)   DEFAULT 0,
    rating        DECIMAL(3,2) DEFAULT 0,
    review_count  INT          DEFAULT 0,
    student_count INT          DEFAULT 0,
    total_earnings DECIMAL(12,2) DEFAULT 0,
    video_url     VARCHAR(500),
    moderated_at  DATETIME,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_documents (
    id          VARCHAR(36)  PRIMARY KEY,
    teacher_id  VARCHAR(36)  NOT NULL,
    doc_type    ENUM('diploma','certificate','work_book') NOT NULL,
    doc_name    VARCHAR(300) NOT NULL,
    institution VARCHAR(300),
    year        VARCHAR(10),
    file_url    VARCHAR(500),
    is_verified TINYINT(1) DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS courses (
    id           VARCHAR(36)  PRIMARY KEY,
    teacher_id   VARCHAR(36)  NOT NULL,
    title        VARCHAR(300) NOT NULL,
    description  TEXT,
    category     VARCHAR(100) NOT NULL,
    level        VARCHAR(50)  DEFAULT 'Начинающий',
    price        DECIMAL(10,2) NOT NULL,
    emoji        VARCHAR(10)  DEFAULT '📖',
    status       ENUM('moderation','active','rejected','archived') DEFAULT 'moderation',
    rating       DECIMAL(3,2) DEFAULT 0,
    review_count INT          DEFAULT 0,
    student_count INT         DEFAULT 0,
    rejection_reason TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status   (status),
    INDEX idx_category (category),
    INDEX idx_teacher  (teacher_id),
    FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS course_lessons (
    id        VARCHAR(36)  PRIMARY KEY,
    course_id VARCHAR(36)  NOT NULL,
    title     VARCHAR(300) NOT NULL,
    order_num INT          NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enrollments (
    id                VARCHAR(36)   PRIMARY KEY,
    student_id        VARCHAR(36)   NOT NULL,
    course_id         VARCHAR(36)   NOT NULL,
    teacher_id        VARCHAR(36)   NOT NULL,
    price_paid        DECIMAL(10,2) NOT NULL,
    commission_amount DECIMAL(10,2) NOT NULL,
    teacher_amount    DECIMAL(10,2) NOT NULL,
    status            ENUM('active','completed','refunded') DEFAULT 'active',
    enrolled_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_student_course (student_id, course_id),
    INDEX idx_student (student_id),
    INDEX idx_teacher (teacher_id),
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id)  REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
    id                    VARCHAR(36) PRIMARY KEY,
    user_id               VARCHAR(36) NOT NULL,
    type                  ENUM('topup','payment','refund','payout') NOT NULL,
    amount                DECIMAL(12,2) NOT NULL,
    description           VARCHAR(500),
    related_course_id     VARCHAR(36),
    related_enrollment_id VARCHAR(36),
    status                VARCHAR(20) DEFAULT 'completed',
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS favorites (
    id         VARCHAR(36) PRIMARY KEY,
    student_id VARCHAR(36) NOT NULL,
    teacher_id VARCHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_fav (student_id, teacher_id),
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
    id         VARCHAR(36) PRIMARY KEY,
    student_id VARCHAR(36) NOT NULL,
    teacher_id VARCHAR(36) NOT NULL,
    course_id  VARCHAR(36) NOT NULL,
    stars      TINYINT     NOT NULL,
    text       TEXT,
    tags       TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_student_course_review (student_id, course_id),
    INDEX idx_teacher (teacher_id),
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id)  REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
    id         VARCHAR(36)  PRIMARY KEY,
    user_id    VARCHAR(36)  NOT NULL,
    type       VARCHAR(50)  NOT NULL,
    title      VARCHAR(300) NOT NULL,
    body       TEXT,
    is_read    TINYINT(1)   DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
