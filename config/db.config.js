// Create a new file: config/db.config.js
const mongoose = require("mongoose");

// Database connection mapping
const connectionStrings = {
  "MSF Halal New Live":
    "mongodb+srv://sohaibsipra869:nvidia940MX@cluster0.q1so4va.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
  company2:
    "mongodb+srv://<db_username>:<db_password>@halalfoodservicebordeau.dvx3f.mongodb.net/?retryWrites=true&w=majority&appName=Halalfoodservicebordeaux",
  company3:
    "mongodb+srv://<db_username>:<db_password>@halalfoodservicelyon.rcrvmyr.mongodb.net/?retryWrites=true&w=majority&appName=Halalfoodservicelyon",
};

// Replace placeholders with actual credentials
const getConnectionString = (company) => {
  let connectionString =
    connectionStrings[company] || connectionStrings["MSF Halal New Live"]; // Default
  return connectionString
    .replace("<db_username>", "Sohaib")
    .replace("<db_password>", "nvidia940MX");
};

// Connection cache to avoid reconnecting unnecessarily
const connections = {};

// Get the appropriate connection
const getConnection = async (company) => {
  if (!connections[company]) {
    const connectionString = getConnectionString(company);
    connections[company] = await mongoose.createConnection(connectionString, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`Connected to ${company} database`);
  }
  return connections[company];
};

module.exports = {
  getConnection,
};
