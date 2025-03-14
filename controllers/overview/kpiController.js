// controllers/enhancedKpiController.js
const Invoice = require("../../models/invoice.model");
const PurchaseInvoice = require("../../models/Purchase");
const Payment = require("../../models/payment.model");
const Expense = require("../../models/expense.model");
const { processTagFilter } = require("../../utils/filterHelper");

// Define date filter for all queries
const enhancedKpiController = {
  /**
   * Get enhanced KPIs including:
   * - Sales growth
   * - Top selling products
   * - Customer retention
   * - Cash flow analysis
   * - Profitability by product/customer
   */
  getEnhancedKpis: async (req, res) => {
    try {
      const { startDate, endDate, previousStartDate, previousEndDate, tags } =
        req.query;

      // Validate date ranges
      if (!startDate || !endDate) {
        return res
          .status(400)
          .json({ message: "Start and end dates are required" });
      }
      // Set up date filters
      const dateFilter = {
        DocDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };

      const tagFilter = processTagFilter(tags);
      const currentPeriodFilter = {
        ...dateFilter,
        ...(Object.keys(tagFilter).length > 0 ? tagFilter : {}),
      }; // Previous period filter for comparison (if provided)
      const previousPeriodFilter =
        previousStartDate && previousEndDate
          ? {
              DocDate: {
                $gte: new Date(previousStartDate),
                $lte: new Date(previousEndDate),
              },
              ...(Object.keys(tagFilter).length > 0 ? tagFilter : {}),
            }
          : null;
      // Execute all queries in parallel for better performance
      const [
        currentPeriodSales,
        previousPeriodSales,
        topProducts,
        topCustomers,
        productProfitability,
        customerRetention,
        salesTrend,
      ] = await Promise.all([
        // Current period sales
        Invoice.aggregate([
          { $match: currentPeriodFilter },
          {
            $group: {
              _id: null,
              totalSales: { $sum: "$DocTotal" },
              totalVat: { $sum: "$VatSum" },
              totalWithVat: {
                $sum: { $add: ["$DocTotal", { $ifNull: ["$VatSum", 0] }] },
              },
              invoiceCount: { $sum: 1 },
              uniqueCustomers: { $addToSet: "$CardCode" },
            },
          },
          {
            $project: {
              _id: 0,
              totalSales: 1,
              totalVat: 1,
              totalWithVat: 1,
              invoiceCount: 1,
              uniqueCustomerCount: { $size: "$uniqueCustomers" },
              averageOrderValue: { $divide: ["$totalSales", "$invoiceCount"] },
            },
          },
        ]),

        // Previous period sales (for comparison)
        previousPeriodFilter
          ? Invoice.aggregate([
              { $match: previousPeriodFilter },
              {
                $group: {
                  _id: null,
                  totalSales: { $sum: "$DocTotal" },
                  totalVat: { $sum: "$VatSum" },
                  totalWithVat: {
                    $sum: { $add: ["$DocTotal", { $ifNull: ["$VatSum", 0] }] },
                  },
                  invoiceCount: { $sum: 1 },
                  uniqueCustomers: { $addToSet: "$CardCode" },
                },
              },
              {
                $project: {
                  _id: 0,
                  totalSales: 1,
                  totalVat: 1,
                  totalWithVat: 1,
                  invoiceCount: 1,
                  uniqueCustomerCount: { $size: "$uniqueCustomers" },
                  averageOrderValue: {
                    $divide: ["$totalSales", "$invoiceCount"],
                  },
                },
              },
            ])
          : Promise.resolve([
              { totalSales: 0, invoiceCount: 0, uniqueCustomerCount: 0 },
            ]),

        // Top selling products
        Invoice.aggregate([
          { $match: currentPeriodFilter },
          { $unwind: "$DocumentLines" },
          {
            $group: {
              _id: {
                itemCode: "$DocumentLines.ItemCode",
                itemName: "$DocumentLines.ItemDescription",
              },
              totalQuantity: { $sum: "$DocumentLines.Quantity" },
              totalSales: { $sum: "$DocumentLines.LineTotal" },
              orderCount: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              productCode: "$_id.itemCode",
              productName: "$_id.itemName",
              totalQuantity: 1,
              totalSales: 1,
              orderCount: 1,
            },
          },
          { $sort: { totalSales: -1 } },
          { $limit: 10 },
        ]),

        // Top customers
        Invoice.aggregate([
          { $match: currentPeriodFilter },
          {
            $group: {
              _id: {
                cardCode: "$CardCode",
                cardName: "$CardName",
              },
              totalPurchases: { $sum: 1 },
              totalSpent: { $sum: "$DocTotal" },
            },
          },
          {
            $project: {
              _id: 0,
              customerCode: "$_id.cardCode",
              customerName: "$_id.cardName",
              totalPurchases: 1,
              totalSpent: 1,
              averagePurchaseValue: {
                $divide: ["$totalSpent", "$totalPurchases"],
              },
            },
          },
          { $sort: { totalSpent: -1 } },
          { $limit: 10 },
        ]),

        // Product profitability
        Invoice.aggregate([
          { $match: currentPeriodFilter },
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
              _id: 0,
              productCode: "$_id.itemCode",
              productName: "$_id.itemName",
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
          { $sort: { profitMargin: -1 } },
          { $limit: 10 },
        ]),

        // Customer retention analysis
        Invoice.aggregate([
          { $match: currentPeriodFilter },
          { $sort: { DocDate: 1 } },
          {
            $group: {
              _id: "$CardCode",
              customerName: { $first: "$CardName" },
              firstPurchaseDate: { $first: "$DocDate" },
              lastPurchaseDate: { $last: "$DocDate" },
              purchaseCount: { $sum: 1 },
              totalSpent: { $sum: "$DocTotal" },
              purchases: {
                $push: {
                  date: "$DocDate",
                  amount: "$DocTotal",
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              customerCode: "$_id",
              customerName: 1,
              firstPurchaseDate: 1,
              lastPurchaseDate: 1,
              purchaseCount: 1,
              totalSpent: 1,
              daysBetweenFirstAndLastPurchase: {
                $round: [
                  {
                    $divide: [
                      {
                        $subtract: ["$lastPurchaseDate", "$firstPurchaseDate"],
                      },
                      1000 * 60 * 60 * 24, // Convert ms to days
                    ],
                  },
                  0,
                ],
              },
              averageDaysBetweenPurchases: {
                $cond: [
                  { $lte: ["$purchaseCount", 1] },
                  0,
                  {
                    $round: [
                      {
                        $divide: [
                          {
                            $divide: [
                              {
                                $subtract: [
                                  "$lastPurchaseDate",
                                  "$firstPurchaseDate",
                                ],
                              },
                              1000 * 60 * 60 * 24, // Convert ms to days
                            ],
                          },
                          { $subtract: ["$purchaseCount", 1] },
                        ],
                      },
                      0,
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { totalSpent: -1 } },
          { $limit: 20 },
        ]),

        // Sales trend by month
        Invoice.aggregate([
          {
            $match: {
              DocDate: {
                $gte: new Date(
                  new Date(startDate).getFullYear() - 1,
                  new Date(startDate).getMonth(),
                  1
                ),
                $lte: new Date(endDate),
              },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: "$DocDate" },
                month: { $month: "$DocDate" },
              },
              totalSales: { $sum: "$DocTotal" },
              invoiceCount: { $sum: 1 },
              uniqueCustomers: { $addToSet: "$CardCode" },
            },
          },
          {
            $project: {
              _id: 0,
              year: "$_id.year",
              month: "$_id.month",
              period: {
                $concat: [
                  { $toString: "$_id.year" },
                  "-",
                  {
                    $cond: {
                      if: { $lt: ["$_id.month", 10] },
                      then: { $concat: ["0", { $toString: "$_id.month" }] },
                      else: { $toString: "$_id.month" },
                    },
                  },
                ],
              },
              totalSales: 1,
              invoiceCount: 1,
              uniqueCustomerCount: { $size: "$uniqueCustomers" },
            },
          },
          { $sort: { year: 1, month: 1 } },
        ]),
      ]);

      // Calculate growth rates if previous period data is available
      const salesGrowth =
        previousPeriodSales[0]?.totalSales > 0
          ? ((currentPeriodSales[0]?.totalSales -
              previousPeriodSales[0]?.totalSales) /
              previousPeriodSales[0]?.totalSales) *
            100
          : null;

      const orderCountGrowth =
        previousPeriodSales[0]?.invoiceCount > 0
          ? ((currentPeriodSales[0]?.invoiceCount -
              previousPeriodSales[0]?.invoiceCount) /
              previousPeriodSales[0]?.invoiceCount) *
            100
          : null;

      const customerCountGrowth =
        previousPeriodSales[0]?.uniqueCustomerCount > 0
          ? ((currentPeriodSales[0]?.uniqueCustomerCount -
              previousPeriodSales[0]?.uniqueCustomerCount) /
              previousPeriodSales[0]?.uniqueCustomerCount) *
            100
          : null;

      // Combine results
      const enhancedKpis = {
        salesPerformance: {
          current: currentPeriodSales[0] || {},
          previous: previousPeriodSales[0] || {},
          growth: {
            sales:
              salesGrowth !== null ? parseFloat(salesGrowth.toFixed(2)) : null,
            orderCount:
              orderCountGrowth !== null
                ? parseFloat(orderCountGrowth.toFixed(2))
                : null,
            customerCount:
              customerCountGrowth !== null
                ? parseFloat(customerCountGrowth.toFixed(2))
                : null,
          },
        },
        topProducts,
        topCustomers,
        productProfitability,
        customerRetention,
        salesTrend,
      };

      res.json(enhancedKpis);
    } catch (error) {
      console.error("Enhanced KPI Error:", error);
      res.status(500).json({ message: error.message });
    }
  },

  /**
   * Get cash flow analytics
   */
  getCashFlowAnalytics: async (req, res) => {
    try {
      const { startDate, endDate, groupBy = "month", tags } = req.query;

      // Validate inputs
      if (!startDate || !endDate) {
        return res
          .status(400)
          .json({ message: "Start and end dates are required" });
      }

      // Define grouping format based on user selection
      let groupFormat;
      let dateFormat;

      // Create date filter
      const dateFilter = {
        DocDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };
      // Process tag filter
      const tagFilter = processTagFilter(tags);

      // Combine filters
      const combinedFilter = {
        ...dateFilter,
        ...(Object.keys(tagFilter).length > 0 ? tagFilter : {}),
      };

      switch (groupBy) {
        case "day":
          groupFormat = {
            year: { $year: "$DocDate" },
            month: { $month: "$DocDate" },
            day: { $dayOfMonth: "$DocDate" },
          };
          dateFormat = {
            $concat: [
              { $toString: "$_id.year" },
              "-",
              {
                $cond: {
                  if: { $lt: ["$_id.month", 10] },
                  then: { $concat: ["0", { $toString: "$_id.month" }] },
                  else: { $toString: "$_id.month" },
                },
              },
              "-",
              {
                $cond: {
                  if: { $lt: ["$_id.day", 10] },
                  then: { $concat: ["0", { $toString: "$_id.day" }] },
                  else: { $toString: "$_id.day" },
                },
              },
            ],
          };
          break;
        case "week":
          groupFormat = {
            year: { $year: "$DocDate" },
            week: { $week: "$DocDate" },
          };
          dateFormat = {
            $concat: [
              { $toString: "$_id.year" },
              "-W",
              {
                $cond: {
                  if: { $lt: ["$_id.week", 10] },
                  then: { $concat: ["0", { $toString: "$_id.week" }] },
                  else: { $toString: "$_id.week" },
                },
              },
            ],
          };
          break;
        case "quarter":
          groupFormat = {
            year: { $year: "$DocDate" },
            quarter: {
              $ceil: {
                $divide: [{ $month: "$DocDate" }, 3],
              },
            },
          };
          dateFormat = {
            $concat: [
              { $toString: "$_id.year" },
              "-Q",
              { $toString: "$_id.quarter" },
            ],
          };
          break;
        default: // month (default)
          groupFormat = {
            year: { $year: "$DocDate" },
            month: { $month: "$DocDate" },
          };
          dateFormat = {
            $concat: [
              { $toString: "$_id.year" },
              "-",
              {
                $cond: {
                  if: { $lt: ["$_id.month", 10] },
                  then: { $concat: ["0", { $toString: "$_id.month" }] },
                  else: { $toString: "$_id.month" },
                },
              },
            ],
          };
      }

      // Run aggregations in parallel
      const [incomingCashFlow, outgoingCashFlow] = await Promise.all([
        // Income (payments received)
        Payment.aggregate([
          {
            $match: combinedFilter,
          },
          {
            $group: {
              _id: groupFormat,
              totalAmount: { $sum: "$DocTotal" },
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              period: dateFormat,
              totalAmount: { $round: ["$totalAmount", 2] },
              count: 1,
              type: { $literal: "income" },
            },
          },
          { $sort: { period: 1 } },
        ]),

        // Outgoing (purchases + expenses)
        Promise.all([
          // Purchases
          PurchaseInvoice.aggregate([
            {
              $match: combinedFilter,
            },
            {
              $group: {
                _id: groupFormat,
                totalAmount: { $sum: "$DocTotal" },
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                period: dateFormat,
                totalAmount: { $round: ["$totalAmount", 2] },
                count: 1,
                type: { $literal: "purchase" },
              },
            },
            { $sort: { period: 1 } },
          ]),

          // Expenses
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
                _id: {
                  year: { $year: "$createdAt" },
                  month: { $month: "$createdAt" },
                  day: { $dayOfMonth: "$createdAt" },
                  // Add more fields based on groupBy
                },
                totalAmount: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                // Recreate same date format as above based on groupBy
                period: {
                  $concat: [
                    { $toString: "$_id.year" },
                    "-",
                    {
                      $cond: {
                        if: { $lt: ["$_id.month", 10] },
                        then: { $concat: ["0", { $toString: "$_id.month" }] },
                        else: { $toString: "$_id.month" },
                      },
                    },
                    // Add more concatenation based on groupBy
                  ],
                },
                totalAmount: { $round: ["$totalAmount", 2] },
                count: 1,
                type: { $literal: "expense" },
              },
            },
            { $sort: { period: 1 } },
          ]),
        ]).then(([purchases, expenses]) => [...purchases, ...expenses]),
      ]);

      // Combine all periods for complete timeline
      const allPeriods = new Set([
        ...incomingCashFlow.map((item) => item.period),
        ...outgoingCashFlow.map((item) => item.period),
      ]);

      // Create final cash flow analysis with complete data for each period
      const cashFlowAnalysis = Array.from(allPeriods)
        .sort()
        .map((period) => {
          // Find income for this period
          const income = incomingCashFlow.find(
            (item) => item.period === period
          ) || {
            totalAmount: 0,
            count: 0,
          };

          // Find purchases for this period
          const purchases = outgoingCashFlow
            .filter(
              (item) => item.period === period && item.type === "purchase"
            )
            .reduce(
              (sum, item) => ({
                totalAmount: sum.totalAmount + item.totalAmount,
                count: sum.count + item.count,
              }),
              { totalAmount: 0, count: 0 }
            );

          // Find expenses for this period
          const expenses = outgoingCashFlow
            .filter((item) => item.period === period && item.type === "expense")
            .reduce(
              (sum, item) => ({
                totalAmount: sum.totalAmount + item.totalAmount,
                count: sum.count + item.count,
              }),
              { totalAmount: 0, count: 0 }
            );

          // Calculate net cash flow
          const netCashFlow =
            income.totalAmount - (purchases.totalAmount + expenses.totalAmount);

          return {
            period,
            income: income.totalAmount,
            incomeTransactions: income.count,
            purchases: purchases.totalAmount,
            purchaseTransactions: purchases.count,
            expenses: expenses.totalAmount,
            expenseTransactions: expenses.count,
            netCashFlow: parseFloat(netCashFlow.toFixed(2)),
          };
        });

      res.json({
        cashFlowAnalysis,
        summary: {
          totalIncome: incomingCashFlow.reduce(
            (sum, item) => sum + item.totalAmount,
            0
          ),
          totalPurchases: outgoingCashFlow
            .filter((item) => item.type === "purchase")
            .reduce((sum, item) => sum + item.totalAmount, 0),
          totalExpenses: outgoingCashFlow
            .filter((item) => item.type === "expense")
            .reduce((sum, item) => sum + item.totalAmount, 0),
          netCashFlow:
            incomingCashFlow.reduce((sum, item) => sum + item.totalAmount, 0) -
            outgoingCashFlow.reduce((sum, item) => sum + item.totalAmount, 0),
        },
      });
    } catch (error) {
      console.error("Cash Flow Analytics Error:", error);
      res.status(500).json({ message: error.message });
    }
  },
};

module.exports = enhancedKpiController;
