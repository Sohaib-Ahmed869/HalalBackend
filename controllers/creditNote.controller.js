const CreditNote = require("../models/creditnotes.model"); // Assuming the schema is defined and exported from this file
const { getModel } = require("../utils/modelFactory");

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
      const CreditNote = getModel(req.dbConnection, "CreditNotes");
      const creditNotes = await CreditNote.find({
        DocDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      }).skip(skip);

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

  static async getCreditNoteByDocNum(req, res) {
    try {
      const { docNum } = req.params;

      if (!docNum) {
        return res.status(400).json({ error: "Document number is required" });
      }
      const CreditNote = getModel(req.dbConnection, "CreditNote");

      const creditNote = await CreditNote.findOne({ DocNum: docNum }).lean(); // For better performance

      if (!creditNote) {
        return res.status(404).json({ error: "Credit note not found" });
      }

      res.status(200).json({
        success: true,
        data: creditNote,
      });
    } catch (error) {
      console.error("Error fetching credit note by DocNum:", error);
      res.status(500).json({
        error: "An error occurred while fetching the credit note.",
        details: error.message,
      });
    }
  }
}

module.exports = CreditNoteController;
