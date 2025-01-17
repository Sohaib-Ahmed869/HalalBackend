const SalesOrder = require('../models/salesOrder.model');

// Get all sales orders
const getAllSalesOrders = async (req, res) => {
  try {
    const salesOrders = await SalesOrder.find()
      .sort({ DocDate: -1 }); // Sort by date descending

    res.status(200).json({
      success: true,
      count: salesOrders.length,
      data: salesOrders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server Error',
      details: error.message
    });
  }
};

// Get sales orders by date range
const getSalesOrdersByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Validate date parameters
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Please provide both start and end dates'
      });
    }

    // Create date objects and set time to start and end of day
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const salesOrders = await SalesOrder.find({
      DocDate: {
        $gte: start,
        $lte: end
      }
    }).sort({ DocDate: -1 });

    res.status(200).json({
      success: true,
      count: salesOrders.length,
      data: salesOrders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server Error',
      details: error.message
    });
  }
};

module.exports = {
  getAllSalesOrders,
  getSalesOrdersByDateRange
};