// routes/invoice.routes.js
const express = require("express");
const InvoiceController = require("../controllers/invoice.controller");

const router = express.Router();

// Basic invoice operations
router.get("/", InvoiceController.getInvoices);
router.get("/by-date", InvoiceController.getInvoicesByDate);

// Sync operation
router.post("/sync/:year", InvoiceController.syncInvoices);

// Statistics and reporting
router.get("/stats", InvoiceController.getInvoiceStats);
router.get("/payment-stats/:year", InvoiceController.getPaymentMethodStats);

// Invoice management
router.patch("/:DocEntry/tag", InvoiceController.updateInvoiceTag);
router.patch("/:DocEntry/verify", InvoiceController.toggleVerified);

router.get("/customer-stats", InvoiceController.getCustomerStats);
router.get("/by-customer", InvoiceController.getCustomerInvoices);

router.get("/dashboard-stats", InvoiceController.getDashboardStats);

router.put("/customer", InvoiceController.updateCustomerTag);

router.post(
  "/update-paymentMethods-POS",
  InvoiceController.updatePOSPaymentMethods
);

module.exports = router;
