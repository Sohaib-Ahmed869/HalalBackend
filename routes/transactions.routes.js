const express = require("express");
const router = express.Router();
const Invoice = require("../models/invoice.model");
const Payment = require("../models/payment.model");

router.get("/", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    const dateMatch =
      startDate && endDate
        ? {
            DocDate: {
              $gte: new Date(startDate),
              $lte: new Date(endDate),
            },
          }
        : {};

    // Get invoices
    const invoicePromise = Invoice.aggregate([
      { $match: dateMatch },
      {
        $addFields: {
          documentType: "Invoice",
        },
      },
    ]);

    // Get payments mapped to invoice structure
    const paymentPromise = Payment.aggregate([
      { $match: dateMatch },
      {
        $addFields: {
          documentType: "Payment",
          DocTotal: { $sum: ["$CashSum", "$CheckSum", "$TransferSum"] },
          isPOS: { $cond: [{ $gt: ["$CashSum", 0] }, true, false] },
          tag: {
            $switch: {
              branches: [
                { case: { $gt: ["$CashSum", 0] }, then: "Cash" },
                { case: { $gt: ["$CheckSum", 0] }, then: "Check" },
                { case: { $gt: ["$TransferSum", 0] }, then: "Transfer" },
              ],
              default: "Unknown",
            },
          },
        },
      },
      {
        $project: {
          CashSum: 0,
          CheckSum: 0,
          TransferSum: 0,
          PaymentChecks: 0,
          PaymentCreditCards: 0,
          PaymentAccounts: 0,
        },
      },
    ]);

    // Execute both queries
    const [invoices, payments] = await Promise.all([
      invoicePromise,
      paymentPromise,
    ]);

    // Combine and sort results
    const combined = [...invoices, ...payments].sort(
      (a, b) => new Date(b.DocDate) - new Date(a.DocDate)
    );

    // Paginate results
    const paginatedResults = combined.slice(skip, skip + limit);
    const totalCount = combined.length;

    res.json({
      data: paginatedResults,
      metadata: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalRecords: totalCount,
        limit,
        hasNextPage: page * limit < totalCount,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching unified view:", error);
    res.status(500).json({ error: "Failed to fetch unified view" });
  }
});

module.exports = router;
