-- Migration 004: Farm business, livestock, feeds, dynamic expenses, and profits

-- 1. Livestock / Flocks (Multi-animal / business support: Quails, Country Chickens, Ducks, etc.)
CREATE TABLE IF NOT EXISTS livestock (
  id SERIAL PRIMARY KEY,
  animal_type VARCHAR(100) NOT NULL DEFAULT 'Quail',
  batch_name VARCHAR(150) NOT NULL,
  current_count INT NOT NULL DEFAULT 0,
  mortality_count INT NOT NULL DEFAULT 0,
  avg_daily_feed_per_bird_grams DECIMAL(10, 2) NOT NULL DEFAULT 25.00,
  notes TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT,
  updated_by INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Warehouse Feeds Inventory
CREATE TABLE IF NOT EXISTS feed_inventory (
  id SERIAL PRIMARY KEY,
  feed_name VARCHAR(150) NOT NULL,
  target_animal VARCHAR(100) NOT NULL DEFAULT 'Quail',
  bag_weight_kg DECIMAL(10, 2) NOT NULL DEFAULT 50.00,
  current_stock_kg DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  cost_per_kg DECIMAL(10, 2) NOT NULL DEFAULT 35.00,
  reorder_alert_days INT NOT NULL DEFAULT 10,
  supplier_name VARCHAR(150),
  notes TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT,
  updated_by INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Daily Feed Consumption & Mortality Tracking Logs
CREATE TABLE IF NOT EXISTS daily_livestock_logs (
  id SERIAL PRIMARY KEY,
  livestock_id INT REFERENCES livestock(id),
  feed_id INT REFERENCES feed_inventory(id),
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  feed_consumed_kg DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  feed_cost DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  egg_production_count INT NOT NULL DEFAULT 0,
  mortality_count INT NOT NULL DEFAULT 0,
  notes TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT,
  updated_by INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Dynamic General Expenses (Feed, Packaging, Labeling, Medicine, Electricity, Transport, Labor, etc.)
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method VARCHAR(50) DEFAULT 'CASH',
  business_unit VARCHAR(100) NOT NULL DEFAULT 'Quail Farm',
  receipt_url VARCHAR(500),
  notes TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT,
  updated_by INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_livestock_animal ON livestock(animal_type, is_deleted);
CREATE INDEX IF NOT EXISTS idx_feed_target ON feed_inventory(target_animal, is_deleted);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC, is_deleted);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_livestock_logs(log_date DESC, is_deleted);