// routes/deposit.routes.js
const express = require('express');
const DepositController = require('../controllers/deposit.controller');

const router = express.Router();

router.get('/', DepositController.getDeposits);
router.get('/by-date', DepositController.getDepositsByDate);

module.exports = router;