const axios = require("axios");
const Purchase = require("../models/Purchase");

class PurchaseController {
  static async getPurchaseOrders(req, res) {
    try {
      const {
        page = 1,
        limit = 100,
        sortField = "docEntry",
        sortOrder = -1,
      } = req.query;
      const skip = (page - 1) * limit;

      const purchases = await Purchase.find()
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Purchase.countDocuments();

      res.json({
        data: purchases,
        metadata: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalRecords: total,
          limit: parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Error fetching purchases:", error);
      res.status(500).json({ error: "Failed to fetch purchases" });
    }
  }

  static async addTag(req, res) {
    try {
      const { docEntry, tag } = req.body;

      if (!docEntry) {
        return res.status(400).json({
          error: "Both docEntry and tag are required",
        });
      }

      const purchase = await Purchase.findOne({ docEntry });

      if (!purchase) {
        return res.status(404).json({
          error: "Purchase order not found",
        });
      }

      // Update the tag
      purchase.tag = tag;
      await purchase.save();

      return res.json({
        message: "Tag updated successfully",
        docEntry,
        tag: purchase.tag,
      });
    } catch (error) {
      console.error("Error adding tag:", error);
      res.status(500).json({
        error: "Failed to add tag",
        details: error.message,
      });
    }
  }

  static async removeTag(req, res) {
    try {
      const { docEntry } = req.body;

      if (!docEntry) {
        return res.status(400).json({
          error: "DocEntry is required",
        });
      }

      const purchase = await Purchase.findOne({ docEntry });

      if (!purchase) {
        return res.status(404).json({
          error: "Purchase order not found",
        });
      }

      // Set tag to null
      purchase.tag = null;
      await purchase.save();

      res.json({
        message: "Tag removed successfully",
        docEntry,
        tag: null,
      });
    } catch (error) {
      console.error("Error removing tag:", error);
      res.status(500).json({
        error: "Failed to remove tag",
        details: error.message,
      });
    }
  }
}

module.exports = PurchaseController;
