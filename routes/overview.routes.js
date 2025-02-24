// routes/api.js
const express = require("express");
const router = express.Router();

// Import controllers
const overviewController = require("../controllers/overview/overview.controller");
const productController = require("../controllers/overview/productController");
const customerController = require("../controllers/overview/customerController");
const enhancedKpiController = require("../controllers/overview/kpiController");
const tagsController = require("../controllers/overview/tagController");

// Overview routes (existing)
router.get("/", overviewController.getOverview);

// Product routes
router.get("/products", productController.getProductAnalytics);
router.get(
  "/products/:productCode/orders",
  productController.getProductOrderHistory
);

// Customer routes
router.get("/customers", customerController.getCustomers);
router.get(
  "/customers/:customerCode/journey",
  customerController.getCustomerJourney
);
router.get("/orders/:invoiceId", customerController.getOrderDetails);

// Enhanced KPI routes
router.get("/enhanced-kpis", enhancedKpiController.getEnhancedKpis);
router.get("/cash-flow", enhancedKpiController.getCashFlowAnalytics);

// Tags routes
router.get("/tags", tagsController.getAllTags);
router.get("/tags/:tagName/purchases", tagsController.getPurchasesByTag);

module.exports = router;
