const SalesOrder = require("../models/salesOrder.model");

// Get paginated sales orders with open status
const getAllSalesOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const skip = (page - 1) * limit;

    const query = {
      DocumentStatus: "bost_Open", // Filter for open status only
    };

    const [salesOrders, total] = await Promise.all([
      SalesOrder.find(query).sort({ DocDate: -1 }).skip(skip).limit(limit),
      SalesOrder.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: salesOrders.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: salesOrders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server Error",
      details: error.message,
    });
  }
};

// Get sales orders by date range with pagination
const getSalesOrdersByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const skip = (page - 1) * limit;

    // Validate date parameters
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "Please provide both start and end dates",
      });
    }

    // Create date objects and set time to start and end of day
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const query = {
      DocDate: {
        $gte: start,
        $lte: end,
      },
      DocumentStatus: "bost_Open", // Filter for open status only
    };

    const [salesOrders, total] = await Promise.all([
      SalesOrder.find(query).sort({ DocDate: -1 }).skip(skip).limit(limit),
      SalesOrder.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: salesOrders.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: salesOrders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server Error",
      details: error.message,
    });
  }
};

module.exports = {
  getAllSalesOrders,
  getSalesOrdersByDateRange,
};
