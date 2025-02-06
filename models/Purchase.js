const mongoose = require("mongoose");
const mongoosePaginate = require('mongoose-paginate-v2');
const { Schema } = mongoose;

// Document Line Schema
const PurchaseInvoiceLineSchema = new Schema({
  LineNum: Number,
  ItemCode: String,
  ItemDescription: String,
  Quantity: Number,
  ShipDate: Date,
  Price: Number,
  PriceAfterVAT: Number,
  Currency: String,
  Rate: Number,
  DiscountPercent: Number,
  WarehouseCode: String,
  AccountCode: String,
  VatGroup: String,
  LineTotal: Number,
  TaxPercentagePerRow: Number,
  TaxTotal: Number,
  UnitPrice: Number,
  LineStatus: String,
  PackageQuantity: Number,
  ItemType: String,
});

// Document Installment Schema
const PurchaseInvoiceInstallmentSchema = new Schema({
  DueDate: Date,
  Percentage: Number,
  Total: Number,
  InstallmentId: Number,
  PaymentOrdered: String,
});

// Tax Extension Schema
const TaxExtensionSchema = new Schema({
  StreetS: String,
  BlockS: String,
  CityS: String,
  ZipCodeS: String,
  CountryS: String,
  StreetB: String,
  CityB: String,
  ZipCodeB: String,
  CountryB: String,
  ImportOrExportType: String,
});

// Address Extension Schema
const AddressExtensionSchema = new Schema({
  ShipToStreet: String,
  ShipToBlock: String,
  ShipToCity: String,
  ShipToZipCode: String,
  ShipToCountry: String,
  BillToStreet: String,
  BillToCity: String,
  BillToZipCode: String,
  BillToCountry: String,
});

// Main Purchase Invoice Schema
const PurchaseInvoiceSchema = new Schema(
  {
    DocEntry: Number,
    DocNum: Number,
    DocType: String,
    DocDate: Date,
    DocDueDate: Date,
    CardCode: String,
    CardName: String,
    Address: String,
    DocTotal: Number,
    DocCurrency: String,
    Comments: String,
    JournalMemo: String,
    DocTime: String,
    Series: Number,
    TaxDate: Date,
    CreationDate: Date,
    UpdateDate: Date,
    FinancialPeriod: Number,
    TransNum: Number,
    VatSum: Number,
    DocTotalFc: Number,
    DocTotalSys: Number,
    PaidToDate: Number,
    PaidToDateFC: Number,
    PaidToDateSys: Number,
    tags: [{ type: String }],
    // Nested documents
    DocumentLines: [PurchaseInvoiceLineSchema],
    DocumentInstallments: [PurchaseInvoiceInstallmentSchema],
    TaxExtension: TaxExtensionSchema,
    AddressExtension: AddressExtensionSchema,

    // Additional fields
    LanguageCode: Number,
    TotalDiscount: Number,
    ControlAccount: String,

    // Metadata
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "purchaseInvoices",
  }
);
// Add pagination plugin
PurchaseInvoiceSchema.plugin(mongoosePaginate);
// Indexes
PurchaseInvoiceSchema.index({ DocEntry: 1 }, { unique: true });
PurchaseInvoiceSchema.index({ CardCode: 1 });
PurchaseInvoiceSchema.index({ DocDate: 1 });
PurchaseInvoiceSchema.index({ CreationDate: 1 });

// Create the model
const PurchaseInvoice = mongoose.model(
  "PurchaseInvoice",
  PurchaseInvoiceSchema
);

module.exports = PurchaseInvoice;
