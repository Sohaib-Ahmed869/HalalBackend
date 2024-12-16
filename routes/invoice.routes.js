// routes/invoice.routes.js
const express = require('express');
const InvoiceController = require('../controllers/invoice.controller');

const router = express.Router();

router.get('/', InvoiceController.getInvoices);
router.get('/by-date', InvoiceController.getInvoicesByDate);

module.exports = router;