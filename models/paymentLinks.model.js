const mongoose = require("mongoose");

const paymentLinkSchema = new mongoose.Schema({
  paymentNumber: {
    type: Number,
    required: true,
  },
  invoiceNumber: {
    type: Number,
    required: true,
  },
  paymentAmount: {
    type: Number,
    required: true,
  },
  invoiceAmount: {
    type: Number,
    required: true,
  },
  paymentDate: {
    type: Date,
    required: true,
  },
  invoiceDate: {
    type: Date,
    required: true,
  },
});

const PaymentLink = mongoose.model("PaymentLink", paymentLinkSchema);

module.exports = PaymentLink;
