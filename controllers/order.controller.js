const axios = require("axios");
const Order = require("../models/Order");
const { getModel } = require("../utils/modelFactory");

class OrderController {
  static async getAllPaginatedData(baseUrl, headers) {
    const Order = getModel(req.dbConnection, "Order");

    let allOrders = [];
    let nextLink = `${baseUrl}/Orders?$orderby=CreationDate desc&$top=999999`;
    console.log("Next link:", nextLink);
    while (nextLink) {
      try {
        const response = await axios.get(nextLink, { headers });
        allOrders = [...allOrders, ...response.data.value];

        // Get the next link from the response
        nextLink = response.data["@odata.nextLink"];

        console.log("Next link:", nextLink);
        // If no next link, break the loop
        if (!nextLink) break;

        // If nextLink is a relative URL, make it absolute
        if (nextLink.startsWith("Orders")) {
          nextLink = `${baseUrl}/${nextLink}`;
        }

        // Add $top to the next link if it doesn't have it
        if (!nextLink.includes("$top=")) {
          nextLink += nextLink.includes("?") ? "&" : "?";
          nextLink += "$top=999999";
        }
      } catch (error) {
        throw new Error(`Pagination error: ${error.message}`);
      }
    }

    return allOrders;
  }

  static async getOrders(req, res) {
    try {
      const Order = getModel(req.dbConnection, "Order");
      const headers = {
        Cookie: req.headers.cookie,
      };

      // Fetch all paginated orders
      const orders = await OrderController.getAllPaginatedData(
        process.env.BASE_URL,
        headers
      );

      console.log("Total orders fetched:", orders.length);
      const results = await Promise.all(
        orders.map(async (order) => {
          try {
            const existingOrder = await Order.findOne({
              docEntry: order.DocEntry,
            });

            if (!existingOrder) {
              await Order.create({
                docEntry: order.DocEntry,
                verified: false,
                tag: null,
              });
              return {
                status: "stored",
                docEntry: order.DocEntry,
                message: "New sales order stored",
              };
            }

            // Attach the tag to the API response
            order.tag = existingOrder.tag;
            return {
              status: "existing",
              docEntry: order.DocEntry,
              message: "Sales order already exists",
            };
          } catch (err) {
            console.error(
              `Error processing sales order ${order.DocEntry}:`,
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
          const dbOrder = await Order.findOne({ docEntry: order.DocEntry });
          return {
            ...order,
            tag: dbOrder?.tag || null,
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
      console.error("Error fetching orders:", error);
      res.status(500).json({
        error: "Failed to fetch orders",
        details: error.response?.data || error.message,
      });
    }
  }

  static async addTag(req, res) {
    try {
      const Order = getModel(req.dbConnection, "Order");
      const { docEntry, tag } = req.body;

      if (!docEntry) {
        return res.status(400).json({
          error: "Both docEntry and tag are required",
        });
      }

      const order = await Order.findOne({ docEntry });

      if (!order) {
        console.log("Order not found");
        return res.status(404).json({
          error: "Sales order not found",
        });
      }

      order.tag = tag;
      await order.save();

      return res.json({
        message: "Tag updated successfully",
        docEntry,
        tag: order.tag,
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
      const Order = getModel(req.dbConnection, "Order");
      const { docEntry, tag } = req.body;

      if (!docEntry || !tag) {
        return res.status(400).json({
          error: "Both docEntry and tag are required",
        });
      }

      const order = await Order.findOne({ docEntry });

      if (!order) {
        return res.status(404).json({
          error: "Sales order not found",
        });
      }

      order.tags = order.tags.filter((t) => t !== tag);
      await order.save();

      res.json({
        message: "Tag removed successfully",
        docEntry,
        tags: order.tag,
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

module.exports = OrderController;
