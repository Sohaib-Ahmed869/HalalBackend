const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Document Line Schema
const DocumentLineSchema = new Schema({
  LineNum: Number,
  ItemCode: String,
  ItemDescription: String,
  Quantity: Number,
  ShipDate: Date,
  Price: Number,
  PriceAfterVAT: Number,
  Currency: String,
  DiscountPercent: Number,
  WarehouseCode: String,
  VatGroup: String,
  LineTotal: Number,
  TaxPercentagePerRow: Number,
  TaxTotal: Number,
  GrossTotal: Number,
  UoMCode: String,
  // Physical dimensions
  Height1: Number,
  Height1Unit: Number,
  Width1: Number,
  Width1Unit: Number,
  Lengh1: Number,
  Lengh1Unit: Number,
  Weight1: Number,
  Weight1Unit: Number,
  Volume: Number,
  VolumeUnit: Number
}, { _id: false });

// Tax Extension Schema
const TaxExtensionSchema = new Schema({
  StreetS: String,
  CityS: String,
  ZipCodeS: String,
  CountryS: String,
  StreetB: String,
  CityB: String,
  ZipCodeB: String,
  CountryB: String,
  ImportOrExportType: String
}, { _id: false });

// Address Extension Schema
const AddressExtensionSchema = new Schema({
  ShipToStreet: String,
  ShipToCity: String,
  ShipToZipCode: String,
  ShipToCountry: String,
  BillToStreet: String,
  BillToCity: String,
  BillToZipCode: String,
  BillToCountry: String
}, { _id: false });

// Main Returns Schema
const ReturnSchema = new Schema({
  DocEntry: {
    type: Number,
    required: true,
    unique: true
  },
  DocNum: {
    type: Number,
    required: true
  },
  DocType: {
    type: String,
    enum: ['dDocument_Items'],
    default: 'dDocument_Items'
  },
  HandWritten: {
    type: String,
    enum: ['tNO', 'tYES'],
    default: 'tNO'
  },
  Printed: {
    type: String,
    enum: ['psYes', 'psNo'],
    default: 'psNo'
  },
  DocDate: {
    type: Date,
    required: true
  },
  DocDueDate: {
    type: Date,
    required: true
  },
  CardCode: {
    type: String,
    required: true,
    index: true
  },
  CardName: {
    type: String,
    required: true
  },
  Address: String,
  DocTotal: {
    type: Number,
    required: true
  },
  DocCurrency: {
    type: String,
    required: true
  },
  DocRate: {
    type: Number,
    default: 1.0
  },
  Reference1: String,
  Reference2: String,
  Comments: String,
  JournalMemo: String,
  DocumentStatus: {
    type: String,
    enum: ['bost_Open', 'bost_Close'],
    default: 'bost_Open'
  },
  VatSum: Number,
  DocumentLines: [DocumentLineSchema],
  TaxExtension: TaxExtensionSchema,
  AddressExtension: AddressExtensionSchema
}, {
  timestamps: true,
  collection: 'returns'
});

// Indexes
ReturnSchema.index({ DocDate: 1 });
ReturnSchema.index({ CardCode: 1, DocDate: -1 });

// Virtual for total with VAT
ReturnSchema.virtual('totalWithVAT').get(function() {
  return this.DocTotal + (this.VatSum || 0);
});

// Calculate total volume
ReturnSchema.methods.calculateTotalVolume = function() {
  return this.DocumentLines.reduce((total, line) => {
    return total + (line.Volume * line.Quantity);
  }, 0);
};

// Calculate total weight
ReturnSchema.methods.calculateTotalWeight = function() {
  return this.DocumentLines.reduce((total, line) => {
    return total + (line.Weight1 * line.Quantity);
  }, 0);
};

// Format shipping address
ReturnSchema.methods.getFormattedShippingAddress = function() {
  const addr = this.AddressExtension;
  return `${addr.ShipToStreet}
${addr.ShipToCity}
${addr.ShipToZipCode}
${addr.ShipToCountry}`;
};

// Static method to find returns by customer
ReturnSchema.statics.findByCustomer = function(cardCode) {
  return this.find({ CardCode: cardCode }).sort({ DocDate: -1 });
};

// Static method to find returns by date range
ReturnSchema.statics.findByDateRange = function(startDate, endDate) {
  return this.find({
    DocDate: {
      $gte: startDate,
      $lte: endDate
    }
  }).sort({ DocDate: -1 });
};

const Return = mongoose.model('Return', ReturnSchema);

module.exports = Return;