const express = require("express");
const router = express.Router();
const {
  getPayments,
  syncPayments,
  getPaymentStats,
  toggleVerified,
  processCSV,
  upload,
} = require("../controllers/payment.controller");
const multer = require("multer");

// Get paginated payments
router.get("/", getPayments);

// Sync payments for a specific period
router.post("/sync", syncPayments)

// Get payment statistics
router.get("/stats", getPaymentStats);

// Toggle payment verification status
router.patch("/:DocEntry/verify", toggleVerified);

router.post(
  "/upload-csv",
  multer({ dest: "temp/csv/" }).single("file"),
  processCSV
);

module.exports = router;
