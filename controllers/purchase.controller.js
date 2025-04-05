const PurchaseInvoice = require("../models/Purchase");
const { getModel } = require("../utils/modelFactory");

const purchaseInvoiceController = {
  // Get all purchase invoices (with optional tag filter)
  getAllPurchaseInvoices: async (req, res) => {
    try {
      const PurchaseInvoice = getModel(req.dbConnection, "PurchaseInvoice");
      const { page, limit } = req.query;
      const { tag } = req.query;
      let query = {};

      if (tag) {
        query.tags = tag;
      }

      const options = {
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 10,
      };

      const purchases = await PurchaseInvoice.paginate(query, options);
      res.json(purchases);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Get a single purchase invoice
  getPurchaseInvoice: async (req, res) => {
    try {
      const PurchaseInvoice = getModel(req.dbConnection, "PurchaseInvoice");

      const purchase = await PurchaseInvoice.findById(req.params.id);
      if (!purchase) {
        return res.status(404).json({ message: "Purchase invoice not found" });
      }
      res.json(purchase);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Add tags to a purchase invoice
  addTags: async (req, res) => {
    try {
      const PurchaseInvoice = getModel(req.dbConnection, "PurchaseInvoice");

      const { tags } = req.body;
      if (!Array.isArray(tags)) {
        return res
          .status(400)
          .json({ message: "Tags must be provided as an array" });
      }

      const purchase = await PurchaseInvoice.findById(req.params.id);
      if (!purchase) {
        return res.status(404).json({ message: "Purchase invoice not found" });
      }

      // Add new tags while avoiding duplicates
      const uniqueTags = [...new Set([...purchase.tags, ...tags])];
      purchase.tags = uniqueTags;

      const updatedPurchase = await purchase.save();
      res.json(updatedPurchase);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Remove tags from a purchase invoice
  removeTags: async (req, res) => {
    try {
      const PurchaseInvoice = getModel(req.dbConnection, "PurchaseInvoice");
      console.log(req.body);
      const { tags } = req.body;
      if (!Array.isArray(tags)) {
        return res
          .status(400)
          .json({ message: "Tags must be provided as an array" });
      }

      const purchase = await PurchaseInvoice.findById(req.params.id);
      if (!purchase) {
        return res.status(404).json({ message: "Purchase invoice not found" });
      }

      purchase.tags = purchase.tags.filter((tag) => !tags.includes(tag));
      const updatedPurchase = await purchase.save();
      res.json(updatedPurchase);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Get all unique tags
  getAllTags: async (req, res) => {
    try {
      const PurchaseInvoice = getModel(req.dbConnection, "PurchaseInvoice");

      const uniqueTags = await PurchaseInvoice.distinct("tags");
      res.json(uniqueTags);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
};

module.exports = purchaseInvoiceController;
