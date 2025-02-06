// routes/permission.routes.js
const express = require("express");
const router = express.Router();
const PermissionController = require("../controllers/permission.controller");
const { authenticateToken } = require("../middleware/auth.middleware");
const { isAdmin } = require("../middleware/permission.middleware");

// Get user permissions
router.get("/user/:userId", PermissionController.getUserPermissions);

// Check specific permission for a user
router.get("/check/:userId/:module", PermissionController.checkPermission);

// Update user permissions
router.put("/user/:userId", PermissionController.updateUserPermissions);

// Bulk update permissions
router.put("/bulk/:userId", PermissionController.bulkUpdatePermissions);
module.exports = router;
