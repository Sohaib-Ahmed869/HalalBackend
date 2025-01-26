const Expense = require("../models/expense.model");
const Analysis = require("../models/analysis.model");

class ExpenseController {
  static async createExpense(req, res) {
    try {
      const { name, amount, tag, analysisId } = req.body;

      // Validate if analysis exists
      const analysis = await Analysis.findById(analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      //get the analysis start date
      const startDate = analysis.dateRange.start;

      // Create new expense
      const expense = new Expense({
        name,
        amount,
        tag,
        analysisId,
        createdAt: new Date(startDate), // Set expense date to analysis start date
      });

      await expense.save();

      res.status(201).json({
        success: true,
        expense,
      });
    } catch (error) {
      console.error("Error creating expense:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async getExpensesByAnalysis(req, res) {
    try {
      const { analysisId } = req.params;

      // Validate if analysis exists
      const analysis = await Analysis.findById(analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // Get all expenses for this analysis
      const expenses = await Expense.find({ analysisId }).sort({
        createdAt: -1,
      });

      res.json({
        success: true,
        expenses,
      });
    } catch (error) {
      console.error("Error fetching expenses:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async updateExpense(req, res) {
    try {
      const { id } = req.params;
      const { name, amount, tag } = req.body;

      const expense = await Expense.findById(id);
      if (!expense) {
        return res.status(404).json({ error: "Expense not found" });
      }

      // Update fields if provided
      if (name) expense.name = name;
      if (amount !== undefined) expense.amount = amount;
      if (tag !== undefined) expense.tag = tag;

      await expense.save();

      res.json({
        success: true,
        expense,
      });
    } catch (error) {
      console.error("Error updating expense:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async deleteExpense(req, res) {
    try {
      const { id } = req.params;

      const expense = await Expense.findByIdAndDelete(id);
      if (!expense) {
        return res.status(404).json({ error: "Expense not found" });
      }

      res.json({
        success: true,
        message: "Expense deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting expense:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async getAllExpenses(req, res) {
    try {
      // Optional query parameters for filtering
      const { tag, startDate, endDate } = req.query;

      let query = {};

      // Add tag filter if provided
      if (tag) {
        query.tag = tag;
      }

      // Add date range filter if provided
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
          query.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          query.createdAt.$lte = new Date(endDate);
        }
      }

      const expenses = await Expense.find(query)
        .sort({ createdAt: -1 })
        .populate("analysisId", "dateRange"); // Populate analysis date range if needed

      res.json({
        success: true,
        expenses,
      });
    } catch (error) {
      console.error("Error fetching all expenses:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async getExpenseTags(req, res) {
    try {
      // Get unique tags
      const tags = await Expense.distinct("tag");

      res.json({
        success: true,
        tags: tags.filter((tag) => tag !== null), // Filter out null tags if needed
      });
    } catch (error) {
      console.error("Error fetching expense tags:", error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = ExpenseController;
