const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/payment.controller');

// Get paginated payments
router.get('/', PaymentController.getPayments);

// Sync payments for a specific period
router.post('/sync', PaymentController.syncPayments);

// Get payment statistics
router.get('/stats', PaymentController.getPaymentStats);

// Toggle payment verification status
router.patch('/:DocEntry/verify', PaymentController.toggleVerified);

module.exports = router;