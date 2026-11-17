-- Migration 003: Create Orders table for Poongodi Farm Products Admin

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50),
  product_name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL, -- Dairy, Organic Vegetables, Farm Honey, Cold Pressed Oils, Grains
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(10, 2) NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL,
  payment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, PAID, FAILED, REFUNDED
  order_status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING', -- PROCESSING, SHIPPED, DELIVERED, CANCELLED
  shipping_address TEXT,
  
  -- Audit and soft delete
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

-- Insert realistic seed orders if table is empty
INSERT INTO orders (order_number, customer_name, customer_email, customer_phone, product_name, category, quantity, unit_price, total_amount, payment_status, order_status, shipping_address, created_at)
SELECT * FROM (VALUES
  ('ORD-2026-1001', 'Arun Kumar', 'arun@example.com', '+91 9876543210', 'Pure A2 Desi Cow Ghee (500ml)', 'Dairy', 2, 750.00, 1500.00, 'PAID', 'DELIVERED', '12 Anna Nagar, Chennai', NOW() - INTERVAL '6 days'),
  ('ORD-2026-1002', 'Priya Sundaram', 'priya@example.com', '+91 9845123456', 'Cold Pressed Sesame Oil (1L)', 'Oils', 3, 420.00, 1260.00, 'PAID', 'DELIVERED', '45 Gandhi Road, Coimbatore', NOW() - INTERVAL '5 days'),
  ('ORD-2026-1003', 'Karthik Raja', 'karthik@example.com', '+91 9712345678', 'Wild Forest Raw Honey (500g)', 'Honey', 1, 550.00, 550.00, 'PAID', 'SHIPPED', '88 Cross Cut Road, Madurai', NOW() - INTERVAL '4 days'),
  ('ORD-2026-1004', 'Deepa Lakshmi', 'deepa@example.com', '+91 9654321098', 'Organic Traditional Ponni Rice (5kg)', 'Grains', 2, 450.00, 900.00, 'PAID', 'PROCESSING', '14 Trichy Main Road, Salem', NOW() - INTERVAL '3 days'),
  ('ORD-2026-1005', 'Vigneshwaran M', 'vicky@example.com', '+91 9500123456', 'Fresh Farm Country Chicken Eggs (Pack of 30)', 'Poultry', 2, 360.00, 720.00, 'PENDING', 'PROCESSING', '3 Kamaraj Nagar, Tirunelveli', NOW() - INTERVAL '2 days'),
  ('ORD-2026-1006', 'Sangeetha B', 'sangeetha@example.com', '+91 9444112233', 'Wood Pressed Groundnut Oil (2L)', 'Oils', 1, 780.00, 780.00, 'PAID', 'DELIVERED', '23 Nehru Street, Erode', NOW() - INTERVAL '1 day'),
  ('ORD-2026-1007', 'Murugan Palanisamy', 'murugan@example.com', '+91 9333221100', 'Organic Turmeric Finger (1kg)', 'Spices', 3, 220.00, 660.00, 'PAID', 'PROCESSING', '99 Temple Street, Thanjavur', NOW() - INTERVAL '12 hours'),
  ('ORD-2026-1008', 'Kavitha Ramesh', 'kavitha@example.com', '+91 9222334455', 'Cold Pressed Coconut Oil (1L)', 'Oils', 2, 380.00, 760.00, 'PAID', 'SHIPPED', '5 Race Course, Coimbatore', NOW() - INTERVAL '4 hours'),
  ('ORD-2026-1009', 'Saravanan T', 'saravanan@example.com', '+91 9111223344', 'Fresh Organic Vegetable Basket (5kg)', 'Vegetables', 1, 499.00, 499.00, 'PENDING', 'PROCESSING', '17 Velachery Bypass, Chennai', NOW() - INTERVAL '1 hour')
) AS v(order_number, customer_name, customer_email, customer_phone, product_name, category, quantity, unit_price, total_amount, payment_status, order_status, shipping_address, created_at)
WHERE NOT EXISTS (SELECT 1 FROM orders LIMIT 1);
