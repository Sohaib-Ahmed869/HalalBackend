const axios = require("axios");
const dns = require("dns");
class AuthController {
  static async login(req, res) {
    try {
      dns.lookup("htpc19865p01y.cloudiax.com", (err, address, family) => {
        console.log("DNS Resolution:", {
          error: err,
          address: address,
          ipVersion: family,
        });
      });
      res.header("Access-Control-Allow-Credentials", "true");
      // Get credentials from request body
      const { username, password } = req.body;

      // Validate request body
      if (!username || !password) {
        return res.status(400).json({
          error: "Missing credentials",
          details: "Username and password are required",
        });
      }

      const loginData = {
        CompanyDB: process.env.COMPANY_DB,
        UserName: username,
        Password: password,
      };

      const response = await axios.post(
        `${process.env.BASE_URL}/Login`,
        loginData
      );

      // Extract cookies from response
      const cookies = response.headers["set-cookie"];
      let cookieData = {};

      // Parse and store cookies
      if (cookies) {
        cookies.forEach((cookie) => {
          // Extract cookie name and value
          const [cookieString] = cookie.split(";");
          const [name, value] = cookieString.split("=");
          cookieData[name] = value;

          // Set each cookie in response
          res.cookie(name, value, {
            httpOnly: true,
            secure: true,
            sameSite: "strict",
          });
        });
      }

      // Return both cookies in response for visibility
      res.json({
        message: "Login successful",
        cookies: {
          B1SESSION: cookieData.B1SESSION || null,
          ROUTEID: cookieData.ROUTEID || null,
        },
      });

      // Log cookies for debugging
      console.log("Received cookies:", cookies);
      console.log("Parsed cookie data:", cookieData);
    } catch (error) {
      // Check if it's an authentication error from the API
      if (error.response?.status === 401) {
        return res.status(401).json({
          error: "Invalid credentials",
          details: "Username or password is incorrect",
        });
      }

      console.error("Login error:", error.response?.data || error.message);
      console.error("Full error:", error);
      res.status(500).json({
        error: "Login failed",
        details: error.response?.data || error.message,
      });
    }
  }

  static async logout(req, res) {
    try {
      await axios.post(
        `${process.env.BASE_URL}/Logout`,
        {},
        {
          headers: {
            Cookie: req.headers.cookie,
          },
        }
      );

      // Clear both cookies
      res.clearCookie("B1SESSION");
      res.clearCookie("ROUTEID");

      res.json({ message: "Logout successful" });
    } catch (error) {
      console.error("Logout error:", error.response?.data || error.message);
      res.status(500).json({ error: "Logout failed" });
    }
  }
}

module.exports = AuthController;
