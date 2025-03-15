const mongoose = require("mongoose");

const bankStatementSchema = new mongoose.Schema({
  operationDate: Date,
  operationRef: String,
  operationType: String,
  amount: Number,
  comment: String,
  detail1: String,
  detail2: String,
  detail3: String,
  detail4: String,
  detail5: String,
  uploadDate: {
    type: Date,
    default: Date.now,
  },
  bank: {
    type: String,
    required: true,
  },
  tag: {
    type: String,
    default: null,
  },
  taggedBy: {
    type: String,
    default: null,
  },
  taggedAt: {
    type: Date,
    default: null,
  },
  tagNotes: {
    type: String,
    default: null,
  },
});
// Create text index for searching
bankStatementSchema.index({
  comment: "text",
  detail1: "text",
  detail2: "text",
  operationRef: "text",
});

// Create a compound index for common queries
bankStatementSchema.index({ bank: 1, operationDate: -1 });
bankStatementSchema.index({ tag: 1, operationDate: -1 });

// Method to get transaction summary
bankStatementSchema.statics.getSummary = async function (query = {}) {
  return this.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        totalTransactions: { $sum: 1 },
        totalAmount: { $sum: "$amount" },
        totalIncoming: {
          $sum: { $cond: [{ $gt: ["$amount", 0] }, "$amount", 0] },
        },
        totalOutgoing: {
          $sum: { $cond: [{ $lt: ["$amount", 0] }, { $abs: "$amount" }, 0] },
        },
        averageAmount: { $avg: "$amount" },
        minAmount: { $min: "$amount" },
        maxAmount: { $max: "$amount" },
        firstTransaction: { $min: "$operationDate" },
        lastTransaction: { $max: "$operationDate" },
      },
    },
  ]);
};

// Method to find duplicates based on date, amount, and reference
bankStatementSchema.statics.findDuplicates = async function () {
  return this.aggregate([
    {
      $group: {
        _id: {
          date: {
            $dateToString: { format: "%Y-%m-%d", date: "$operationDate" },
          },
          amount: "$amount",
          ref: "$operationRef",
        },
        count: { $sum: 1 },
        transactions: { $push: "$$ROOT" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { "_id.date": -1 } },
  ]);
};
module.exports = mongoose.model("BankStatement", bankStatementSchema);
