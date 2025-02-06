const { Permission, Resource } = require("../models/rbac.model");
const { User, Role } = require("../models/user.model");

class RBACController {
  // Role Management
  static async createRole(req, res) {
    try {
      const { name, description, accesses, isAdmin } = req.body;

      const role = new Role({
        name,
        description,
        accesses,
        isAdmin,
      });

      await role.save();
      res.status(201).json(role);
    } catch (error) {
      res.status(500).json({
        error: "Failed to create role",
        details: error.message,
      });
    }
  }

  static async getRoles(req, res) {
    try {
      const roles = await Role.find();
      res.json(roles);
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch roles",
        details: error.message,
      });
    }
  }

  static async updateRole(req, res) {
    try {
      const { roleId } = req.params;
      const { name, description, accesses, isAdmin } = req.body;

      const role = await Role.findByIdAndUpdate(
        roleId,
        { name, description, accesses, isAdmin },
        { new: true }
      );

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      res.json(role);
    } catch (error) {
      res.status(500).json({
        error: "Failed to update role",
        details: error.message,
      });
    }
  }

  // Resource Management
  static async createResource(req, res) {
    try {
      const { name, description, path, icon, parent, order } = req.body;

      const resource = new Resource({
        name,
        description,
        path,
        icon,
        parent,
        order,
      });

      await resource.save();
      res.status(201).json(resource);
    } catch (error) {
      res.status(500).json({
        error: "Failed to create resource",
        details: error.message,
      });
    }
  }

  static async getResources(req, res) {
    try {
      const resources = await Resource.find().populate("parent").sort("order");
      res.json(resources);
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch resources",
        details: error.message,
      });
    }
  }

  // User Role Management
  static async assignRoleToUser(req, res) {
    try {
      const { userId, roleId } = req.body;

      const user = await User.findById(userId);
      const role = await Role.findById(roleId);

      if (!user || !role) {
        return res.status(404).json({
          error: "User or Role not found",
        });
      }

      user.role = roleId;
      await user.save();

      res.json({
        message: "Role assigned successfully",
        user: {
          id: user._id,
          username: user.username,
          role: role.name,
        },
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to assign role",
        details: error.message,
      });
    }
  }

  // Fix the getUserAccess method in RBACController
  static async getUserAccess(req, res) {
    try {
      const { userId } = req.params;

      const user = await User.findById(userId).populate("role");

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      // If user is admin, they have access to everything
      if (user.role?.isAdmin) {
        const allResources = await Resource.find();
        const fullAccess = allResources.map((resource) => ({
          module: resource.name,
          read: true,
          write: true,
          delete: true,
        }));
        return res.json({
          isAdmin: true,
          accesses: fullAccess,
        });
      }

      // For non-admin users
      res.json({
        isAdmin: false,
        accesses: user.role?.accesses || [],
      });
    } catch (error) {
      console.error("Error in getUserAccess:", error);
      res.status(500).json({
        error: "Failed to fetch user access",
        details: error.message,
      });
    }
  }

  // Check specific access
  static async checkAccess(req, res) {
    try {
      const { userId, module, action } = req.body;

      const user = await User.findById(userId).populate("role");

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      if (user.role.isAdmin) {
        return res.json({ hasAccess: true });
      }

      const moduleAccess = user.role.accesses.find(
        (access) => access.module === module
      );

      if (!moduleAccess) {
        return res.json({ hasAccess: false });
      }

      const hasAccess = moduleAccess[action] === true;
      res.json({ hasAccess });
    } catch (error) {
      res.status(500).json({
        error: "Failed to check access",
        details: error.message,
      });
    }
  }

  static async updateRolePermissions(req, res) {
    try {
      const { roleId } = req.params;
      const { modulePermissions } = req.body;

      const role = await Role.findById(roleId);

      if (!role) {
        return res.status(404).json({
          error: "Role not found",
        });
      }

      // Update permissions for each module
      modulePermissions.forEach((permission) => {
        const existingAccess = role.accesses.find(
          (access) => access.module === permission.module
        );

        if (existingAccess) {
          // Update existing module permissions
          existingAccess.read = permission.read;
          existingAccess.write = permission.write;
          existingAccess.delete = permission.delete;
        } else {
          // Add new module permissions
          role.accesses.push(permission);
        }
      });

      await role.save();

      res.json({
        message: "Role permissions updated successfully",
        role,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to update role permissions",
        details: error.message,
      });
    }
  }

  static async updateModulePermission(req, res) {
    try {
      const { roleId, module } = req.params;
      const { read, write, delete: deletePermission } = req.body;

      const role = await Role.findById(roleId);

      if (!role) {
        return res.status(404).json({
          error: "Role not found",
        });
      }

      const existingAccess = role.accesses.find(
        (access) => access.module === module
      );

      if (existingAccess) {
        // Update existing module permissions
        existingAccess.read = read;
        existingAccess.write = write;
        existingAccess.delete = deletePermission;
      } else {
        // Add new module permissions
        role.accesses.push({
          module,
          read,
          write,
          delete: deletePermission,
        });
      }

      await role.save();

      res.json({
        message: "Module permissions updated successfully",
        role,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to update module permissions",
        details: error.message,
      });
    }
  }
}

module.exports = RBACController;
