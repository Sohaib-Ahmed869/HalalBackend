// controllers/overviewController.js
const PurchaseInvoice = require("../models/Purchase");
const Invoice = require("../models/invoice.model");
const Payment = require("../models/payment.model");
const Tag = require("../models/tags.model");
const Expense = require("../models/expense.model");

const overviewController = {
  getOverview: async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const dateFilter = {
        DocDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };

      // 1. Purchases by Tags
      const purchasesByTags = await PurchaseInvoice.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: { tag: { $ifNull: ["$tags", "Untagged"] } },
            totalAmount: { $sum: "$DocTotal" },
            count: { $sum: 1 },
            vatSum: { $sum: "$VatSum" },
            totalWithVat: {
              $sum: { $add: ["$DocTotal", { $ifNull: ["$VatSum", 0] }] },
            },
            averageAmount: { $avg: "$DocTotal" },
          },
        },
        {
          $unwind: "$_id.tag",
        },
        {
          $project: {
            tag: "$_id.tag",
            totalAmount: { $round: ["$totalAmount", 2] },
            count: 1,
            vatSum: { $round: ["$vatSum", 2] },
            totalWithVat: { $round: ["$totalWithVat", 2] },
            averageAmount: { $round: ["$averageAmount", 2] },
          },
        },
      ]);

      // 2. Sales by Clients with division by zero protection
      const salesByClients = await Invoice.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: {
              cardCode: "$CardCode",
              cardName: "$CardName",
            },
            totalQuantity: {
              $sum: {
                $reduce: {
                  input: "$DocumentLines",
                  initialValue: 0,
                  in: { $add: ["$$value", "$$this.Quantity"] },
                },
              },
            },
            netSales: { $sum: "$DocTotal" },
            grossProfit: {
              $sum: {
                $subtract: [
                  "$DocTotal",
                  {
                    $reduce: {
                      input: "$DocumentLines",
                      initialValue: 0,
                      in: {
                        $add: [
                          "$$value",
                          {
                            $multiply: [
                              "$$this.Quantity",
                              { $ifNull: ["$$this.UnitPrice", 0] },
                            ],
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        {
          $project: {
            client: "$_id.cardName",
            clientCode: "$_id.cardCode",
            totalQuantity: 1,
            netSales: { $round: ["$netSales", 2] },
            grossProfit: { $round: ["$grossProfit", 2] },
            profitMargin: {
              $round: [
                {
                  $cond: [
                    { $eq: ["$netSales", 0] },
                    0,
                    {
                      $multiply: [
                        { $divide: ["$grossProfit", "$netSales"] },
                        100,
                      ],
                    },
                  ],
                },
                2,
              ],
            },
          },
        },
        { $sort: { netSales: -1 } },
      ]);
      // 3. Sales by Products with division by zero protection
      const salesByProducts = await Invoice.aggregate([
        { $match: dateFilter },
        { $unwind: "$DocumentLines" },
        {
          $group: {
            _id: {
              itemCode: "$DocumentLines.ItemCode",
              itemName: "$DocumentLines.ItemDescription",
            },
            totalQuantity: { $sum: "$DocumentLines.Quantity" },
            netSales: { $sum: "$DocumentLines.LineTotal" },
            grossProfit: {
              $sum: {
                $subtract: [
                  "$DocumentLines.LineTotal",
                  {
                    $multiply: [
                      "$DocumentLines.Quantity",
                      { $ifNull: ["$DocumentLines.UnitPrice", 0] },
                    ],
                  },
                ],
              },
            },
          },
        },
        {
          $project: {
            product: "$_id.itemName",
            productCode: "$_id.itemCode",
            totalQuantity: 1,
            netSales: { $round: ["$netSales", 2] },
            grossProfit: { $round: ["$grossProfit", 2] },
            profitMargin: {
              $round: [
                {
                  $cond: [
                    { $eq: ["$netSales", 0] },
                    0,
                    {
                      $multiply: [
                        { $divide: ["$grossProfit", "$netSales"] },
                        100,
                      ],
                    },
                  ],
                },
                2,
              ],
            },
          },
        },
        { $sort: { netSales: -1 } },
      ]);

      // 4. Period Overview
      const periodOverview = await Promise.all([
        // Total Sales
        Invoice.aggregate([
          { $match: dateFilter },
          {
            $group: {
              _id: null,
              totalSales: { $sum: "$DocTotal" },
              totalVat: { $sum: "$VatSum" },
              totalWithVat: {
                $sum: { $add: ["$DocTotal", { $ifNull: ["$VatSum", 0] }] },
              },
            },
          },
        ]),

        // Total Payments Received
        Payment.aggregate([
          { $match: dateFilter },
          {
            $group: {
              _id: null,
              totalReceived: { $sum: "$DocTotal" },
            },
          },
        ]),

        // Total Purchases
        PurchaseInvoice.aggregate([
          { $match: dateFilter },
          {
            $group: {
              _id: null,
              totalPurchases: { $sum: "$DocTotal" },
              totalPurchaseVat: { $sum: "$VatSum" },
            },
          },
        ]),

        // Total Expenses
        Expense.aggregate([
          {
            $match: {
              createdAt: {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
              },
            },
          },
          {
            $group: {
              _id: "$tag",
              totalAmount: { $sum: "$amount" },
            },
          },
        ]),
      ]);

      // Calculate financial metrics
      const financialMetrics = {
        sales: {
          withoutVat: periodOverview[0][0]?.totalSales || 0,
          vat: periodOverview[0][0]?.totalVat || 0,
          withVat: periodOverview[0][0]?.totalWithVat || 0,
        },
        paymentsReceived: periodOverview[1][0]?.totalReceived || 0,
        purchases: {
          withoutVat: periodOverview[2][0]?.totalPurchases || 0,
          vat: periodOverview[2][0]?.totalPurchaseVat || 0,
          withVat:
            (periodOverview[2][0]?.totalPurchases || 0) +
            (periodOverview[2][0]?.totalPurchaseVat || 0),
        },
        expenses: periodOverview[3].reduce(
          (acc, curr) => acc + curr.totalAmount,
          0
        ),
        profitability: {
          grossProfit:
            (periodOverview[0][0]?.totalSales || 0) -
            (periodOverview[2][0]?.totalPurchases || 0),
          netProfit:
            (periodOverview[0][0]?.totalSales || 0) -
            (periodOverview[2][0]?.totalPurchases || 0) -
            periodOverview[3].reduce((acc, curr) => acc + curr.totalAmount, 0),
        },
      };

      const detailedExpenses = await Expense.find({
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      }).sort({ createdAt: -1 });

      res.json({
        purchasesByTags,
        salesByClients,
        salesByProducts,
        financialMetrics,
        expensesByTag: periodOverview[3],
        detailedExpenses,
      });
    } catch (error) {
      console.error("Overview Error:", error);
      res.status(500).json({ message: error.message });
    }
  },
};

module.exports = overviewController;
