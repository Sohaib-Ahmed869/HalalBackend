// controllers/customerController.js
const Invoice = require("../../models/invoice.model");
const Payment = require("../../models/payment.model");
const mongoose = require("mongoose");

const customerController = {
  /**
   * Get customer list with summary metrics
   */
  getCustomers: async (req, res) => {
    try {
      const {
        startDate,
        endDate,
        page = 1,
        limit = 10,
        sortBy = "totalPurchases",
        sortOrder = "desc",
      } = req.query;

      const dateFilter = {};
      if (startDate && endDate) {
        dateFilter.DocDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }

      // Sort configuration
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

      // Get aggregated customer data with purchase metrics
      const customersData = await Invoice.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: {
              cardCode: "$CardCode",
              cardName: "$CardName",
            },
            firstPurchaseDate: { $min: "$DocDate" },
            lastPurchaseDate: { $max: "$DocDate" },
            totalPurchases: { $sum: 1 },
            totalAmount: { $sum: "$DocTotal" },
            totalAmountWithVat: {
              $sum: { $add: ["$DocTotal", { $ifNull: ["$VatSum", 0] }] },
            },
            invoices: {
              $push: {
                docEntry: "$DocEntry",
                docNum: "$DocNum",
                docDate: "$DocDate",
                docTotal: "$DocTotal",
                vatSum: "$VatSum",
              },
            },
          },
        },
        {
          $project: {
            customerCode: "$_id.cardCode",
            customerName: "$_id.cardName",
            firstPurchaseDate: 1,
            lastPurchaseDate: 1,
            totalPurchases: 1,
            totalAmount: { $round: ["$totalAmount", 2] },
            totalAmountWithVat: { $round: ["$totalAmountWithVat", 2] },
            averagePurchaseValue: {
              $round: [{ $divide: ["$totalAmount", "$totalPurchases"] }, 2],
            },
            daysSinceLastPurchase: {
              $round: [
                {
                  $divide: [
                    {
                      $subtract: [new Date(), "$lastPurchaseDate"],
                    },
                    1000 * 60 * 60 * 24, // Convert ms to days
                  ],
                },
                0,
              ],
            },
            // Don't return full invoices array here, just the count
          },
        },
        { $sort: sortOptions },
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
        customers: customersData[0].data || [],
        pagination: customersData[0].metadata[0] || {
          total: 0,
          page: parseInt(page),
          pages: 0,
        },
      };

      res.json(result);
    } catch (error) {
      console.error("Get Customers Error:", error);
      res.status(500).json({ message: error.message });
    }
  },

  /**
   * Get customer journey timeline with all orders
   */
  getCustomerJourney: async (req, res) => {
    try {
      const { customerCode } = req.params;
      const { page = 1, limit = 10, startDate, endDate } = req.query;

      const dateFilter = { CardCode: customerCode };
      if (startDate && endDate) {
        dateFilter.DocDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }

      // Get all invoices for the specified customer
      const invoices = await Invoice.find(dateFilter)
        .sort({ DocDate: -1 })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .select({
          DocEntry: 1,
          DocNum: 1,
          DocDate: 1,
          DocTotal: 1,
          VatSum: 1,
          CardName: 1,
          Comments: 1,
          DocumentLines: 1,
        });

      // Get count for pagination
      const totalInvoices = await Invoice.countDocuments(dateFilter);

      // Get customer summary metrics
      const customerSummary = await Invoice.aggregate([
        { $match: { CardCode: customerCode } },
        {
          $group: {
            _id: {
              cardCode: "$CardCode",
              cardName: "$CardName",
            },
            firstPurchaseDate: { $min: "$DocDate" },
            lastPurchaseDate: { $max: "$DocDate" },
            totalPurchases: { $sum: 1 },
            totalAmount: { $sum: "$DocTotal" },
            totalAmountWithVat: {
              $sum: { $add: ["$DocTotal", { $ifNull: ["$VatSum", 0] }] },
            },
          },
        },
        {
          $project: {
            customerCode: "$_id.cardCode",
            customerName: "$_id.cardName",
            firstPurchaseDate: 1,
            lastPurchaseDate: 1,
            totalPurchases: 1,
            totalAmount: { $round: ["$totalAmount", 2] },
            totalAmountWithVat: { $round: ["$totalAmountWithVat", 2] },
            averagePurchaseValue: {
              $round: [{ $divide: ["$totalAmount", "$totalPurchases"] }, 2],
            },
            daysSinceFirstPurchase: {
              $round: [
                {
                  $divide: [
                    {
                      $subtract: [new Date(), "$firstPurchaseDate"],
                    },
                    1000 * 60 * 60 * 24, // Convert ms to days
                  ],
                },
                0,
              ],
            },
            daysSinceLastPurchase: {
              $round: [
                {
                  $divide: [
                    {
                      $subtract: [new Date(), "$lastPurchaseDate"],
                    },
                    1000 * 60 * 60 * 24, // Convert ms to days
                  ],
                },
                0,
              ],
            },
          },
        },
      ]);

      // Format response
      const result = {
        customerInfo: customerSummary.length > 0 ? customerSummary[0] : null,
        invoices: invoices,
        pagination: {
          total: totalInvoices,
          page: parseInt(page),
          pages: Math.ceil(totalInvoices / parseInt(limit)),
        },
      };

      res.json(result);
    } catch (error) {
      console.error("Customer Journey Error:", error);
      res.status(500).json({ message: error.message });
    }
  },

  /**
   * Get detailed information for a specific order
   */
  getOrderDetails: async (req, res) => {
    try {
      const { invoiceId } = req.params;

      // Get invoice details including line items
      const invoice = await Invoice.findOne({ DocEntry: invoiceId }).select({
        DocEntry: 1,
        DocNum: 1,
        DocDate: 1,
        DocDueDate: 1,
        CardCode: 1,
        CardName: 1,
        DocTotal: 1,
        VatSum: 1,
        Comments: 1,
        DocumentLines: 1,
        PaymentGroupCode: 1,
        Address: 1,
        U_Route: 1,
      });

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Get related payments for this invoice
      const payments = await Payment.find({
        "PaymentInvoices.DocEntry": parseInt(invoiceId),
      }).select({
        DocEntry: 1,
        DocNum: 1,
        DocDate: 1,
        DocType: 1,
        CardCode: 1,
        CardName: 1,
        TransferSum: 1,
        CashSum: 1,
        DocTotal: 1,
        PaymentInvoices: {
          $elemMatch: { DocEntry: parseInt(invoiceId) },
        },
      });

      res.json({
        invoice,
        payments,
      });
    } catch (error) {
      console.error("Order Details Error:", error);
      res.status(500).json({ message: error.message });
    }
  },
};

module.exports = customerController;
