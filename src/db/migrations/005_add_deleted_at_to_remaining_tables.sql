-- Migration 005: Add deleted_at column to tables that only have is_deleted
-- Ensures all soft-delete controllers can set deleted_at timestamp

-- livestock table
ALTER TABLE livestock ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- feed_inventory table
ALTER TABLE feed_inventory ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- expenses table
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- daily_livestock_logs table
ALTER TABLE daily_livestock_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Indexes for faster soft-delete filtering on these tables
CREATE INDEX IF NOT EXISTS idx_livestock_deleted_at ON livestock(deleted_at);
CREATE INDEX IF NOT EXISTS idx_feed_inventory_deleted_at ON feed_inventory(deleted_at);
CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at ON expenses(deleted_at);
CREATE INDEX IF NOT EXISTS idx_daily_livestock_logs_deleted_at ON daily_livestock_logs(deleted_at);
