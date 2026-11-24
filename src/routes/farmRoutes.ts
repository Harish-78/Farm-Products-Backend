import { Router } from 'express';
import {
  getLivestock,
  createLivestock,
  updateLivestock,
  getFeeds,
  createFeed,
  updateFeedStock,
  triggerFeedCheckNow,
  getExpenses,
  createExpense,
  deleteExpense,
  getComprehensivePnL,
} from '../controllers/farmController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Secure all farm endpoints
router.use(authMiddleware);

// 1. Overall Financial & Daily/Monthly PnL Analytics
router.get('/pnl-summary', getComprehensivePnL);

// 2. Livestock / Quails
router.get('/livestock', getLivestock);
router.post('/livestock', createLivestock);
router.patch('/livestock/:id', updateLivestock);

// 3. Feeds & Consumption Prediction
router.get('/feeds', getFeeds);
router.post('/feeds', createFeed);
router.patch('/feeds/:id', updateFeedStock);
router.post('/feeds/check-alert', triggerFeedCheckNow);

// 4. Expenses (Dynamic categories: feed, labeling, packaging, etc.)
router.get('/expenses', getExpenses);
router.post('/expenses', createExpense);
router.delete('/expenses/:id', deleteExpense);

export default router;
