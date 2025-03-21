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
  excelClient: {
    type: String,
    required: true,
  },
  sapCustomer: {
    type: String,
    required: true,
  },
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
  category: {
    type: String,
    required: true,
  },
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
  isResolved: {
    type: Boolean,
    default: false,
  },
  resolution: String,
});

const DiscrepancySchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
  },
  client: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  remarks: String,
  resolved: {
    type: Boolean,
    default: false,
  },
  resolution: {
    type: String,
    default: "",
  },
  resolvedTimestamp: Date,
  matchedInvoices: [
    {
      _id: mongoose.Schema.Types.ObjectId,
      sapCustomer: {
        type: String,
        required: true,
      },
      sapAmount: {
        type: Number,
        required: true,
      },
      docNum: String,
      docDate: Date,
    },
  ],
});

const POSDailyComparisonSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
  },
  sapTotal: {
    type: Number,
    required: true,
  },
  excelTotal: {
    type: Number,
    required: true,
  },
  difference: {
    type: Number,
    required: true,
  },
});

const POSDetailsSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
  client: String,
  amount: {
    type: Number,
    required: true,
  },
});

const POSDetailsSchemaPayments = new mongoose.Schema({
  CB: {
    type: Number,
  },
  Espèces: {
    type: Number,
  },
  Chèque: {
    type: Number,
  },
  Virements: {
    type: Number,
  },
});

const SAPInvoiceSchema = new mongoose.Schema({
  DocDate: {
    type: Date,
  },
  CardName: {
    type: String,
  },
  DocTotal: {
    type: Number,
  },
  CardCode: String,
  U_EPOSNo: String,
  DocNum: String,
  paymentMethod: String,
  CreationDate: Date,
  paymentDate: Date,
  _id: mongoose.Schema.Types.ObjectId,
  source: {
    type: String,
    default: "sap",
  },
});

// New schemas for bank reconciliation
const BankMatchSchema = new mongoose.Schema({
  bankStatement: {
    _id: mongoose.Schema.Types.ObjectId,
    operationDate: Date,
    operationRef: String,
    amount: Number,
    comment: String,
    detail1: String,
    detail2: String,
  },
  matchedTransaction: {
    _id: mongoose.Schema.Types.ObjectId,
    // Can be either Excel or SAP transaction
    excelClient: String,
    sapCustomer: String,
    excelAmount: Number,
    sapAmount: Number,
    docNum: String,
    category: String,
  },
  matchSource: {
    type: String,
    enum: ["excel", "sap"],
    required: true,
  },
  confidence: {
    type: String,
    enum: ["high", "medium", "low"],
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "confirmed", "rejected"],
    default: "pending",
  },
  amount: {
    type: Number,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: Date,
});

const BankDiscrepancySchema = new mongoose.Schema({
  bankStatement: {
    _id: mongoose.Schema.Types.ObjectId,
    operationDate: Date,
    operationRef: String,
    amount: Number,
    comment: String,
    detail1: String,
    detail2: String,
  },
  status: {
    type: String,
    enum: ["unresolved", "resolved"],
    default: "unresolved",
  },
  resolution: String,
  matchedTransactions: [
    {
      _id: mongoose.Schema.Types.ObjectId,
      source: {
        type: String,
        enum: ["excel", "sap"],
        required: true,
      },
      client: String,
      amount: Number,
      docNum: String,
      category: String,
    },
  ],
  amount: {
    type: Number,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  resolvedAt: Date,
  notes: String,
});

const BankReconciliationSchema = new mongoose.Schema({
  matches: {
    type: [BankMatchSchema],
    default: [],
  },
  discrepancies: {
    type: [BankDiscrepancySchema],
    default: [],
  },
  summary: {
    totalTransactions: {
      type: Number,
      required: true,
      default: 0,
    },
    matchedCount: {
      type: Number,
      required: true,
      default: 0,
    },
    unmatchedCount: {
      type: Number,
      required: true,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    matchedAmount: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
});

const SimplifiedBankReconciliationSchema = new mongoose.Schema(
  {
    excelTotal: {
      type: Number,
      required: true,
      default: 0,
    },
    reconciled: {
      type: Boolean,
    },
    matchedWith: {
      type: mongoose.Schema.Types.Mixed, // Changed from String to Mixed
      default: null,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const matchedTransactionSchema = new mongoose.Schema(
  {
    date: Date,
    client: String,
    amount: Number,
    type: String,
    category: String,
    remarks: String,
  },
  { _id: false }
);

const UnmatchedPaymentSchema = new mongoose.Schema({
  // Payment fields
  DocEntry: Number,
  DocNum: Number,
  DocDate: Date,

  CardCode: String,
  CardName: String,
  DocTotal: Number,
  CashSum: Number,
  TransferSum: Number,
  CheckSum: Number,
  CreditSum: Number,
  Remarks: String,
  paymentNumber: String,
  CreationDate: Date,


  // Resolution fields
  resolved: {
    type: Boolean,
    default: false,
  },
  resolution: String,
  resolvedTimestamp: Date,
  matchedTransactions: [matchedTransactionSchema],
});

const AnalysisSchema = new mongoose.Schema({
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
      sapPOSTotal: {
        type: Number,
        required: true,
      },
      excelPOSTotal: {
        type: Number,
        required: true,
      },
      difference: {
        type: Number,
        required: true,
      },
    },
    sapPOSDetails: [SAPInvoiceSchema],
    excelPOSDetails: [POSDetailsSchema],
    dailyComparisons: [POSDailyComparisonSchema],
    sapPOSByPaymentMethod: [POSDetailsSchemaPayments],
    payments: {
      type: Array,
      default: [],
    },
  },
  // Add bank reconciliation
  bankReconciliation: {
    type: SimplifiedBankReconciliationSchema,
  },

  cashReconciled: {
    type: Boolean,
    default: false,
  },
  chequeReconciled: {
    type: Boolean,
    default: false,
  },
  bankReconciled: {
    type: Boolean,
    default: false,
  },
  transferReconciled: {
    type: Boolean,
    default: false,
  },
  closed_off: {
    type: String,
  },
  pos_closed_off: {
    type: String,
  },
  bankTransferDifference: {
    type: Number,
  },
  bankChequeDifference: {
    type: Number,
  },
  bankCashDifference: {
    type: Number,
  },
  bankBankDifference: {
    type: Number,
  },
  cash_note: {
    type: String,
  },
  cheque_note: {
    type: String,
  },
  bank_note: {
    type: String,
  },
  transfer_note: {
    type: String,
  },
  bank_references: {
    type: Array,
  },
  cash_references: {
    type: Array,
  },
  cheque_references: {
    type: Array,
  },
  transfer_references: {
    type: Array,
  },
  unmatchedPayments: {
    type: [UnmatchedPaymentSchema],
    default: [],
  },
});

// Add validation for date fields
AnalysisSchema.pre("save", function (next) {
  if (!(this.dateRange.start instanceof Date && !isNaN(this.dateRange.start))) {
    next(new Error("Invalid start date"));
  }
  if (!(this.dateRange.end instanceof Date && !isNaN(this.dateRange.end))) {
    next(new Error("Invalid end date"));
  }
  next();
});

module.exports = mongoose.model("Analysis", AnalysisSchema);
