const CreditNote = require("../models/creditnotes.model"); // Assuming the schema is defined and exported from this file

class CreditNoteController {
  static async getCreditNotesByDate(req, res) {
    try {
      const { startDate, endDate, page = 1, limit = 10 } = req.query;

      // Ensure date is provided
      if (!startDate) {
        return res.status(400).json({ error: "Date is required" });
      }

      // Pagination calculations
      const skip = (page - 1) * limit;

      // Query to fetch credit notes by date
      const creditNotes = await CreditNote.find({
        DocDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      })
        .skip(skip)
        .limit(Number(limit));

      // Total count for pagination
      const totalCreditNotes = await CreditNote.countDocuments({
        DocDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      });

      // Respond with paginated results
      res.status(200).json({
        creditNotes,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCreditNotes / limit),
          totalItems: totalCreditNotes,
        },
      });
    } catch (error) {
      console.error("Error fetching credit notes:", error);
      res
        .status(500)
        .json({ error: "An error occurred while fetching credit notes." });
    }
  }
}

module.exports = CreditNoteController;
