const axios = require("axios");

class DepositController {
  static async getDeposits(req, res) {
    try {
      const response = await axios.get(`${process.env.BASE_URL}/Deposits`, {
        headers: {
          Cookie: req.headers.cookie,
        },
      });
      res.json(response.data.value);
    } catch (error) {
      console.error(
        "Error fetching deposits:",
        error.response?.data || error.message
      );
      res.status(500).json({ error: "Failed to fetch deposits" });
    }
  }

  static async getDepositsByDate(req, res) {
    try {
      const { startDate, endDate } = req.query;

      // Validate date parameters
      if (!startDate || !endDate) {
        return res.status(400).json({
          error: "Both startDate and endDate are required",
        });
      }

      // Create Date objects for comparison
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          error: "Invalid date format. Please use YYYY-MM-DD format",
        });
      }

      // Fetch all deposits
      const response = await axios.get(`${process.env.BASE_URL}/Deposits`, {
        headers: {
          Cookie: req.headers.cookie,
        }
      });

      // Filter deposits by date
      const filteredDeposits = response.data.value.filter(deposit => {
        const depositDate = new Date(deposit.DepositDate);
        return depositDate >= start && depositDate <= end;
      });

      // Log for debugging
      console.log('Date range:', { start, end });
      console.log('Total deposits:', response.data.value.length);
      console.log('Filtered deposits:', filteredDeposits.length);

      res.json(filteredDeposits);
    } catch (error) {
      console.error(
        "Error fetching deposits:",
        error.response?.data || error.message
      );
      res.status(500).json({ error: "Failed to fetch deposits" });
    }
  }
}

module.exports = DepositController;