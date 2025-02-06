// models/user.model.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserPermissionSchema = new mongoose.Schema({
  module: {
    type: String,
    required: true,
    enum: [
      "Overview",
      "Financial Dashboard",
      "Reconcilation",
      "Customers",
      "Sales Orders",
      "Purchases",
      "Expenses",
      "Invoices",
      "Bank Statements",
      "Tags",
      "Help",
      "Settings",
    ],
  },
  hasAccess: {
    type: Boolean,
    default: false,
  },
});

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  permissions: [UserPermissionSchema],
  isActive: {
    type: Boolean,
    default: true,
  },
  lastLogin: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Hash password before saving
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to validate password
UserSchema.methods.validatePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

const User = mongoose.model("User", UserSchema);

module.exports = { User };
