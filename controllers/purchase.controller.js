const axios = require("axios");
const Purchase = require("../models/Purchase");

class PurchaseController {
  static async getPurchaseOrders(req, res) {
    try {
      const purchases = await Purchase.find().lean();

      const formattedPurchases = purchases.map((purchase) => ({
        customerName: purchase.CardName || "",
        invoiceNum: purchase.DocNum || "",
        creationDate: purchase.CreateDate || "",
        transactionDate: purchase.DocDate || "",
        transactionNum: purchase.DocEntry || "",
        amount: purchase.DocTotal || 0,
        documentNum: purchase.docEntry || "",
        method: purchase.PaymentMethod || "",
        tag: purchase.tag || null,
        verified: purchase.verified ? "Yes" : "No",
      }));

      res.json({
        data: formattedPurchases,
        orders: formattedPurchases, // matching frontend structure
      });
    } catch (error) {
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
