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

module.exports = mongoose.model("BankStatement", bankStatementSchema);
