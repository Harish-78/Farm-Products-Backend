import { Router } from 'express';
import { getDashboardStats, createOrder, getOrders, updateOrderStatus, deleteOrder } from '../controllers/orderController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Protected admin endpoints
router.use(authMiddleware);

router.get('/dashboard-stats', getDashboardStats);
router.post('/', createOrder);
router.get('/', getOrders);
router.patch('/:id', updateOrderStatus);
router.delete('/:id', deleteOrder);

export default router;
