// utils/modelFactory.js
const mongoose = require('mongoose');

// Store all schema definitions
const schemas = {};

// Register a schema with the factory
function registerSchema(modelName, schema) {
  if (!schema) {
    console.error(`Warning: Schema for ${modelName} is undefined`);
    return; // Skip registration if schema is undefined
  }
  
  try {
    // Handle different ways schemas might be exported
    let actualSchema = schema;
    
    // If schema has a schema property, use it
    if (schema && schema.schema) {
      actualSchema = schema.schema;
    }
    
    schemas[modelName] = actualSchema;
    console.log(`Successfully registered schema for model: ${modelName}`);
  } catch (error) {
    console.error(`Error registering schema for ${modelName}:`, error.message);
  }
}

// Get a model with the appropriate connection
function getModel(dbConnection, modelName) {
  if (!schemas[modelName]) {
    throw new Error(`Schema for model "${modelName}" not registered`);
  }
  
  // Check if model already exists for this connection to avoid recompilation warnings
  if (dbConnection.models[modelName]) {
    return dbConnection.models[modelName];
  }
  
  // Create and return the model with this connection
  return dbConnection.model(modelName, schemas[modelName]);
}

module.exports = {
  registerSchema,
  getModel
};