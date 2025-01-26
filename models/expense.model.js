const mongoose = require("mongoose");

const ExpenseSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  tag: {
    type: String,
    default: null
  },
  analysisId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Analysis',
    required: true
  },
  createdAt: {
    type: Date,
  }
});

module.exports = mongoose.model("Expense", ExpenseSchema);