// middleware/auth.middleware.js
const jwt = require("jsonwebtoken");
const { getConnection } = require("../config/db.config");

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header or cookie
    const token =
      req.headers.authorization?.split(" ")[1] || req.cookies?.token;
    if (!token) {
      return res.status(401).json({
        error: "Authentication required",
        details: "No token provided",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if token contains company info
    if (!decoded.company) {
      return res.status(401).json({
        error: "Invalid token format",
        details: "Company information missing in token",
      });
    }

    // Set user and company info on request object
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      isAdmin: decoded.isAdmin,
    };
    req.company = decoded.company;

    // Get DB connection for this company
    const dbConnection = await getConnection(decoded.company);
    req.dbConnection = dbConnection;

    // Continue to next middleware/route handler
    next();
  } catch (error) {
    console.error("Authentication error:", error);

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        error: "Invalid token",
        details: "Token verification failed",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Token expired",
        details: "Please log in again",
      });
    }

    res.status(500).json({
      error: "Authentication failed",
      details: error.message,
    });
  }
};

module.exports = authMiddleware;
