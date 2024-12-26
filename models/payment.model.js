const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // Core fields
  DocEntry: { type: Number, required: true, unique: true },
  DocNum: { type: Number, required: true },
  DocType: String,
  HandWritten: String,
  Printed: String,
  DocDate: Date,
  CardCode: String,
  CardName: String,
  Address: String,

  // Payment details
  CashAccount: String,
  DocCurrency: String,
  CashSum: Number,
  CheckAccount: String,
  TransferAccount: String,
  TransferSum: Number,
  TransferDate: Date,
  TransferReference: String,

  // Additional payment info
  LocalCurrency: String,
  DocRate: Number,
  Reference1: String,
  Reference2: String,
  CounterReference: String,
  Remarks: String,
  JournalRemarks: String,
  
  // Financial details
  DiscountPercent: Number,
  CashSumFC: Number,
  CashSumSys: Number,
  BankChargeAmount: Number,
  BankChargeAmountInFC: Number,
  BankChargeAmountInSC: Number,
  
  // Bank details
  PayToBankCode: String,
  PayToBankBranch: String,
  PayToBankAccountNo: String,
  PayToCode: String,
  PayToBankCountry: String,
  IsPayToBank: String,
  
  // Status fields
  Cancelled: String,
  AuthorizationStatus: String,
  PaymentPriority: String,
  
  // Tax and VAT
  ApplyVAT: String,
  TaxDate: Date,
  VatDate: Date,
  WTAmount: Number,
  WTAmountFC: Number,
  WTAmountSC: Number,
  WTAccount: String,
  WTTaxableAmount: Number,

  // Document info
  Series: Number,
  DueDate: Date,
  ControlAccount: String,
  DocObjectCode: String,
  
  // Custom fields
  U_BP_Confd: String,
  U_BP_DocNr: String,
  U_BP_Seque: String,

  // Tracking fields
  dateStored: { type: Date, default: Date.now },
  verified: { type: Boolean, default: false },

  // Related documents
  PaymentInvoices: [{
    LineNum: Number,
    DocEntry: Number,
    SumApplied: Number,
    AppliedFC: Number,
    AppliedSys: Number,
    DocRate: Number,
    DocLine: Number,
    InvoiceType: String,
    DiscountPercent: Number,
    PaidSum: Number,
    InstallmentId: Number,
    WitholdingTaxApplied: Number,
    WitholdingTaxAppliedFC: Number,
    WitholdingTaxAppliedSC: Number,
    LinkDate: Date,
    TotalDiscount: Number,
    TotalDiscountFC: Number,
    TotalDiscountSC: Number
  }],

  PaymentChecks: [{ type: mongoose.Schema.Types.Mixed }],
  PaymentCreditCards: [{ type: mongoose.Schema.Types.Mixed }],
  PaymentAccounts: [{ type: mongoose.Schema.Types.Mixed }]
}, {
  timestamps: true,
  strict: false
});

// Indexes
paymentSchema.index({ DocEntry: 1 });
paymentSchema.index({ DocDate: 1 });
paymentSchema.index({ CardCode: 1 });
paymentSchema.index({ verified: 1 });

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;