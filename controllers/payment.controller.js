const axios = require("axios");
const Payment = require("../models/payment.model");

class PaymentController {
  static async getPayments(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100;
      const sortField = req.query.sortField || "DocDate";
      const sortOrder = parseInt(req.query.sortOrder) || -1;
      const { startDate, endDate } = req.query;

      const skip = (page - 1) * limit;
      const sort = { [sortField]: sortOrder };
      let query = {};

      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        query.DocDate = {
          $gte: start,
          $lte: end,
        };
      }

      const totalCount = await Payment.countDocuments(query);
      const payments = await Payment.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean();

      res.json({
        data: payments,
        metadata: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalRecords: totalCount,
          limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  }

  static async syncPayments(req, res) {
    try {
      const headers = {
        Cookie: req.headers.cookie,
      };

      let created = 0;
      let skipped = 0;
      let errors = [];
      let totalProcessed = 0;

      const startDate = "2023-01-01";
      const endDate = new Date().toISOString().split("T")[0]; // Current date

      let nextLink = `${process.env.BASE_URL}/IncomingPayments?$filter=DocDate ge '${startDate}' and DocDate le '${endDate}'&$orderby=DocDate&$skip=1`;

      while (nextLink) {
        try {
          console.log(`Fetching data from: ${nextLink}`);
          const response = await axios.get(nextLink, { headers });
          const currentBatch = response.data.value;
          console.log(`Processing batch of ${currentBatch.length} payments`);

          for (const payment of currentBatch) {
            try {
              const existingPayment = await Payment.findOne({
                DocEntry: payment.DocEntry,
              });

              if (!existingPayment) {
                const paymentWithTracking = {
                  ...payment,
                  dateStored: new Date(),
                  verified: false,
                };

                await Payment.create(paymentWithTracking);
                created++;
              } else {
                skipped++;
              }
              totalProcessed++;

              if (totalProcessed % 100 === 0) {
                console.log(
                  `Progress: Processed ${totalProcessed} payments. Created: ${created}, Skipped: ${skipped}, Errors: ${errors.length}`
                );
              }
            } catch (error) {
              errors.push({ DocEntry: payment.DocEntry, error: error.message });
              console.error(
                `Error processing payment ${payment.DocEntry}:`,
                error
              );
            }
          }

          nextLink = response.data["odata.nextLink"];
          console.log("Next link:", nextLink);

          if (nextLink && nextLink.startsWith("IncomingPayments")) {
            nextLink = `${process.env.BASE_URL}/${nextLink}`;
          }

          response.data = null;
        } catch (error) {
          console.error("Error in batch processing:", error);
          errors.push({ batch: nextLink, error: error.message });
          break;
        }
      }

      res.json({
        message: "Sync completed for all payments from 2023 onwards",
        stats: {
          period: `${startDate} to ${endDate}`,
          totalProcessed,
          created,
          skipped,
          errors: errors.length,
        },
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Error syncing payments:", error);
      res.status(500).json({ error: "Failed to sync payments" });
    }
  }

  static async getPaymentStats(req, res) {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          error: "Both startDate and endDate are required",
        });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const stats = await Payment.aggregate([
        {
          $match: {
            DocDate: {
              $gte: start,
              $lte: end,
            },
          },
        },
        {
          $facet: {
            paymentMethods: [
              {
                $group: {
                  _id: {
                    hasCash: { $gt: ["$CashSum", 0] },
                    hasCheck: { $gt: ["$CheckSum", 0] },
                    hasTransfer: { $gt: ["$TransferSum", 0] },
                  },
                  count: { $sum: 1 },
                  total: { $sum: "$DocTotal" },
                },
              },
            ],
            dailyTotals: [
              {
                $group: {
                  _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$DocDate" },
                  },
                  total: { $sum: "$DocTotal" },
                  count: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
            customerStats: [
              {
                $group: {
                  _id: "$CardCode",
                  customerName: { $first: "$CardName" },
                  total: { $sum: "$DocTotal" },
                  count: { $sum: 1 },
                },
              },
              { $sort: { total: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ]);

      res.json({
        period: { startDate: start, endDate: end },
        stats: stats[0],
      });
    } catch (error) {
      console.error("Error fetching payment stats:", error);
      res.status(500).json({ error: "Failed to fetch payment statistics" });
    }
  }

  static async toggleVerified(req, res) {
    try {
      const { DocEntry } = req.params;

      const payment = await Payment.findOne({ DocEntry });

      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      payment.verified = !payment.verified;
      await payment.save();

      res.json(payment);
    } catch (error) {
      console.error("Error toggling payment verification:", error);
      res.status(500).json({ error: "Failed to toggle payment verification" });
    }
  }
}

module.exports = PaymentController;
