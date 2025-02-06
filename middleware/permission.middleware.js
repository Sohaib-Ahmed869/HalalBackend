const { User } = require("../models/user.model");

const checkPermission = (module) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.userId);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      // Admin has full access
      if (user.isAdmin) {
        return next();
      }

      const modulePermission = user.permissions.find(
        (permission) => permission.module === module
      );

      if (!modulePermission || !modulePermission.hasAccess) {
        return res.status(403).json({
          error: "Access denied",
          details: `Insufficient permissions for ${module}`,
        });
      }

      next();
    } catch (error) {
      res.status(500).json({
        error: "Permission check failed",
        details: error.message,
      });
    }
  };
};

const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    if (!user.isAdmin) {
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
  checkPermission,
  isAdmin,
};
