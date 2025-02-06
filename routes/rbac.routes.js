// routes/rbac.routes.js
const express = require("express");
const RBACController = require("../controllers/rbac.controller");
const { authenticateToken } = require("../middleware/auth.middleware");
const { checkAccess, isAdmin } = require("../middleware/rbac.middleware");

const router = express.Router();

// Role routes
router.post("/roles", RBACController.createRole);

router.get(
  "/roles",
  authenticateToken,
  checkAccess("Settings", "read"),
  RBACController.getRoles
);

router.put(
  "/roles/:roleId",
  authenticateToken,
  isAdmin,
  RBACController.updateRole
);

// Resource routes
router.post(
  "/resources",
  authenticateToken,
  isAdmin,
  RBACController.createResource
);

router.get("/resources", authenticateToken, RBACController.getResources);

// User-Role management
router.post(
  "/users/assign-role",
  authenticateToken,
  isAdmin,
  RBACController.assignRoleToUser
);

router.get(
  "/users/:userId/access",
  authenticateToken,
  RBACController.getUserAccess
);

// Access check
router.post("/check-access", authenticateToken, RBACController.checkAccess);
router.patch(
  "/roles/:roleId/permissions",
  authenticateToken,
  isAdmin,
  RBACController.updateRolePermissions
);

// Update single module permissions for a role
router.patch(
  "/roles/:roleId/permissions/:module",
  authenticateToken,
  isAdmin,
  RBACController.updateModulePermission
);
module.exports = router;
