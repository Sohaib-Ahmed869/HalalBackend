const mongoose = require("mongoose");

// Schema for matched transaction references
const MatchedTransactionSchema = new mongoose.Schema({
  excelId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "Sale",
  },
  excelType: {
    type: String,
    required: true,
    enum: ["Sale"],
  },
  sapId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "Invoice",
  },
  category: {
    type: String,
    required: true,
  },
  matchType: {
    type: String,
    enum: ["automatic", "manual"],
    required: true,
  },
  matchDate: {
    type: Date,
    default: Date.now,
  },
  
});

// Schema for unmatched discrepancies
const DiscrepancySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["excel", "sap"],
    required: true,
  },
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: "documentType",
  },
  documentType: {
    type: String,
    required: true,
    enum: ["Sale", "Invoice"],
  },
  resolved: {
    type: Boolean,
    default: false,
  },
  resolution: String,
  resolvedDate: Date,
  matchedWith: [
    {
      documentId: mongoose.Schema.Types.ObjectId,
      documentType: {
        type: String,
        enum: ["Sale", "Invoice"],
      },
    },
  ],
});

// Schema for POS summary
const POSSummarySchema = new mongoose.Schema({
  date: { type: Date, required: true },
  sapTotal: { type: Number, required: true },
  excelTotal: { type: Number, required: true },
  sapTransactions: [
    {
      DocDate: { type: Date },
      CardName: { type: String },
      DocTotal: { type: Number },
      DocNum: { type: String },
    },
  ],
  excelTransactions: [
    {
      type: { type: String },
      client: { type: String },
      amount: { type: Number },
    },
  ],
});

// Main Analysis Schema
const AnalysisSchema = new mongoose.Schema(
  {
    dateRange: {
      start: {
        type: Date,
        required: true,
      },
      end: {
        type: Date,
        required: true,
      },
    },
    performed: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "error"],
      default: "pending",
    },
    matchedTransactions: [MatchedTransactionSchema],
    discrepancies: [DiscrepancySchema],
    posAnalysis: [POSSummarySchema],

    // Metadata
    processingTime: Number,
    errorMessage: String,
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
AnalysisSchema.index({ "dateRange.start": 1, "dateRange.end": 1 });
AnalysisSchema.index({ status: 1 });
AnalysisSchema.index({ performed: -1 });

// Helper methods
AnalysisSchema.methods.getMatchedTransactions = async function () {
  const populatedAnalysis = await this.populate([
    {
      path: "matchedTransactions.excelId",
      model: "Sale",
    },
    {
      path: "matchedTransactions.sapId",
      model: "Invoice",
    },
  ]);

  return populatedAnalysis.matchedTransactions;
};

AnalysisSchema.methods.getDiscrepancies = async function () {
  const populatedAnalysis = await this.populate([
    {
      path: "discrepancies.documentId",
      refPath: "discrepancies.documentType",
    },
    {
      path: "discrepancies.matchedWith.documentId",
      refPath: "discrepancies.matchedWith.documentType",
    },
  ]);

  return populatedAnalysis.discrepancies;
};

AnalysisSchema.methods.getPOSAnalysis = async function () {
  const populatedAnalysis = await this.populate([
    {
      path: "posAnalysis.sapTransactions",
      model: "Invoice",
    },
    {
      path: "posAnalysis.excelTransactions",
      model: "Sale",
    },
  ]);

  return populatedAnalysis.posAnalysis;
};

module.exports = mongoose.model("Analysis", AnalysisSchema);
