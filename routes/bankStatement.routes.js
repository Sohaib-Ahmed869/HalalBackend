// routes/auth.routes.js
const express = require("express");
const BankStatementController = require("../controllers/bankStatement.controller");
const multer = require("multer");
const router = express.Router();

router.post(
  "/upload",
  multer().single("file"),
  BankStatementController.uploadStatement
);
router.get("/", BankStatementController.getStatements);

module.exports = router;
