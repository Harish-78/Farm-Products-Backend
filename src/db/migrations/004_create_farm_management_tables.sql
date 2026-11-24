-- Migration 004: Farm business, livestock, feeds, dynamic expenses, and profits

-- 1. Livestock / Flocks (Multi-animal / business support: Quails, Country Chickens, Ducks, etc.)
CREATE TABLE IF NOT EXISTS livestock (
  id SERIAL PRIMARY KEY,
  animal_type VARCHAR(100) NOT NULL DEFAULT 'Quail', -- Quail, Country Chicken, Duck, etc.
  batch_name VARCHAR(150) NOT NULL, -- e.g., 'Quail Batch A', 'Japanese Quail Layer 1'
  current_count INT NOT NULL DEFAULT 0,
  mortality_count INT NOT NULL DEFAULT 0,
  avg_daily_feed_per_bird_grams DECIMAL(10, 2) NOT NULL DEFAULT 25.00, -- Quails consume ~25g to 30g/day
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
  feed_name VARCHAR(150) NOT NULL, -- e.g., 'Quail Starter Feed', 'Layer Mash', 'Grower Feed'
  target_animal VARCHAR(100) NOT NULL DEFAULT 'Quail',
  bag_weight_kg DECIMAL(10, 2) NOT NULL DEFAULT 50.00,
  current_stock_kg DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  cost_per_kg DECIMAL(10, 2) NOT NULL DEFAULT 35.00,
  reorder_alert_days INT NOT NULL DEFAULT 10, -- Alert 10 days before exhaustion
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
  category VARCHAR(100) NOT NULL, -- 'Feed', 'Packaging & Labeling', 'Medicines & Vaccines', 'Electricity & Water', 'Transport', 'Equipment', 'Labor', 'Other'
  title VARCHAR(255) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method VARCHAR(50) DEFAULT 'CASH', -- CASH, UPI, BANK_TRANSFER
  business_unit VARCHAR(100) NOT NULL DEFAULT 'Quail Farm', -- Allows multi-business expansion!
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

-- Seed realistic initial data if empty
INSERT INTO livestock (animal_type, batch_name, current_count, mortality_count, avg_daily_feed_per_bird_grams)
SELECT 'Quail', 'Main Quail Flock Layer Batch 1', 1200, 15, 28.00
WHERE NOT EXISTS (SELECT 1 FROM livestock LIMIT 1);

INSERT INTO feed_inventory (feed_name, target_animal, bag_weight_kg, current_stock_kg, cost_per_kg, reorder_alert_days, supplier_name)
SELECT 'Premium Quail Layer Feed (Mash)', 'Quail', 50.00, 850.00, 36.50, 10, 'Tamilnadu Feeds & Agro'
WHERE NOT EXISTS (SELECT 1 FROM feed_inventory LIMIT 1);

INSERT INTO expenses (category, title, amount, expense_date, business_unit, notes)
SELECT * FROM (VALUES
  ('Packaging & Labeling', 'Eco-friendly 18-Egg Quail Pulp Cartons & Stickers', 1850.00, CURRENT_DATE - 3, 'Quail Farm', '500 carton boxes with brand logo sticker labels'),
  ('Medicines & Vaccines', 'Vitamins & Probiotic water supplements (Liquid)', 450.00, CURRENT_DATE - 5, 'Quail Farm', 'Monthly health pack'),
  ('Electricity & Water', 'Farm Shed Lighting & Brooder Heater Bill', 920.00, CURRENT_DATE - 8, 'Quail Farm', 'EB charge for current month'),
  ('Packaging & Labeling', 'Custom Holographic Barcode Labels Roll', 650.00, CURRENT_DATE - 12, 'Quail Farm', 'Print batch for packaged products')
) AS v(category, title, amount, expense_date, business_unit, notes)
WHERE NOT EXISTS (SELECT 1 FROM expenses LIMIT 1);
