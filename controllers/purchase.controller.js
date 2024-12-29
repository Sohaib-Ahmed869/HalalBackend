const axios = require("axios");
const Purchase = require("../models/purchase.model");

class PurchaseController {
  static async getPurchaseOrders(req, res) {
    try {
      const response = await axios.get(
        `${process.env.BASE_URL}/PurchaseOrders`,
        {
          headers: {
            Cookie: req.headers.cookie,
          },
        }
      );

      // Process each purchase order
      const orders = response.data.value;
      const results = await Promise.all(
        orders.map(async (order) => {
          try {
            const existingPurchase = await Purchase.findOne({
              docEntry: order.DocEntry,
            });

            if (!existingPurchase) {
              // Store new purchase
              await Purchase.create({
                docEntry: order.DocEntry,
                verified: false,
                tag: null,
              });
              return {
                status: "stored",
                docEntry: order.DocEntry,
                message: "New purchase order stored",
              };
            }
            // Attach the tag to the API response
            order.tag = existingPurchase.tag;
            return {
              status: "existing",
              docEntry: order.DocEntry,
              message: "Purchase order already exists",
            };
          } catch (err) {
            console.error(
              `Error processing purchase order ${order.DocEntry}:`,
              err
            );
            return {
              status: "error",
              docEntry: order.DocEntry,
              message: err.message,
            };
          }
        })
      );

      // Attach MongoDB data to API response
      const ordersWithTags = await Promise.all(
        orders.map(async (order) => {
          const dbPurchase = await Purchase.findOne({
            docEntry: order.DocEntry,
          });
          return {
            ...order,
            tag: dbPurchase?.tag || null,
          };
        })
      );

      const summary = {
        total: results.length,
        stored: results.filter((r) => r.status === "stored").length,
        existing: results.filter((r) => r.status === "existing").length,
        errors: results.filter((r) => r.status === "error").length,
      };

      res.json({
        summary,
        processingResults: results,
        orders: ordersWithTags,
      });
    } catch (error) {
      console.error(
        "Error fetching purchase orders:",
        error.response?.data || error.message
      );
      res.status(500).json({
        error: "Failed to fetch purchase orders",
        details: error.response?.data || error.message,
      });
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
