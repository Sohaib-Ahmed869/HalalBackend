// routes/auth.routes.js
const express = require("express");
const BankStatementController = require("../controllers/bankStatement.controller");
const multer = require("multer");
const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file size limit
  },
});

router.post(
  "/upload",
  upload.single("file"), // 'file' is the field name in the form
  BankStatementController.uploadStatement
);

// Get all statements (with optional filtering)
router.get("/", BankStatementController.getStatements);

// Get statements by tag
router.get("/by-tag", BankStatementController.getStatementsByTag);

// Get tag statistics
router.get("/tag-stats", BankStatementController.getTagStats);

// Tag a statement
router.put("/:statementId/tag", BankStatementController.tagStatement);

// Get monthly summary
router.get("/monthly-summary", BankStatementController.getMonthlySummary);

// Get available banks
router.get("/banks", BankStatementController.getBanks);

module.exports = router;
