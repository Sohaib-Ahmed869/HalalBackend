const mongoose = require("mongoose");
const CustomerSchema = new mongoose.Schema({
    CardName: {
        type: String,
        required: true,
    },
    CardCode: {
        type: String,
        required: true,
        unique: true,
    },
    Email: {
        type: String,
        required: true
    },
});
const Customer = mongoose.model("Customer", CustomerSchema);
module.exports = Customer;
