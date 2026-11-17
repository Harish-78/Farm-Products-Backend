import { Router } from 'express';
import { getDashboardStats, getOrders, updateOrderStatus } from '../controllers/orderController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Protected admin endpoints
router.use(authMiddleware);

router.get('/dashboard-stats', getDashboardStats);
router.get('/', getOrders);
router.patch('/:id', updateOrderStatus);

export default router;
