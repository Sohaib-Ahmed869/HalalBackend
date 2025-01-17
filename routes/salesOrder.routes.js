const express = require("express");
const router = express.Router();
const {
  getAllSalesOrders,
  getSalesOrdersByDateRange,
  getSalesOrderWithCustomer,
  generatePaymentLink,
  getUpdateOnPaymentLink
} = require("../controllers/salesOrder.controller");

// @route   GET /api/sales-orders
// @desc    Get all sales orders
// @access  Private
router.get("/", getAllSalesOrders);

// @route   GET /api/sales-orders/date-range
// @desc    Get sales orders by date range
// @access  Private
router.get("/date-range", getSalesOrdersByDateRange);
router.get("/with-customer", getSalesOrderWithCustomer);
router.post("/payment-link/:docNum", generatePaymentLink); 
router.get("/getUpdate/:docNum", getUpdateOnPaymentLink);


module.exports = router;
