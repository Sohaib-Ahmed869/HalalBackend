// controllers/productController.js
const Invoice = require("../../models/invoice.model");
const mongoose = require("mongoose");

const productController = {
  /**
   * Get product analytics with sales information
   */
  getProductAnalytics: async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const dateFilter = {
        DocDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };

      // Get aggregated product data with sales metrics
      const productsWithSales = await Invoice.aggregate([
        { $match: dateFilter },
        { $unwind: "$DocumentLines" },
        {
          $group: {
            _id: {
              itemCode: "$DocumentLines.ItemCode",
              itemName: "$DocumentLines.ItemDescription",
            },
            timesPurchased: { $sum: 1 },
            totalQuantity: { $sum: "$DocumentLines.Quantity" },
            totalSalesWithoutVat: { $sum: "$DocumentLines.LineTotal" },
            totalSalesWithVat: {
              $sum: {
                $multiply: [
                  "$DocumentLines.LineTotal",
                  {
                    $add: [
                      1,
                      {
                        $divide: [
                          {
                            $ifNull: ["$DocumentLines.TaxPercentagePerRow", 0],
                          },
                          100,
                        ],
                      },
                    ],
                  },
                ],
              },
            },
            averageUnitPrice: { $avg: "$DocumentLines.Price" },
            orders: {
              $addToSet: {
                invoiceId: "$DocEntry",
                invoiceNum: "$DocNum",
                customer: "$CardName",
                date: "$DocDate",
                quantity: "$DocumentLines.Quantity",
                unitPrice: "$DocumentLines.Price",
                lineTotal: "$DocumentLines.LineTotal",
              },
            },
          },
        },
        {
          $project: {
            productCode: "$_id.itemCode",
            productName: "$_id.itemName",
            timesPurchased: 1,
            totalQuantity: 1,
            totalSalesWithoutVat: { $round: ["$totalSalesWithoutVat", 2] },
            totalSalesWithVat: { $round: ["$totalSalesWithVat", 2] },
            averageUnitPrice: { $round: ["$averageUnitPrice", 2] },
            orderCount: { $size: "$orders" },
            // Don't return full orders array here, just the count
          },
        },
        { $sort: { totalSalesWithoutVat: -1 } },
      ]);

      res.json(productsWithSales);
    } catch (error) {
      console.error("Product Analytics Error:", error);
      res.status(500).json({ message: error.message });
    }
  },

  /**
   * Get order history for a specific product
   */
  getProductOrderHistory: async (req, res) => {
    try {
      const { productCode } = req.params;
      const { page = 1, limit = 10, startDate, endDate } = req.query;

      const dateFilter = {};
      if (startDate && endDate) {
        dateFilter.DocDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }

      // Find all invoices that contain the product
      const productOrderHistory = await Invoice.aggregate([
        {
          $match: {
            ...dateFilter,
            "DocumentLines.ItemCode": productCode,
          },
        },
        { $unwind: "$DocumentLines" },
        {
          $match: {
            "DocumentLines.ItemCode": productCode,
          },
        },
        {
          $project: {
            invoiceId: "$DocEntry",
            invoiceNum: "$DocNum",
            customer: "$CardName",
            customerCode: "$CardCode",
            date: "$DocDate",
            quantity: "$DocumentLines.Quantity",
            unitPrice: "$DocumentLines.Price",
            lineTotal: "$DocumentLines.LineTotal",
            vatAmount: {
              $multiply: [
                "$DocumentLines.LineTotal",
                {
                  $divide: [
                    { $ifNull: ["$DocumentLines.TaxPercentagePerRow", 0] },
                    100,
                  ],
                },
              ],
            },
            totalWithVat: {
              $multiply: [
                "$DocumentLines.LineTotal",
                {
                  $add: [
                    1,
                    {
                      $divide: [
                        { $ifNull: ["$DocumentLines.TaxPercentagePerRow", 0] },
                        100,
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        { $sort: { date: -1 } },
        {
          $facet: {
            metadata: [
              { $count: "total" },
              {
                $addFields: {
                  page: parseInt(page),
                  pages: { $ceil: { $divide: ["$total", parseInt(limit)] } },
                },
              },
            ],
            data: [
              { $skip: (parseInt(page) - 1) * parseInt(limit) },
              { $limit: parseInt(limit) },
            ],
          },
        },
      ]);

      // Format response with pagination
      const result = {
        orders: productOrderHistory[0].data || [],
        pagination: productOrderHistory[0].metadata[0] || {
          total: 0,
          page: parseInt(page),
          pages: 0,
        },
      };

      res.json(result);
    } catch (error) {
      console.error("Product Order History Error:", error);
      res.status(500).json({ message: error.message });
    }
  },
};

module.exports = productController;
