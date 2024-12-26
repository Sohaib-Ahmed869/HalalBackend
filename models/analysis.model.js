const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema({
  date: {
    type: Date,
    validate: {
      validator: function (v) {
        return !isNaN(new Date(v).getTime());
      },
      message: (props) => `${props.value} is not a valid date!`,
    },
  },
  excelClient: { type: String, required: true },
  sapCustomer: { type: String, required: true },
  excelAmount: {
    type: Number,
    required: true,
    default: 0,
  },
  sapAmount: {
    type: Number,
    required: true,
    default: 0,
  },
  category: { type: String, required: true },
  remarks: String,
  docNum: String,
  docDate: {
    type: Date,
    validate: {
      validator: function (v) {
        return !v || !isNaN(new Date(v).getTime());
      },
      message: (props) => `${props.value} is not a valid date!`,
    },
  },
  isResolved: { type: Boolean, default: false },
  resolution: String,
});

const DiscrepancySchema = new mongoose.Schema({
  date: { type: Date, required: true },
  client: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  remarks: String,
  resolved: { type: Boolean, default: false },
  resolution: { type: String, default: "" },
  resolvedTimestamp: Date,
  // Changed to array of matched invoices
  matchedInvoices: [
    {
      _id: mongoose.Schema.Types.ObjectId,
      sapCustomer: { type: String, required: true },
      sapAmount: { type: Number, required: true },
      docNum: String,
      docDate: Date,
    },
  ],
});

const POSDailyComparisonSchema = new mongoose.Schema({
  date: { type: String, required: true },
  sapTotal: { type: Number, required: true },
  excelTotal: { type: Number, required: true },
  difference: { type: Number, required: true },
});

const POSDetailsSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  type: { type: String, required: true },
  client: String,
  amount: { type: Number, required: true },
});

const SAPInvoiceSchema = new mongoose.Schema({
  DocDate: { type: Date, required: true },
  CardName: { type: String, required: true },
  DocTotal: { type: Number, required: true },
  CardCode: String,
  U_EPOSNo: String,
  DocNum: String,
  _id: mongoose.Schema.Types.ObjectId,
});

const AnalysisSchema = new mongoose.Schema({
  dateRange: {
    start: { type: Date, required: true },
    end: { type: Date, required: true },
  },
  performed: { type: Date, default: Date.now },
  matches: {
    type: Map,
    of: [TransactionSchema],
    default: new Map(),
    required: true,
  },
  excelDiscrepancies: {
    type: Map,
    of: [DiscrepancySchema],
    default: new Map(),
    required: true,
  },
  sapDiscrepancies: {
    type: [SAPInvoiceSchema],
    default: [],
  },
  extendedSapDiscrepancies: {
    type: [SAPInvoiceSchema],
    default: [],
  },
  posAnalysis: {
    summary: {
      sapPOSTotal: { type: Number, required: true },
      excelPOSTotal: { type: Number, required: true },
      difference: { type: Number, required: true },
    },
    sapPOSDetails: [SAPInvoiceSchema],
    excelPOSDetails: [POSDetailsSchema],
    dailyComparisons: [POSDailyComparisonSchema],
  },
});

// Add validation for date fields
AnalysisSchema.pre("save", function (next) {
  // Ensure dates are valid
  if (!(this.dateRange.start instanceof Date && !isNaN(this.dateRange.start))) {
    next(new Error("Invalid start date"));
  }
  if (!(this.dateRange.end instanceof Date && !isNaN(this.dateRange.end))) {
    next(new Error("Invalid end date"));
  }
  next();
});

module.exports = mongoose.model("Analysis", AnalysisSchema);
