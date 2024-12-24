const mongoose = require("mongoose");

const salesSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    unique: true,
  },
  "Paiements Chèques": [
    {
      client: String,
      amount: Number,
      bank: String,
      number: String,
      remarks: String,
      verified: Boolean,
    },
  ],
  "Paiements Espèces": [
    {
      client: String,
      amount: Number,
      bank: String,
      number: String,
      remarks: String,
      verified: {
        type: Boolean,
        default: false,
      },
    },
  ],
  "Paiements CB Site": [
    {
      client: String,
      amount: Number,
      bank: String,
      verified: {
        type: Boolean,
        default: false,
      },
    },
  ],
  "Paiements CB Téléphone": [
    {
      client: String,
      amount: Number,
      bank: String,
      verified: {
        type: Boolean,
        default: false,
      },
    },
  ],
  Virements: [
    {
      client: String,
      amount: Number,
      bank: String,
      number: String,
      remarks: String,
      verified: {
        type: Boolean,
        default: false,
      },
    },
  ],
  "Livraisons non payées": [
    {
      client: String,
      amount: Number,
      bank: String,
      number: String,
      remarks: String,
      verified: {
        type: Boolean,
        default: false,
      },
    },
  ],
  POS: {
    "Caisse Espèces": [
      {
        client: String,
        amount: Number,
        verified: {
          type: Boolean,
          default: false,
        },
      },
    ],
    "Caisse chèques": [
      {
        client: String,
        amount: Number,
        verified: {
          type: Boolean,
          default: false,
        },
      },
    ],
    "Caisse CB": [
      {
        client: String,
        amount: Number,
        verified: {
          type: Boolean,
          default: false,
        },
      },
    ],
  },
});

module.exports = mongoose.model("Sale", salesSchema);
