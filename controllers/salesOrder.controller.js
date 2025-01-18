const SalesOrder = require("../models/salesOrder.model");
const Customer = require("../models/customer.model");
const nodemailer = require("nodemailer");
const axios = require("axios");

require("dotenv").config();


const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    email: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

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
      CreationDate: {
        $gte: start,
        $lte: end,
      },
      DocumentStatus: "bost_Open", // Filter for open status only
    };

    const salesOrdersWithCustomer = await SalesOrder.aggregate([
      {
        $match: query,
      },
      {
        $lookup: {
          from: "customers", // The collection name in MongoDB
          localField: "CardCode",
          foreignField: "CardCode",
          as: "customer",
        },
      },
      {
        $unwind: {
          path: "$customer",
          preserveNullAndEmptyArrays: true, // Keep sales orders without a matching customer
        },
      },
      {
        $sort: { CreationDate: -1 }, // Sort by date descending
      },
      {
        $addFields: {
          Email: { $ifNull: ["$customer.Email", null] },
        },
      },
      { $skip: skip },
      { $limit: limit },
    ]);

    const total = await SalesOrder.countDocuments(query);

    res.status(200).json({
      success: true,
      count: salesOrdersWithCustomer.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: salesOrdersWithCustomer,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server Error",
      details: error.message,
    });
  }
};
const getSalesOrderWithCustomer = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const query = {
      DocumentStatus: "bost_Open", // Filter for open status only
    };
    const salesOrdersWithCustomer = await SalesOrder.aggregate([
      {
        $match: {
          DocumentStatus: "bost_Open",
        },
      },
      {
        $lookup: {
          from: "customers", // The collection name in MongoDB
          localField: "CardCode",
          foreignField: "CardCode",
          as: "customer",
        },
      },
      {
        $unwind: {
          path: "$customer",
          preserveNullAndEmptyArrays: true, // Keep sales orders without a matching customer
        },
      },
      {
        $sort: { CreationDate: -1 }, // Sort by date descending
      },
      {
        $addFields: {
          Email: { $ifNull: ["$customer.Email", null] },
        },
      },
      { $skip: skip },
      { $limit: limit },
    ]);

    const total = await SalesOrder.countDocuments({
      DocumentStatus: "bost_Open",
    });

    res.status(200).json({
      success: true,
      count: salesOrdersWithCustomer.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: salesOrdersWithCustomer,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server Error",
      details: error.message,
    });
  }
};

const generatePaymentLink = async (req, res) => {
  try {
    const { docNum } = req.params;
    const { email } = req.body;
    // Fetch the sales order
    const salesOrder = await SalesOrder.findOne({ DocNum: docNum });
    if (!salesOrder) {
      return res.status(404).json({
        success: false,
        error: "Sales order not found",
      });
    }

    // Prepare the payment link request for Adyen
    const paymentLinkRequest = {
      reference: `SO-${salesOrder.DocNum}`,
      amount: {
        value: Math.round(salesOrder.DocTotal * 100), // Convert to cents
        currency: salesOrder.DocCurrency || "EUR",
      },
      description: `Payment for Sales Order #${salesOrder.DocNum}`,
      countryCode: "FR",
      merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
      shopperReference: salesOrder.CardCode,
      shopperEmail: email,
      lineItems: salesOrder.DocumentLines.map((line) => ({
        quantity: line.Quantity,
        amountIncludingTax: Math.round(line.LineTotal * 100),
        description: line.ItemDescription,
      })),
    };

    // Generate payment link through Adyen
    const response = await axios.post(
      `${process.env.ADYEN_API_BASE_URL}/paymentLinks`,
      paymentLinkRequest,
      {
        headers: {
          "X-API-KEY": process.env.ADYEN_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const paymentLink = response.data.url;

    //get the payment id
    const paymentId = response.data.id;

    //convert to ISO string
    const expiryDate = new Date(response.data.expiresAt).toISOString();

    // Save the payment id to the sales order
    salesOrder.Payment_id = paymentId;

    //set link sent to true
    salesOrder.Link_sent = true;

    // Prepare email content
    const emailHtml = `
    <h2>Payment Request for Sales Order #${salesOrder.DocNum}</h2>
    <p>Dear ${salesOrder.CardName},</p>
    <p>Please find below the payment link for your order:</p>
    <p><a href="${paymentLink}">Click here to make your payment</a></p>
    <p>The payment link will expire on ${expiryDate.split("T")[0]}.</p>
    <h3>Order Details:</h3>
    <table style="border-collapse: collapse; width: 100%;">
    <thead>
    <tr style="background-color: #f3f4f6;">
    <th style="padding: 8px; border: 1px solid #ddd;">Item</th>
    <th style="padding: 8px; border: 1px solid #ddd;">Quantity</th>
    <th style="padding: 8px; border: 1px solid #ddd;">Price</th>
    <th style="padding: 8px; border: 1px solid #ddd;">Total</th>
    </tr>
    </thead>
    <tbody>
    ${salesOrder.DocumentLines.map(
      (line) => `
      <tr>
      <td style="padding: 8px; border: 1px solid #ddd;">${
        line.ItemDescription
      }</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${line.Quantity}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${new Intl.NumberFormat(
            "en-US",
            {
              style: "currency",
              currency: salesOrder.DocCurrency || "USD",
            }
          ).format(line.Price)}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${new Intl.NumberFormat(
                "en-US",
                {
                  style: "currency",
                  currency: salesOrder.DocCurrency || "USD",
                }
              ).format(line.LineTotal)}</td>
                  </tr>
                  `
    ).join("")}
                </tbody>
                <tfoot>
                <tr style="background-color: #f3f4f6;">
                <td colspan="3" style="padding: 8px; border: 1px solid #ddd;"><strong>Total</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>${new Intl.NumberFormat(
                  "en-US",
                  {
                    style: "currency",
                    currency: salesOrder.DocCurrency || "USD",
                  }
                ).format(salesOrder.DocTotal)}</strong></td>
                </tr>
                </tfoot>
                </table>

                <p>If you have any questions, please don't hesitate to contact us.</p>
                <p>Thank you for your business!</p>
                `;

    // Send email
    await transporter.sendMail({
      from: process.env.SMTP_EMAIL,
      to: email,
      subject: `Payment Link for Sales Order #${salesOrder.DocNum}`,
      html: emailHtml,
    });

    await salesOrder.save();

    // Return success response
    res.status(200).json({
      success: true,
      message: "Payment link generated and sent successfully",
      paymentLink,
    });
  } catch (error) {
    console.error("Error in generatePaymentLink:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate payment link",
      details: error.message,
    });
  }
};

const getUpdateOnPaymentLink = async (req, res) => {
  try {
    const { docNum } = req.params;
    const salesOrder = await SalesOrder.findOne({ DocNum: docNum });

    if (!salesOrder) {
      return res.status(404).json({
        success: false,
        error: "Sales order not found",
      });
    }

    // send request to Adyen to get payment status
    const response = await axios.get(
      `${process.env.ADYEN_API_BASE_URL}/paymentLinks/${salesOrder.Payment_id}`,
      {
        headers: {
          "X-API-KEY": process.env.ADYEN_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const paymentStatus = response.data.status;

    // if (paymentStatus === "PAID") {
    //   // update the sales order status to paid
    //   salesOrder.DocumentStatus = "bost_Paid";
    //   await salesOrder.save();
    // }

    salesOrder.payment_status = paymentStatus;

    await salesOrder.save();

    res.status(200).json({
      success: true,
      message: "Payment status updated successfully",
      paymentStatus,
    });
  } catch (error) {
    console.error("Error in getUpdateOnPaymentLink:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update payment status",
      details: error.message,
    });
  }
};

module.exports = {
  getAllSalesOrders,
  getSalesOrdersByDateRange,
  getSalesOrderWithCustomer,
  generatePaymentLink,
  getUpdateOnPaymentLink,
};
