const jwt = require("jsonwebtoken");
const { User } = require("../models/user.model");
const { getConnection } = require("../config/db.config");
const { getModel } = require("../utils/modelFactory");

class AuthController {
  static async login(req, res) {
    try {
      res.header("Access-Control-Allow-Credentials", "true");
      const { username, password, company } = req.body;
      console.log("Login request:", req.body);
      if (!username || !password || !company) {
        return res.status(400).json({
          error: "Missing credentials",
          details: "Username, password, and company are required",
        });
      }

      // Get the connection for the selected company
      const db = await getConnection(company);

      // Dynamically get the User model with the correct connection
      const userSchema = require("../models/user.model").userSchema;
      const User = getModel(db, "User");

      // Find user
      const user = await User.findOne({ username });

      if (!user || !user.isActive) {
        return res.status(401).json({
          error: "Invalid credentials",
          details: "Username or password is incorrect",
        });
      }

      // Validate password
      const isValidPassword = await user.validatePassword(password);
      if (!isValidPassword) {
        return res.status(401).json({
          error: "Invalid credentials",
          details: "Username or password is incorrect",
        });
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate access token with company info included
      const token = jwt.sign(
        {
          userId: user._id,
          username: user.username,
          isAdmin: user.isAdmin,
          company: company, // Include company in the token
        },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );

      // Prepare user access data
      let permissions;
      if (user.isAdmin) {
        permissions = AuthController.generateFullAccess();
      } else {
        permissions = user.permissions;
      }

      res.json({
        message: "Login successful",
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          isAdmin: user.isAdmin,
          permissions: permissions,
          company: company, // Return company to frontend
        },
        token,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        error: "Login failed",
        details: error.message,
      });
    }
  }

  static async logout(req, res) {
    try {
      // In a real implementation, you might want to blacklist the token
      // or implement a token revocation mechanism
      res.json({ message: "Logout successful" });
    } catch (error) {
      res.status(500).json({ error: "Logout failed" });
    }
  }

  static generateFullAccess() {
    const modules = [
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
    ];

    return modules.map((module) => ({
      module,
      hasAccess: true,
    }));
  }

  static async createUser(req, res) {
    try {
      const {
        username,
        password,
        email,
        isAdmin = false,
        permissions = [],
      } = req.body;

      // Create default permissions if none provided
      const defaultPermissions = AuthController.generateDefaultPermissions();

      const User = getModel(req.dbConnection, "User");
      const user = new User({
        username,
        password,
        email,
        isAdmin,
        permissions: permissions.length > 0 ? permissions : defaultPermissions,
      });

      await user.save();

      res.status(201).json({
        message: "User created successfully",
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          isAdmin: user.isAdmin,
          permissions: user.permissions,
        },
      });
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({
        error: "Failed to create user",
        details: error.message,
      });
    }
  }

  static generateDefaultPermissions() {
    const modules = [
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
    ];

    return modules.map((module) => ({
      module,
      hasAccess: module === "Help", // Only Help module is accessible by default
    }));
  }

  static async getUserAccess(req, res) {
    try {
      const userId = req.params.userId;
      const User = getModel(req.dbConnection, "User");
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const permissions = user.isAdmin
        ? AuthController.generateFullAccess()
        : user.permissions;

      res.json({
        isAdmin: user.isAdmin,
        permissions,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to get user access",
        details: error.message,
      });
    }
  }

  static async getAllUsers(req, res) {
    try {
      const db = await getConnection(req.body.company);
      const User = getModel(req.dbConnection, "User");
      const users = await User.find({}, "-password");

      res.json(users);
    } catch (error) {
      console.error("Get all users error:", error);
      res.status(500).json({
        error: "Failed to get users",
        details: error.message,
      });
    }
  }
}

module.exports = AuthController;
