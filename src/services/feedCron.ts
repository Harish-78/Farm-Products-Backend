import cron from 'node-cron';
import { pool } from '../db/index.js';
import { logger } from '../config/logger.js';
import { config } from '../config/env.js';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export async function checkFeedStockAndAlert() {
  logger.info('[FeedAlertCron] Running feed stock consumption & exhaustion check...');
  try {
    // 1. Calculate total active bird count & daily feed consumption requirement
    const livestockResult = await pool.query(`
      SELECT 
        animal_type,
        SUM(current_count) AS total_animals,
        SUM((current_count * avg_daily_feed_per_bird_grams) / 1000.0) AS daily_feed_needed_kg
      FROM livestock
      WHERE is_deleted = FALSE AND current_count > 0
      GROUP BY animal_type;
    `);

    // 2. Query feeds inventory
    const feedResult = await pool.query(`
      SELECT id, feed_name, target_animal, current_stock_kg, reorder_alert_days
      FROM feed_inventory
      WHERE is_deleted = FALSE;
    `);

    const alertsToSend: Array<{
      feedName: string;
      animal: string;
      currentStock: number;
      dailyConsumption: number;
      daysRemaining: number;
      thresholdDays: number;
    }> = [];

    for (const feed of feedResult.rows) {
      const animalMatch = livestockResult.rows.find(
        (a) => a.animal_type.toLowerCase() === feed.target_animal.toLowerCase()
      );

      const dailyConsumption = animalMatch ? Number(animalMatch.daily_feed_needed_kg) : 0;
      const currentStock = Number(feed.current_stock_kg);
      const daysRemaining = dailyConsumption > 0 ? Math.floor(currentStock / dailyConsumption) : 999;
      const thresholdDays = Number(feed.reorder_alert_days || 10);

      // If feed will run out within the configured threshold (e.g. <= 10 days)
      if (dailyConsumption > 0 && daysRemaining <= thresholdDays) {
        alertsToSend.push({
          feedName: feed.feed_name,
          animal: feed.target_animal,
          currentStock,
          dailyConsumption,
          daysRemaining,
          thresholdDays,
        });
      }
    }

    if (alertsToSend.length > 0) {
      logger.warn(
        { alertsCount: alertsToSend.length },
        `[FeedAlertCron] ${alertsToSend.length} feed item(s) running low (<= 10 days remaining)!`
      );

      const targetEmail = config.email.user || 'harish.workspace.dev@gmail.com';
      const itemsListHtml = alertsToSend
        .map(
          (a) => `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 10px; font-weight: bold;">${a.feedName} (${a.animal})</td>
            <td style="padding: 10px; color: #b91c1c; font-weight: bold;">${a.currentStock.toFixed(1)} kg</td>
            <td style="padding: 10px;">${a.dailyConsumption.toFixed(1)} kg/day</td>
            <td style="padding: 10px; font-weight: bold; color: #dc2626;">${a.daysRemaining} days left!</td>
          </tr>`
        )
        .join('');

      const mailOptions = {
        from: `"Poongodi Farm Products Alert" <${config.email.user}>`,
        to: targetEmail,
        subject: `⚠️ URGENT: Feed Stock Low Alert (${alertsToSend.length} Feed(s) Depleting Soon)`,
        text: `Urgent Feed Alert: ${alertsToSend.map((a) => `${a.feedName} has only ${a.daysRemaining} days of stock remaining (${a.currentStock}kg left).`).join('\n')}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #fee2e2; border-radius: 8px; background: #fffdfd;">
            <h2 style="color: #991b1b; margin-top: 0;">⚠️ Low Feed Stock Depletion Alert</h2>
            <p style="color: #475569;">Our automated farm inventory system detected that the following feed stocks will be depleted in less than 10 days based on your current quail & livestock population:</p>
            
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; margin: 20px 0;">
              <thead>
                <tr style="background: #f1f5f9; color: #475569;">
                  <th style="padding: 8px;">Feed Name</th>
                  <th style="padding: 8px;">Stock In Hand</th>
                  <th style="padding: 8px;">Daily Used</th>
                  <th style="padding: 8px;">Est. Remaining</th>
                </tr>
              </thead>
              <tbody>
                ${itemsListHtml}
              </tbody>
            </table>
            
            <p style="color: #0f172a; font-weight: bold;">Please place an order with your feed supplier immediately to prevent feeding disruption.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 25px;">Poongodi Farm Products Automated Feed Consumption Scheduler</p>
          </div>
        `,
      };

      if (config.email.user && config.email.pass) {
        await transporter.sendMail(mailOptions);
        logger.info({ to: targetEmail }, '[FeedAlertCron] Alert email dispatched successfully via SMTP.');
      } else {
        logger.info(
          `[FeedAlertCron Simulation]: Alert for ${alertsToSend.map((a) => a.feedName).join(', ')} -> target ${targetEmail}`
        );
      }
    } else {
      logger.info('[FeedAlertCron] All feed inventories are sufficient (> 10 days).');
    }
  } catch (err: any) {
    logger.error({ err: err.message }, '[FeedAlertCron] Error executing feed inventory alert check');
  }
}

// Initialize node-cron: Runs daily at 07:00 AM
export function initFeedCronJob() {
  cron.schedule('0 7 * * *', () => {
    checkFeedStockAndAlert();
  });
  logger.info('[Cron] Automated Daily Feed Depletion Cron initialized (Runs 07:00 AM daily).');
}
