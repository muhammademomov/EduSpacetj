ALTER TABLE users
ADD COLUMN verify_code VARCHAR(6) NULL AFTER is_active,
ADD COLUMN verify_expires DATETIME NULL AFTER verify_code;
