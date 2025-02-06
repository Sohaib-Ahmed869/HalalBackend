// controllers/permission.controller.js
const { User } = require("../models/user.model");

class PermissionController {
  // Get user permissions
  static async getUserPermissions(req, res) {
    try {
      const { userId } = req.params;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      // If user is admin, they have access to everything
      if (user.isAdmin) {
        const allModules = [
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

        return res.json({
          isAdmin: true,
          permissions: allModules.map((module) => ({
            module,
            hasAccess: true,
          })),
        });
      }

      res.json({
        isAdmin: false,
        permissions: user.permissions,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch user permissions",
        details: error.message,
      });
    }
  }

  // Update user permissions
  static async updateUserPermissions(req, res) {
    try {
      const { userId } = req.params;
      const { permissions } = req.body;

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      // Update permissions
      user.permissions = permissions;
      await user.save();

      res.json({
        message: "Permissions updated successfully",
        user: {
          id: user._id,
          username: user.username,
          permissions: user.permissions,
        },
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to update permissions",
        details: error.message,
      });
    }
  }

  // Check specific permission
  static async checkPermission(req, res) {
    try {
      const { userId, module } = req.params;

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      if (user.isAdmin) {
        return res.json({ hasAccess: true });
      }

      const modulePermission = user.permissions.find(
        (permission) => permission.module === module
      );

      res.json({
        hasAccess: modulePermission ? modulePermission.hasAccess : false,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to check permission",
        details: error.message,
      });
    }
  }

  // Bulk update permissions
  static async bulkUpdatePermissions(req, res) {
    try {
      const { userId } = req.params;
      const { modulePermissions } = req.body;

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      // Update each module permission
      modulePermissions.forEach((permission) => {
        const existingPermission = user.permissions.find(
          (p) => p.module === permission.module
        );

        if (existingPermission) {
          existingPermission.hasAccess = permission.hasAccess;
        } else {
          user.permissions.push(permission);
        }
      });

      await user.save();

      res.json({
        message: "Permissions updated successfully",
        permissions: user.permissions,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to update permissions",
        details: error.message,
      });
    }
  }
}

module.exports = PermissionController;
