// models/rbac.model.js
const mongoose = require("mongoose");

const PermissionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  description: String,
  resource: {
    type: String,
    required: true,
    enum: [
      "Overview",
      "Reconcilation",
      "Customers",
      "Sales by Tags",
      "Purchase by Tags",
      "Sales",
      "Purchase",
      "Invoices",
      "Bank Statements",
      "Financial Dashboard",
      "Tags",
      "Sales Orders",
      "Help",
      "Settings",
    ],
  },
  action: {
    type: String,
    required: true,
    enum: ["create", "read", "update", "delete", "all"],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const ResourceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    enum: [
      "Overview",
      "Reconcilation",
      "Customers",
      "Sales by Tags",
      "Purchase by Tags",
      "Sales",
      "Purchase",
      "Invoices",
      "Bank Statements",
      "Financial Dashboard",
      "Tags",
      "Sales Orders",
      "Help",
      "Settings",
    ],
  },
  description: String,
  path: String,
  icon: String,
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Resource",
    default: null,
  },
  order: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Permission = mongoose.model("Permission", PermissionSchema);
const Resource = mongoose.model("Resource", ResourceSchema);

module.exports = { Permission, Resource };
