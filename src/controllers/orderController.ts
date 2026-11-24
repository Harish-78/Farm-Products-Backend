import { Response } from 'express';
import { pool } from '../db/index.js';
import { logger } from '../config/logger.js';
import { AuthRequest } from '../middleware/auth.js';

// 1. Get Dashboard Analytics & Overview Stats
export async function getDashboardStats(req: AuthRequest, res: Response): Promise<void> {
  const startTime = Date.now();
  logger.info({ controller: 'getDashboardStats', userId: req.user?.id }, '[DashboardStats] Fetching summary');

  try {
    // Total Revenue & Orders
    const revenueQuery = await pool.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) AS total_revenue,
        COUNT(id) AS total_orders,
        COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN total_amount ELSE 0 END), 0) AS paid_revenue,
        COUNT(CASE WHEN order_status = 'PROCESSING' THEN 1 END) AS pending_processing,
        COUNT(CASE WHEN order_status = 'DELIVERED' THEN 1 END) AS delivered_orders
      FROM orders
      WHERE is_deleted = FALSE;
    `);

    // Total registered customers
    const customersQuery = await pool.query(`
      SELECT COUNT(id) AS total_customers FROM users WHERE is_deleted = FALSE;
    `);

    // Sales by day (last 7 days)
    const salesByDay = await pool.query(`
      SELECT 
        TO_CHAR(created_at, 'Mon DD') AS date_label,
        COALESCE(SUM(total_amount), 0) AS total_sales,
        COUNT(id) AS order_count
      FROM orders
      WHERE is_deleted = FALSE AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY TO_CHAR(created_at, 'Mon DD'), DATE(created_at)
      ORDER BY DATE(created_at) ASC;
    `);

    // Category distribution
    const categoryQuery = await pool.query(`
      SELECT 
        category,
        COUNT(id) AS count,
        COALESCE(SUM(total_amount), 0) AS revenue
      FROM orders
      WHERE is_deleted = FALSE
      GROUP BY category
      ORDER BY revenue DESC;
    `);

    // Recent 5 orders
    const recentOrders = await pool.query(`
      SELECT id, order_number, customer_name, product_name, total_amount, payment_status, order_status, created_at
      FROM orders
      WHERE is_deleted = FALSE
      ORDER BY created_at DESC
      LIMIT 5;
    `);

    const elapsed = Date.now() - startTime;
    logger.info({ controller: 'getDashboardStats', durationMs: elapsed }, `[DashboardStats] Completed in ${elapsed}ms`);

    res.json({
      success: true,
      stats: {
        totalRevenue: Number(revenueQuery.rows[0].total_revenue),
        paidRevenue: Number(revenueQuery.rows[0].paid_revenue),
        totalOrders: Number(revenueQuery.rows[0].total_orders),
        pendingProcessing: Number(revenueQuery.rows[0].pending_processing),
        deliveredOrders: Number(revenueQuery.rows[0].delivered_orders),
        totalCustomers: Number(customersQuery.rows[0].total_customers),
      },
      salesTrend: salesByDay.rows,
      categoryShare: categoryQuery.rows,
      recentOrders: recentOrders.rows,
    });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error({ controller: 'getDashboardStats', error: error.message, durationMs: elapsed }, '[DashboardStats] Error');
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics' });
  }
}

// 1.5. Create New Order
export async function createOrder(req: AuthRequest, res: Response): Promise<void> {
  const startTime = Date.now();
  const {
    order_number,
    customer_name,
    customer_email,
    customer_phone,
    product_name,
    category,
    quantity,
    unit_price,
    total_amount,
    payment_status,
    order_status,
    shipping_address,
  } = req.body;
  const userId = req.user?.id;

  logger.info({ controller: 'createOrder', order_number, customer_name }, '[CreateOrder] Started');

  if (!order_number || !customer_name || !product_name || !total_amount) {
    res.status(400).json({ success: false, message: 'Order number, customer name, product name, and total amount are required' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO orders (
        order_number, customer_name, customer_email, customer_phone,
        product_name, category, quantity, unit_price, total_amount,
        payment_status, order_status, shipping_address, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
      RETURNING *`,
      [
        order_number,
        customer_name,
        customer_email || '',
        customer_phone || '',
        product_name,
        category || 'General',
        quantity || 1,
        unit_price || 0,
        total_amount,
        payment_status || 'PENDING',
        order_status || 'PROCESSING',
        shipping_address || '',
        userId,
      ]
    );

    const elapsed = Date.now() - startTime;
    logger.info({ controller: 'createOrder', id: result.rows[0].id, durationMs: elapsed }, '[CreateOrder] Completed');

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: result.rows[0],
    });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error({ controller: 'createOrder', error: error.message, durationMs: elapsed }, '[CreateOrder] Error');
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
}

// 2. Get All Orders with optional status filters & pagination
export async function getOrders(req: AuthRequest, res: Response): Promise<void> {
  const startTime = Date.now();
  const { status, payment, search } = req.query;
  logger.info({ controller: 'getOrders', status, payment, search }, '[GetOrders] Querying orders');

  try {
    let query = `
      SELECT id, order_number, customer_name, customer_email, customer_phone, 
             product_name, category, quantity, unit_price, total_amount, 
             payment_status, order_status, shipping_address, created_at
      FROM orders
      WHERE is_deleted = FALSE
    `;
    const params: any[] = [];

    if (status && status !== 'ALL') {
      params.push(status);
      query += ` AND order_status = $${params.length}`;
    }

    if (payment && payment !== 'ALL') {
      params.push(payment);
      query += ` AND payment_status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (order_number ILIKE $${params.length} OR customer_name ILIKE $${params.length} OR product_name ILIKE $${params.length})`;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);
    const elapsed = Date.now() - startTime;
    logger.info({ controller: 'getOrders', count: result.rows.length, durationMs: elapsed }, `[GetOrders] Completed in ${elapsed}ms`);

    res.json({ success: true, orders: result.rows });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error({ controller: 'getOrders', error: error.message, durationMs: elapsed }, '[GetOrders] Error');
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
}

// 3. Update Order Status (Processing, Shipped, Delivered, Cancelled)
export async function updateOrderStatus(req: AuthRequest, res: Response): Promise<void> {
  const startTime = Date.now();
  const { id } = req.params;
  const { order_status, payment_status } = req.body;
  const userId = req.user?.id;

  logger.info({ controller: 'updateOrderStatus', id, order_status, payment_status, userId }, '[UpdateOrderStatus] Started');

  try {
    const result = await pool.query(
      `UPDATE orders 
       SET order_status = COALESCE($1, order_status),
           payment_status = COALESCE($2, payment_status),
           updated_by = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND is_deleted = FALSE
       RETURNING *`,
      [order_status, payment_status, userId, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const elapsed = Date.now() - startTime;
    logger.info({ controller: 'updateOrderStatus', id, durationMs: elapsed }, `[UpdateOrderStatus] Completed in ${elapsed}ms`);

    res.json({ success: true, message: 'Order updated successfully', order: result.rows[0] });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error({ controller: 'updateOrderStatus', error: error.message, durationMs: elapsed }, '[UpdateOrderStatus] Error');
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
}

// 4. Soft Delete Order
export async function deleteOrder(req: AuthRequest, res: Response): Promise<void> {
  const startTime = Date.now();
  const { id } = req.params;
  const userId = req.user?.id;

  logger.info({ controller: 'deleteOrder', id, userId }, '[DeleteOrder] Started');

  try {
    const result = await pool.query(
      `UPDATE orders
       SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_by = $1
       WHERE id = $2 AND is_deleted = FALSE
       RETURNING id`,
      [userId, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Order not found or already deleted' });
      return;
    }

    const elapsed = Date.now() - startTime;
    logger.info({ controller: 'deleteOrder', id, durationMs: elapsed }, '[DeleteOrder] Completed');

    res.json({ success: true, message: 'Order deleted successfully (soft delete)' });
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    logger.error({ controller: 'deleteOrder', id, error: error.message, durationMs: elapsed }, '[DeleteOrder] Error');
    res.status(500).json({ success: false, message: 'Failed to delete order' });
  }
}
