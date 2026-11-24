import { Response } from 'express';
import { pool } from '../db/index.js';
import { logger } from '../config/logger.js';
import { AuthRequest } from '../middleware/auth.js';
import { checkFeedStockAndAlert } from '../services/feedCron.js';

// ==========================================
// 1. LIVESTOCK (Quails & Multi-Animal Flocks)
// ==========================================
export async function getLivestock(req: AuthRequest, res: Response): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT 
        l.*,
        ROUND((l.current_count * l.avg_daily_feed_per_bird_grams) / 1000.0, 2) AS calculated_daily_feed_kg
      FROM livestock l
      WHERE l.is_deleted = FALSE
      ORDER BY l.created_at DESC;
    `);
    res.json({ success: true, livestock: result.rows });
  } catch (err: any) {
    logger.error({ err: err.message }, '[Livestock] Error fetching livestock');
    res.status(500).json({ success: false, message: 'Failed to fetch livestock data' });
  }
}

export async function createLivestock(req: AuthRequest, res: Response): Promise<void> {
  const { animal_type, batch_name, current_count, mortality_count, avg_daily_feed_per_bird_grams, notes } = req.body;
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `INSERT INTO livestock (animal_type, batch_name, current_count, mortality_count, avg_daily_feed_per_bird_grams, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [animal_type || 'Quail', batch_name, current_count || 0, mortality_count || 0, avg_daily_feed_per_bird_grams || 25, notes || '', userId]
    );
    res.status(201).json({ success: true, message: 'Livestock batch registered successfully', batch: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateLivestock(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { current_count, mortality_count, avg_daily_feed_per_bird_grams, notes } = req.body;
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `UPDATE livestock 
       SET current_count = COALESCE($1, current_count),
           mortality_count = COALESCE($2, mortality_count),
           avg_daily_feed_per_bird_grams = COALESCE($3, avg_daily_feed_per_bird_grams),
           notes = COALESCE($4, notes),
           updated_by = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND is_deleted = FALSE
       RETURNING *`,
      [current_count, mortality_count, avg_daily_feed_per_bird_grams, notes, userId, id]
    );
    res.json({ success: true, message: 'Livestock updated', batch: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ==========================================
// 2. FEEDS INVENTORY & PREDICTION
// ==========================================
export async function getFeeds(req: AuthRequest, res: Response): Promise<void> {
  try {
    // 1. Calculate daily consumption per animal type
    const livestockResult = await pool.query(`
      SELECT 
        animal_type,
        SUM(current_count) AS total_birds,
        SUM((current_count * avg_daily_feed_per_bird_grams) / 1000.0) AS daily_feed_needed_kg
      FROM livestock
      WHERE is_deleted = FALSE AND current_count > 0
      GROUP BY animal_type;
    `);

    // 2. Fetch feeds
    const feedsResult = await pool.query(`
      SELECT * FROM feed_inventory WHERE is_deleted = FALSE ORDER BY created_at DESC;
    `);

    // 3. Compute days remaining and alert status
    const feedsWithPrediction = feedsResult.rows.map((feed) => {
      const match = livestockResult.rows.find(
        (a) => a.animal_type.toLowerCase() === feed.target_animal.toLowerCase()
      );
      const dailyNeededKg = match ? Number(match.daily_feed_needed_kg) : 0;
      const currentStockKg = Number(feed.current_stock_kg);
      const daysRemaining = dailyNeededKg > 0 ? Math.floor(currentStockKg / dailyNeededKg) : 999;
      const isLowStock = daysRemaining <= Number(feed.reorder_alert_days || 10);

      return {
        ...feed,
        daily_consumption_kg: dailyNeededKg,
        days_remaining: daysRemaining,
        is_low_stock: isLowStock,
      };
    });

    res.json({ success: true, feeds: feedsWithPrediction });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createFeed(req: AuthRequest, res: Response): Promise<void> {
  const { feed_name, target_animal, bag_weight_kg, current_stock_kg, cost_per_kg, reorder_alert_days, supplier_name, notes } = req.body;
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `INSERT INTO feed_inventory (feed_name, target_animal, bag_weight_kg, current_stock_kg, cost_per_kg, reorder_alert_days, supplier_name, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [feed_name, target_animal || 'Quail', bag_weight_kg || 50, current_stock_kg || 0, cost_per_kg || 35, reorder_alert_days || 10, supplier_name, notes, userId]
    );
    res.status(201).json({ success: true, message: 'Feed stock registered', feed: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateFeedStock(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { current_stock_kg, cost_per_kg } = req.body;
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `UPDATE feed_inventory
       SET current_stock_kg = COALESCE($1, current_stock_kg),
           cost_per_kg = COALESCE($2, cost_per_kg),
           updated_by = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND is_deleted = FALSE
       RETURNING *`,
      [current_stock_kg, cost_per_kg, userId, id]
    );
    res.json({ success: true, message: 'Feed stock updated', feed: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Trigger manual check and email alert for feed stock
export async function triggerFeedCheckNow(_req: AuthRequest, res: Response): Promise<void> {
  await checkFeedStockAndAlert();
  res.json({ success: true, message: 'Feed depletion check completed & notifications sent.' });
}

// ==========================================
// 3. DYNAMIC EXPENSES MODULE
// ==========================================
export async function getExpenses(req: AuthRequest, res: Response): Promise<void> {
  const { category, business_unit, startDate, endDate } = req.query;

  try {
    let query = `SELECT * FROM expenses WHERE is_deleted = FALSE`;
    const params: any[] = [];

    if (category && category !== 'ALL') {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    if (business_unit && business_unit !== 'ALL') {
      params.push(business_unit);
      query += ` AND business_unit = $${params.length}`;
    }

    if (startDate) {
      params.push(startDate);
      query += ` AND expense_date >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      query += ` AND expense_date <= $${params.length}`;
    }

    query += ` ORDER BY expense_date DESC, created_at DESC`;

    const result = await pool.query(query, params);
    res.json({ success: true, expenses: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createExpense(req: AuthRequest, res: Response): Promise<void> {
  const { category, title, amount, expense_date, payment_method, business_unit, notes } = req.body;
  const userId = req.user?.id;

  if (!category || !title || !amount) {
    res.status(400).json({ success: false, message: 'Category, title, and amount are required' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO expenses (category, title, amount, expense_date, payment_method, business_unit, notes, created_by, updated_by)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7, $8, $8)
       RETURNING *`,
      [category, title, amount, expense_date, payment_method || 'CASH', business_unit || 'Quail Farm', notes || '', userId]
    );
    res.status(201).json({ success: true, message: 'Expense logged successfully', expense: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteExpense(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const userId = req.user?.id;

  try {
    await pool.query(
      `UPDATE expenses 
       SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_by = $1 
       WHERE id = $2`,
      [userId, id]
    );
    res.json({ success: true, message: 'Expense deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateExpense(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { category, title, amount, expense_date, payment_method, business_unit, notes } = req.body;
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `UPDATE expenses
       SET category = COALESCE($1, category),
           title = COALESCE($2, title),
           amount = COALESCE($3, amount),
           expense_date = COALESCE($4, expense_date),
           payment_method = COALESCE($5, payment_method),
           business_unit = COALESCE($6, business_unit),
           notes = COALESCE($7, notes),
           updated_by = $8,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 AND is_deleted = FALSE
       RETURNING *`,
      [category, title, amount, expense_date, payment_method, business_unit, notes, userId, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Expense not found or already deleted' });
      return;
    }

    res.json({ success: true, message: 'Expense updated successfully', expense: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ==========================================
// 5. SOFT DELETE OPERATIONS (Farm Module)
// ==========================================

export async function deleteLivestock(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `UPDATE livestock
       SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_by = $1
       WHERE id = $2 AND is_deleted = FALSE
       RETURNING id`,
      [userId, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Livestock batch not found or already deleted' });
      return;
    }

    res.json({ success: true, message: 'Livestock batch deleted successfully (soft delete)' });
  } catch (err: any) {
    logger.error({ err: err.message }, '[Livestock] Error soft-deleting batch');
    res.status(500).json({ success: false, message: 'Failed to delete livestock batch' });
  }
}

export async function deleteFeed(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `UPDATE feed_inventory
       SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_by = $1
       WHERE id = $2 AND is_deleted = FALSE
       RETURNING id`,
      [userId, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Feed item not found or already deleted' });
      return;
    }

    res.json({ success: true, message: 'Feed item deleted successfully (soft delete)' });
  } catch (err: any) {
    logger.error({ err: err.message }, '[Feed] Error soft-deleting feed item');
    res.status(500).json({ success: false, message: 'Failed to delete feed item' });
  }
}

// ==========================================
// 4. FINANCIAL P&L & NET PROFIT DASHBOARD
// ==========================================
export async function getComprehensivePnL(req: AuthRequest, res: Response): Promise<void> {
  try {
    // 1. Total Lifetime & Today Sales / Revenues
    const salesAgg = await pool.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN total_amount ELSE 0 END), 0) AS total_cash_collected,
        COALESCE(SUM(CASE WHEN payment_status = 'PENDING' THEN total_amount ELSE 0 END), 0) AS pending_receivables,
        COUNT(id) AS total_orders_count,
        COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN total_amount ELSE 0 END), 0) AS today_revenue
      FROM orders
      WHERE is_deleted = FALSE;
    `);

    // 2. Total Lifetime & Today Expenses
    const expensesAgg = await pool.query(`
      SELECT 
        COALESCE(SUM(amount), 0) AS total_expenses,
        COALESCE(SUM(CASE WHEN expense_date = CURRENT_DATE THEN amount ELSE 0 END), 0) AS today_expenses,
        COALESCE(SUM(CASE WHEN category ILIKE '%feed%' THEN amount ELSE 0 END), 0) AS total_feed_expenses,
        COALESCE(SUM(CASE WHEN category NOT ILIKE '%feed%' THEN amount ELSE 0 END), 0) AS total_other_expenses
      FROM expenses
      WHERE is_deleted = FALSE;
    `);

    // 3. Quails & Livestock Population
    const livestockAgg = await pool.query(`
      SELECT 
        COALESCE(SUM(current_count), 0) AS total_active_quails,
        COALESCE(SUM(mortality_count), 0) AS total_mortality,
        COALESCE(ROUND(SUM((current_count * avg_daily_feed_per_bird_grams) / 1000.0), 2), 0) AS daily_feed_consumption_kg
      FROM livestock
      WHERE is_deleted = FALSE;
    `);

    // 4. Feeds in Hand
    const feedsAgg = await pool.query(`
      SELECT 
        COALESCE(SUM(current_stock_kg), 0) AS total_feed_stock_kg,
        COALESCE(SUM(current_stock_kg * cost_per_kg), 0) AS total_feed_value_in_hand
      FROM feed_inventory
      WHERE is_deleted = FALSE;
    `);

    // 5. Daily Net Profit Trend (Revenue - Expenses) for last 14 days
    const dailyProfitTrend = await pool.query(`
      WITH date_range AS (
        SELECT (CURRENT_DATE - i)::date AS day
        FROM generate_series(0, 13) AS i
      ),
      daily_sales AS (
        SELECT DATE(created_at) AS day, COALESCE(SUM(total_amount), 0) AS revenue
        FROM orders
        WHERE is_deleted = FALSE AND created_at >= CURRENT_DATE - 14
        GROUP BY DATE(created_at)
      ),
      daily_exp AS (
        SELECT expense_date AS day, COALESCE(SUM(amount), 0) AS expense
        FROM expenses
        WHERE is_deleted = FALSE AND expense_date >= CURRENT_DATE - 14
        GROUP BY expense_date
      )
      SELECT 
        TO_CHAR(dr.day, 'Mon DD') AS date_label,
        COALESCE(ds.revenue, 0) AS revenue,
        COALESCE(de.expense, 0) AS expense,
        (COALESCE(ds.revenue, 0) - COALESCE(de.expense, 0)) AS net_profit
      FROM date_range dr
      LEFT JOIN daily_sales ds ON dr.day = ds.day
      LEFT JOIN daily_exp de ON dr.day = de.day
      ORDER BY dr.day ASC;
    `);

    // 6. Expense breakdown by category
    const expenseBreakdown = await pool.query(`
      SELECT category, COALESCE(SUM(amount), 0) AS total_amount, COUNT(id) AS count
      FROM expenses
      WHERE is_deleted = FALSE
      GROUP BY category
      ORDER BY total_amount DESC;
    `);

    // 7. Monthly Revenue vs Expense comparison for the last 6 months
    const monthlyComparison = await pool.query(`
      WITH months AS (
        SELECT DATE_TRUNC('month', CURRENT_DATE - (m || ' months')::interval)::date AS m_start
        FROM generate_series(0, 5) AS m
      ),
      m_sales AS (
        SELECT DATE_TRUNC('month', created_at)::date AS m_start, COALESCE(SUM(total_amount), 0) AS revenue
        FROM orders
        WHERE is_deleted = FALSE AND created_at >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', created_at)
      ),
      m_exp AS (
        SELECT DATE_TRUNC('month', expense_date)::date AS m_start, COALESCE(SUM(amount), 0) AS expense
        FROM expenses
        WHERE is_deleted = FALSE AND expense_date >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', expense_date)
      )
      SELECT 
        TO_CHAR(m.m_start, 'Mon YYYY') AS month_label,
        COALESCE(s.revenue, 0) AS revenue,
        COALESCE(e.expense, 0) AS expense,
        (COALESCE(s.revenue, 0) - COALESCE(e.expense, 0)) AS profit
      FROM months m
      LEFT JOIN m_sales s ON m.m_start = s.m_start
      LEFT JOIN m_exp e ON m.m_start = e.m_start
      ORDER BY m.m_start ASC;
    `);

    // 8. Order Payment & Status Funnel distribution
    const orderStatusDistribution = await pool.query(`
      SELECT order_status, COUNT(id) AS count, COALESCE(SUM(total_amount), 0) AS total_value
      FROM orders
      WHERE is_deleted = FALSE
      GROUP BY order_status;
    `);

    // 9. Quail Flock batch distribution
    const flockDistribution = await pool.query(`
      SELECT batch_name, current_count, mortality_count, 
             ROUND((current_count * avg_daily_feed_per_bird_grams) / 1000.0, 2) AS daily_feed_kg
      FROM livestock
      WHERE is_deleted = FALSE AND current_count > 0
      ORDER BY current_count DESC;
    `);

    const totalRev = Number(salesAgg.rows[0].total_revenue);
    const totalExp = Number(expensesAgg.rows[0].total_expenses);
    const todayRev = Number(salesAgg.rows[0].today_revenue);
    const todayExp = Number(expensesAgg.rows[0].today_expenses);

    const netProfitInHand = totalRev - totalExp;
    const todayNetProfit = todayRev - todayExp;

    const dailyFeedKg = Number(livestockAgg.rows[0].daily_feed_consumption_kg);
    const feedStockKg = Number(feedsAgg.rows[0].total_feed_stock_kg);
    const feedDaysLeft = dailyFeedKg > 0 ? Math.floor(feedStockKg / dailyFeedKg) : 999;

    res.json({
      success: true,
      summary: {
        totalRevenue: totalRev,
        totalExpenses: totalExp,
        netProfitInHand,
        todayRevenue: todayRev,
        todayExpenses: todayExp,
        todayNetProfit,
        totalCashCollected: Number(salesAgg.rows[0].total_cash_collected),
        pendingReceivables: Number(salesAgg.rows[0].pending_receivables),
        totalOrdersCount: Number(salesAgg.rows[0].total_orders_count),
        totalActiveQuails: Number(livestockAgg.rows[0].total_active_quails),
        totalMortality: Number(livestockAgg.rows[0].total_mortality),
        dailyFeedConsumptionKg: dailyFeedKg,
        totalFeedStockKg: feedStockKg,
        feedStockValueInHand: Number(feedsAgg.rows[0].total_feed_value_in_hand),
        feedDaysLeft,
      },
      dailyProfitTrend: dailyProfitTrend.rows,
      expenseBreakdown: expenseBreakdown.rows,
      monthlyComparison: monthlyComparison.rows,
      orderStatusDistribution: orderStatusDistribution.rows,
      flockDistribution: flockDistribution.rows,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, '[ComprehensivePnL] Error generating financial report');
    res.status(500).json({ success: false, message: 'Failed to calculate profit & loss' });
  }
}
