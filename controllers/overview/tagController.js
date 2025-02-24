// controllers/tagsController.js
const Tag = require("../../models/tags.model");
const PurchaseInvoice = require("../../models/Purchase");

const tagsController = {
  /**
   * Get all tags
   */
  getAllTags: async (req, res) => {
    try {
      const tags = await Tag.find().sort({ name: 1 });
      res.json(tags);
    } catch (error) {
      console.error("Get Tags Error:", error);
      res.status(500).json({ message: error.message });
    }
  },

  /**
   * Get purchases by tag with analysis
   */
  getPurchasesByTag: async (req, res) => {
    try {
      const { tagName } = req.params;
      const { startDate, endDate, page = 1, limit = 10 } = req.query;

      // Validate date range
      if (!startDate || !endDate) {
        return res
          .status(400)
          .json({ message: "Start and end dates are required" });
      }

      // Create filter for tag purchases
      const filter = {
        tags: tagName,
        DocDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };

      // Get purchases with pagination
      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        sort: { DocDate: -1 },
        select: "DocEntry DocNum DocDate CardName DocTotal VatSum tags",
      };

      const purchases = await PurchaseInvoice.paginate(filter, options);

      // Get summary metrics for this tag
      const tagSummary = await PurchaseInvoice.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$DocTotal" },
            totalVat: { $sum: "$VatSum" },
            totalWithVat: {
              $sum: { $add: ["$DocTotal", { $ifNull: ["$VatSum", 0] }] },
            },
            count: { $sum: 1 },
            suppliers: { $addToSet: "$CardCode" },
          },
        },
        {
          $project: {
            _id: 0,
            totalAmount: { $round: ["$totalAmount", 2] },
            totalVat: { $round: ["$totalVat", 2] },
            totalWithVat: { $round: ["$totalWithVat", 2] },
            count: 1,
            uniqueSuppliers: { $size: "$suppliers" },
            averageAmount: {
              $round: [{ $divide: ["$totalAmount", "$count"] }, 2],
            },
          },
        },
      ]);

      // Get monthly trends for this tag
      const monthlyTrends = await PurchaseInvoice.aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              year: { $year: "$DocDate" },
              month: { $month: "$DocDate" },
            },
            totalAmount: { $sum: "$DocTotal" },
            count: { $sum: 1 },
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
            totalAmount: { $round: ["$totalAmount", 2] },
            count: 1,
          },
        },
        { $sort: { year: 1, month: 1 } },
      ]);

      // Return combined results
      res.json({
        summary: tagSummary.length > 0 ? tagSummary[0] : {},
        monthlyTrends,
        purchases,
      });
    } catch (error) {
      console.error("Tag Purchases Error:", error);
      res.status(500).json({ message: error.message });
    }
  },
};

module.exports = tagsController;
