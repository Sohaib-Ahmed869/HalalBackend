// middleware/rbac.middleware.js
const { User } = require("../models/user.model");

const checkAccess = (module, action) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.userId).populate("role");

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      // Admin has full access
      if (user.role.isAdmin) {
        return next();
      }

      const moduleAccess = user.role.accesses.find(
        (access) => access.module === module
      );

      if (!moduleAccess || !moduleAccess[action]) {
        return res.status(403).json({
          error: "Access denied",
          details: `Insufficient permissions for ${action} on ${module}`,
        });
      }

      next();
    } catch (error) {
      res.status(500).json({
        error: "Access check failed",
        details: error.message,
      });
    }
  };
};

const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId).populate("role");

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    if (!user.role.isAdmin) {
      return res.status(403).json({
        error: "Access denied",
        details: "Admin access required",
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      error: "Admin check failed",
      details: error.message,
    });
  }
};

module.exports = {
  checkAccess,
  isAdmin,
};
