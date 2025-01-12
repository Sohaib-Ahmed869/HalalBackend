const Return = require("../models/returns.model");

class ReturnsController {
  static async getReturnsByDate(req, res) {
    try {
      const { startDate, endDate, page = 1, limit = 10 } = req.query;

      // Ensure startDate is provided
      if (!startDate) {
        return res.status(400).json({ error: "Start date is required" });
      }

      // Pagination calculations
      const skip = (page - 1) * limit;

      // Query to fetch returns by date range
      const returns = await Return.find({
        DocDate: {
          $gte: new Date(startDate),
          $lte: endDate ? new Date(endDate) : new Date(startDate),
        },
      })
        .skip(skip)
        .limit(Number(limit));

      // Total count for pagination
      const totalReturns = await Return.countDocuments({
        DocDate: {
          $gte: new Date(startDate),
          $lte: endDate ? new Date(endDate) : new Date(startDate),
        },
      });

      // Respond with paginated results
      res.status(200).json({
        returns,
        pagination: {
          currentPage: Number(page),
          totalPages: Math.ceil(totalReturns / limit),
          totalItems: totalReturns,
        },
      });
    } catch (error) {
      console.error("Error fetching returns:", error);
      res.status(500).json({
        error: "An error occurred while fetching returns.",
        details: error.message,
      });
    }
  }

  static async getReturnsByCustomer(req, res) {
    try {
      const { cardCode } = req.params;
      const { page = 1, limit = 10 } = req.query;

      // Ensure cardCode is provided
      if (!cardCode) {
        return res.status(400).json({ error: "Customer code is required" });
      }

      // Pagination calculations
      const skip = (page - 1) * limit;

      // Query to fetch returns by customer
      const returns = await Return.find({ CardCode: cardCode })
        .sort({ DocDate: -1 })
        .skip(skip)
        .limit(Number(limit));

      // Total count for pagination
      const totalReturns = await Return.countDocuments({ CardCode: cardCode });

      // Respond with paginated results
      res.status(200).json({
        returns,
        pagination: {
          currentPage: Number(page),
          totalPages: Math.ceil(totalReturns / limit),
          totalItems: totalReturns,
        },
      });
    } catch (error) {
      console.error("Error fetching returns by customer:", error);
      res.status(500).json({
        error: "An error occurred while fetching returns by customer.",
        details: error.message,
      });
    }
  }

  static async getReturnByDocEntry(req, res) {
    try {
      const { docEntry } = req.params;

      // Ensure docEntry is provided
      if (!docEntry) {
        return res.status(400).json({ error: "Document entry is required" });
      }

      // Query to fetch specific return by DocEntry
      const returnDoc = await Return.findOne({ DocEntry: docEntry });

      // Check if return exists
      if (!returnDoc) {
        return res.status(404).json({ error: "Return document not found" });
      }

      // Respond with the return document
      res.status(200).json(returnDoc);
    } catch (error) {
      console.error("Error fetching return document:", error);
      res.status(500).json({
        error: "An error occurred while fetching the return document.",
        details: error.message,
      });
    }
  }

  static async getReturnByDocNum(req, res) {
    try {
      const { docNum } = req.params;

      if (!docNum) {
        return res.status(400).json({ error: "Document number is required" });
      }

      const returnDoc = await Return.findOne({ DocNum: docNum }).lean(); // For better performance

      if (!returnDoc) {
        return res.status(404).json({ error: "Return document not found" });
      }

      res.status(200).json({
        success: true,
        data: returnDoc,
      });
    } catch (error) {
      console.error("Error fetching return by DocNum:", error);
      res.status(500).json({
        error: "An error occurred while fetching the return document.",
        details: error.message,
      });
    }
  }
}

module.exports = ReturnsController;
