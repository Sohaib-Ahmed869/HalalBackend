// models/Order.js
const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  docEntry: {
    type: Number,
    required: true,
    unique: true,
  },
  verified: {
    type: Boolean,
    default: false,
  },
  dateStored: {
    type: Date,
    default: Date.now,
  },
  tag: {
    type: String,
    enum: ["Own Company", "Cash and Carry", "Delivery", "None"],
    default: null,
  },
});
module.exports = mongoose.model("Order", orderSchema);
