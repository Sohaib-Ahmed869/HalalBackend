const axios = require("axios");
const dns = require("dns");
class AuthController {
  static async login(req, res) {
    try {
      res.header("Access-Control-Allow-Credentials", "true");
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          error: "Missing credentials",
          details: "Username and password are required",
        });
      }

      if (
        username !== process.env.USER_NAME ||
        password !== process.env.PASSWORD
      ) {
        return res.status(401).json({
          error: "Invalid credentials",
          details: "Username or password is incorrect",
        });
      }

      res.json({
        message: "Login successful",
        user: { username },
      });
    } catch (error) {
      console.error("Login error:", error.message);
      res.status(500).json({
        error: "Login failed",
        details: error.message,
      });
    }
  }

  static async logout(req, res) {
    try {
      res.json({ message: "Logout successful" });
    } catch (error) {
      res.status(500).json({ error: "Logout failed" });
    }
  }
}

module.exports = AuthController;
