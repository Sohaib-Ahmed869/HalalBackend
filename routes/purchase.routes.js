// routes/invoice.routes.js
const express = require("express");
const PurchaseController = require("../controllers/purchase.controller");

const router = express.Router();

router.get("/", PurchaseController.getPurchaseOrders);
router.post("/tag", PurchaseController.addTag);
router.delete("/tag", PurchaseController.removeTag);

module.exports = router;
