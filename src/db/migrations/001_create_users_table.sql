-- 001_create_users_table.sql

-- 1. Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  avatar_url VARCHAR(500),
  google_id VARCHAR(255) UNIQUE,
  reset_token VARCHAR(255),
  reset_token_expiry TIMESTAMP,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMP,
  created_by INT,
  updated_by INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Alter existing table to add any missing columns if users table was already created previously
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Normalize any existing null/blank/uppercase role values to 'user' or 'admin'
UPDATE users
SET role = CASE
  WHEN LOWER(TRIM(role)) = 'admin' THEN 'admin'
  ELSE 'user'
END
WHERE role IS NULL
   OR TRIM(role) = ''
   OR role NOT IN ('admin', 'user');

-- Ensure default and allowed values constraint on role for existing tables
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';
ALTER TABLE users ALTER COLUMN role SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_users_role_admin_user'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_role_admin_user
      CHECK (role IN ('admin', 'user'));
  END IF;
END $$;

-- 3. Indexes for fast query filtering active records
CREATE INDEX IF NOT EXISTS idx_users_email_is_deleted ON users(email, is_deleted);
CREATE INDEX IF NOT EXISTS idx_users_google_id_is_deleted ON users(google_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_users_role_is_deleted ON users(role, is_deleted);