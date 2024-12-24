// models/analysis.model.js
const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema({
  date: Date,
  excelClient: String,
  sapCustomer: String,
  excelAmount: Number,
  sapAmount: Number,
  category: String,
  remarks: String,
  similarity: Number,
});

const DiscrepancySchema = new mongoose.Schema({
  date: Date,
  client: String,
  amount: Number,
  category: String,
  remarks: String,
  resolved: { type: Boolean, default: false },
  resolution: { type: String, default: "" },
  resolvedTimestamp: Date,
  // When resolved, these fields will be populated
  matchedWith: {
    sapCustomer: String,
    sapAmount: Number,
    similarity: Number,
  },
});

const POSDailyComparisonSchema = new mongoose.Schema({
  date: String,
  sapTotal: Number,
  excelTotal: Number,
  difference: Number,
});

const POSDetailsSchema = new mongoose.Schema({
  date: Date,
  type: String,
  client: String,
  amount: Number,
});

const AnalysisSchema = new mongoose.Schema({
  dateRange: {
    start: Date,
    end: Date,
  },
  performed: { type: Date, default: Date.now },
  matches: {
    type: Map,
    of: [TransactionSchema],
    default: new Map(),
  },
  excelDiscrepancies: {
    type: Map,
    of: [DiscrepancySchema],
    default: new Map(),
  },
  sapDiscrepancies: [
    {
      DocDate: Date,
      CardName: String,
      DocTotal: Number,
      CardCode: String,
      U_EPOSNo: String,
    },
  ],
  posAnalysis: {
    summary: {
      sapPOSTotal: Number,
      excelPOSTotal: Number,
      difference: Number,
    },
    sapPOSDetails: [
      {
        DocDate: Date,
        CardName: String,
        DocTotal: Number,
        CardCode: String,
        U_EPOSNo: String,
      },
    ],
    excelPOSDetails: [POSDetailsSchema],
    dailyComparisons: [POSDailyComparisonSchema],
  },
});

module.exports = mongoose.model("Analysis", AnalysisSchema);
