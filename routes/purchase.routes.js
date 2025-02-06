const express = require("express");
const router = express.Router();
const purchaseInvoiceController = require("../controllers/purchase.controller");

// Get all purchase invoices (with optional tag filter)
router.get("/", purchaseInvoiceController.getAllPurchaseInvoices);

// Get a single purchase invoice
router.get("/:id", purchaseInvoiceController.getPurchaseInvoice);

// Add tags to a purchase invoice
router.post("/:id/tags", purchaseInvoiceController.addTags);

// Remove tags from a purchase invoice
router.delete("/:id/tags", purchaseInvoiceController.removeTags);

// Get all unique tags
router.get("/tags", purchaseInvoiceController.getAllTags);

module.exports = router;
