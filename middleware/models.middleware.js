// middleware/models.middleware.js
const { getModel } = require("../utils/modelFactory");

function modelsMiddleware(req, res, next) {
  // Skip if no database connection
  if (!req.dbConnection) {
    return next();
  }

  // Create a models property on the request
  req.models = new Proxy(
    {},
    {
      get(target, modelName) {
        try {
          return getModel(req.dbConnection, modelName);
        } catch (error) {
          console.error(`Error getting model ${modelName}:`, error);
          return null;
        }
      },
    }
  );

  next();
}

module.exports = modelsMiddleware;
