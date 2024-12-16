// routes/invoice.routes.js
const express = require('express');
const OrderController = require('../controllers/order.controller');

const router = express.Router();

router.get('/', OrderController.getOrders);
router.post('/tag', OrderController.addTag);
router.delete('/tag', OrderController.removeTag);

module.exports = router;