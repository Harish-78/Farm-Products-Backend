-- Migration 003: Create Orders table for Poongodi Farm Products Admin

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50),
  product_name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(10, 2) NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL,
  payment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  order_status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING',
  shipping_address TEXT,

  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMP,
  created_by INT,
  updated_by INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);