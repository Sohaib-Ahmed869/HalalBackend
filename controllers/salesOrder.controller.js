const SalesOrder = require('../models/salesOrder.model');
const Customer = require('../models/customer.model');

// Get all sales orders
const getAllSalesOrders = async (req, res) => {
  try {
    const salesOrders = await SalesOrder.find()
      .sort({ DocDate: -1 }); // Sort by date descending
    const Customers = await Customer.find();
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
const getSalesOrderWithCustomer = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const salesOrdersWithCustomer = await SalesOrder.aggregate([
      {
        $lookup: {
          from: 'customers', // The collection name in MongoDB
          localField: 'CardCode',
          foreignField: 'CardCode',
          as: 'customer'
        }
      },
      {
        $unwind: {
          path: '$customer',
          preserveNullAndEmptyArrays: true // Keep sales orders without a matching customer
        }
      },
      {
        $sort: { DocDate: -1 } // Sort by date descending
      },
      {
        $addFields: {
          Email: { $ifNull: ['$customer.Email', null] }
        }
      },
      { $skip: skip },
      { $limit: limit }
    ]);

    const total = await SalesOrder.countDocuments();

    res.status(200).json({
      success: true,
      count: salesOrdersWithCustomer.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: salesOrdersWithCustomer
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
  getSalesOrdersByDateRange,
  getSalesOrderWithCustomer
};