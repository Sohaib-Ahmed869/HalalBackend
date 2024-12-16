// models/sales.model.js
const mongoose = require("mongoose");

const saleSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  ventePlace: {
    esp: {
      type: Number,
      default: 0
    },
    chq: {
      type: Number,
      default: 0
    },
    cb: {
      type: Number,
      default: 0
    },
    depense: {
      type: Number,
      default: 0
    }
  },
  venteLivraison: {
    virement: {
      type: Number,
      default: 0
    }
  }
});

module.exports = mongoose.model("Sale", saleSchema);