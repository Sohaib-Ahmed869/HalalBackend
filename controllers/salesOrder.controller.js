const SalesOrder = require("../models/salesOrder.model");
const nodemailer = require("nodemailer");
const axios = require("axios");
const { getModel } = require("../utils/modelFactory");
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
      DocumentStatus: "bost_Open",
    };
    const SalesOrder = getModel(req.dbConnection, "SalesOrder");
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
    const SalesOrder = getModel(req.dbConnection, "SalesOrder");

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
      DocumentStatus: "bost_Open",
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
    const SalesOrder = getModel(req.dbConnection, "SalesOrder");

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
    ]);

    const total = await SalesOrder.countDocuments({
      DocumentStatus: "bost_Open",
    });

    //console log all the order numbers
    salesOrdersWithCustomer.forEach((order) => {});

    return res.status(200).json({
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

const loginToSAP = async (
  company = "MSF Halal New Live",
  retries = 3,
  delay = 5000
) => {
  let lastError;

  // Determine which database to use based on company
  let companyDB;

  if (company === "MSF Halal New Live") {
    companyDB = "MSF_HALAL_LIVE_NEW";
  } else if (company === "company2") {
    companyDB = "A19865_HALAL_FOODSERVICE_BORDEAUX_NEW";
  } else if (company === "company3") {
    companyDB = "A19865_HALAL_FOODSERVICE_LYON_NEW";
  } else {
    companyDB = "MSF_HALAL_LIVE_NEW"; // Default
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(
        `SAP login attempt ${attempt}/${retries} for ${companyDB}...`
      );

      const loginData = {
        CompanyDB: companyDB,
        UserName: process.env.USER_NAME,
        Password: process.env.PASSWORD,
      };

      // Log the request without sensitive information
      console.log(`Attempting to connect to: ${process.env.BASE_URL}/Login`);
      console.log(`Using company DB: ${companyDB}`);

      const response = await axios.post(
        `${process.env.BASE_URL}/Login`,
        loginData,
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 20000, // 20 second timeout for login
          validateStatus: false, // Don't throw errors on non-2xx responses
        }
      );

      // Log response status and headers for debugging
      console.log(`SAP Login response status: ${response.status}`);
      console.log(`SAP Login response headers:`, Object.keys(response.headers));

      // Check if we got a non-successful status code
      if (response.status !== 200) {
        console.error(
          `SAP Login failed with status ${response.status}:`,
          response.data
        );
        throw new Error(
          `SAP returned status ${response.status}: ${JSON.stringify(
            response.data
          )}`
        );
      }

      const cookies = response.headers["set-cookie"];
      if (!cookies || cookies.length === 0) {
        console.error("No cookies returned from SAP login");
        throw new Error("No session cookies received from SAP");
      }

      // Log the cookie names (not values) for debugging
      console.log(
        `Received cookies: ${cookies.map((c) => c.split("=")[0]).join(", ")}`
      );

      // Parse cookie string properly
      const sessionCookie = cookies
        .map((cookie) => cookie.split(";")[0])
        .join("; ");

      console.log(`Successfully logged in to SAP on attempt ${attempt}`);
      return sessionCookie;
    } catch (error) {
      lastError = error;

      // Enhanced error logging
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.error(
          `SAP Login attempt ${attempt} failed with status ${error.response.status}:`
        );
        console.error(`Response data:`, error.response.data);
        console.error(`Response headers:`, error.response.headers);
      } else if (error.request) {
        // The request was made but no response was received
        console.error(
          `SAP Login attempt ${attempt} failed - No response received:`,
          error.request
        );
      } else {
        // Something happened in setting up the request that triggered an Error
        console.error(
          `SAP Login attempt ${attempt} setup error:`,
          error.message
        );
      }

      if (attempt < retries) {
        console.log(`Waiting ${delay / 1000} seconds before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed, throw the last error
  console.error(`SAP Login failed after ${retries} attempts`);
  throw lastError;
};

const generatePaymentLink = async (req, res) => {
  try {
    const { docNum } = req.params;
    const { email } = req.body;
    // Get company from request (set by auth middleware)
    const company = req.company || "MSF Halal New Live";

    // Fetch the sales order
    const SalesOrder = getModel(req.dbConnection, "SalesOrder");

    const salesOrder = await SalesOrder.findOne({ DocNum: docNum });
    if (!salesOrder) {
      return res.status(404).json({
        success: false,
        error: "Sales order not found",
      });
    }

    const customer_account_info = [
      {
        unique_account_identifier: salesOrder.CardCode,
      },
    ];

    // Create JSON with string concatenation (without double stringify)
    const customer_account_info_2 =
      '{"payment_history_simple":' +
      JSON.stringify(customer_account_info) +
      "}";

    // Encode to base64 directly
    const account_info = Buffer.from(customer_account_info_2).toString(
      "base64"
    );

    console.log(customer_account_info);
    console.log(customer_account_info_2);
    console.log("Base 64 code", account_info);

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
      additionalData: {
        "openinvoicedata.merchantData": account_info,
      },

      company: {
        name: salesOrder.CardName,
      },
      shopperEmail: email,

      lineItems: salesOrder.DocumentLines.map((line) => ({
        id: line.LineNum,
        quantity: line.Quantity,
        amountIncludingTax: Math.round(line.PriceAfterVAT * 100),
        amountExcludingTax: Math.round(line.Price * 100),
        //convert to integer
        taxAmount: Math.round((line.PriceAfterVAT - line.Price) * 100),
        taxPercentage: Math.round(
          (line.PriceAfterVAT / line.Price - 1) * 10000
        ),

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
    <h2>Demande de Paiement pour la Commande n°${salesOrder.DocNum}</h2>
    <p>Chère ${salesOrder.CardName},</p>
    <p>Veuillez trouver ci-dessous le lien de paiement pour votre commande :</p>
    <p><a href="${paymentLink}">Cliquez ici pour effectuer votre paiement</a></p>
    <p style="font-weight: bold;">Si vous souhaitez effectuer le paiement après 30 jours, veuillez choisir l'option « Payer par facture pour les entreprises » et remplir les informations requises.</p>
    <p>Le lien de paiement expirera le ${expiryDate.split("T")[0]}.</p>
    <h3>Détails de la commande :</h3>
    <table style="border-collapse: collapse; width: 100%;">
    <thead>
    <tr style="background-color: #f3f4f6;">
    <th style="padding: 8px; border: 1px solid #ddd;">Article</th>
    <th style="padding: 8px; border: 1px solid #ddd;">Quantité</th>
    <th style="padding: 8px; border: 1px solid #ddd;">Prix</th>
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
        "fr-FR",
        {
          style: "currency",
          currency: salesOrder.DocCurrency || "EUR",
        }
      ).format(line.Price)}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${new Intl.NumberFormat(
        "fr-FR",
        {
          style: "currency",
          currency: salesOrder.DocCurrency || "EUR",
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
      "fr-FR",
      {
        style: "currency",
        currency: salesOrder.DocCurrency || "EUR",
      }
    ).format(salesOrder.DocTotal)}</strong></td>
    </tr>
    </tfoot>
    </table>
    <p>Si vous avez des questions, n'hésitez pas à nous contacter.</p>
    <p>Merci pour votre confiance !</p>

    <hr />

    <h2>Payment Request for Sales Order #${salesOrder.DocNum}</h2>
    <p>Dear ${salesOrder.CardName},</p>
    <p>Please find below the payment link for your order:</p>
    <p><a href="${paymentLink}">Click here to make your payment</a></p>
    <p style="font-weight: bold;">If you want to proceed with payment after 30 days, please choose the option "Pay by Invoice for Businesses" and proceed to fill out the required information.</p>
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
    const SalesOrder = getModel(req.dbConnection, "SalesOrder");

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

const syncNewOrders = async (req, res) => {
  try {
    console.log("Starting manual sync for orders...");

    // Get date parameters from request, or use defaults
    let startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : new Date();
    let endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    // If no specific dates provided, default to 3 days back to 5 days forward
    if (!req.query.startDate) {
      startDate.setHours(0, 0, 0, 0);
      startDate.setDate(startDate.getDate() - 3);
    }

    if (!req.query.endDate) {
      endDate.setHours(23, 59, 59, 999);
      endDate.setDate(startDate.getDate() + 5);
    }

    const formattedStartDate = startDate.toISOString();
    const formattedEndDate = endDate.toISOString();

    // Get company from request (set by auth middleware)
    const company = req.company || "MSF Halal New Live";
    const SalesOrder = getModel(req.dbConnection, "SalesOrder");

    const stats = {
      totalProcessed: 0,
      newlyStored: 0,
      skipped: 0,
      failed: 0,
      details: {
        stored: [],
        skipped: [],
        failed: [],
      },
    };

    // Pass the company name to loginToSAP
    const cookies = await loginToSAP(company);
    console.log(cookies);

    let nextLink = `${process.env.BASE_URL}/Orders?$filter=CreationDate ge '${formattedStartDate}' and CreationDate lt '${formattedEndDate}' and DocumentStatus eq 'bost_Open'&$orderby=CreationDate`;
    console.log(
      `Fetching orders for company ${company} from ${formattedStartDate} to ${formattedEndDate}`
    );
    console.log(nextLink);

    while (nextLink) {
      try {
        console.log(`Fetching batch from: ${nextLink}`);

        const response = await axios.get(nextLink, {
          headers: {
            Cookie: cookies,
          },
        });

        const currentBatch = response.data.value;
        console.log(`Processing batch of ${currentBatch.length} orders`);

        for (const order of currentBatch) {
          try {
            const existingOrder = await SalesOrder.findOne({
              DocEntry: order.DocEntry,
            });

            if (!existingOrder) {
              const orderWithMetadata = {
                ...order,
                syncedAt: new Date(),
                lastUpdated: new Date(),
                company: company, // Store company information with the order
              };

              await SalesOrder.create(orderWithMetadata);
              stats.newlyStored++;
              stats.details.stored.push({
                docEntry: order.DocEntry,
                docNum: order.DocNum,
                cardName: order.CardName,
                docTotal: order.DocTotal,
                docDate: order.DocDate,
              });
            } else {
              stats.skipped++;
              stats.details.skipped.push({
                docEntry: order.DocEntry,
                docNum: order.DocNum,
              });
            }

            stats.totalProcessed++;
          } catch (error) {
            stats.failed++;
            stats.details.failed.push({
              docEntry: order.DocEntry,
              docNum: order.DocNum,
              error: error.message,
            });
            console.error(`Failed to process order ${order.DocEntry}:`, error);
          }
        }

        // Get next batch URL if available
        nextLink = response.data["odata.nextLink"];
        if (nextLink && nextLink.startsWith("Order")) {
          nextLink = `${process.env.BASE_URL}/${nextLink}`;
        }
      } catch (error) {
        console.error("Error processing batch:", error);
        return res.status(500).json({
          success: false,
          error: "Batch processing failed",
          details: error.message,
        });
      }
    }

    // Prepare summary response with date range and company information
    const summary = {
      dateRange: {
        from: startDate.toLocaleDateString(),
        to: endDate.toLocaleDateString(),
      },
      company: company,
      stats: {
        totalProcessed: stats.totalProcessed,
        newlyStored: stats.newlyStored,
        skipped: stats.skipped,
        failed: stats.failed,
      },
      newOrders: stats.details.stored.map((order) => ({
        docEntry: order.docEntry,
        docNum: order.docNum,
        cardName: order.cardName,
        docTotal: order.docTotal,
        docDate: order.docDate,
      })),
      skippedOrders: stats.details.skipped,
      failedOrders: stats.details.failed,
    };

    res.status(200).json({
      success: true,
      message: "Sync completed successfully",
      summary,
    });
  } catch (error) {
    console.error("Order sync failed:", error);
    res.status(500).json({
      success: false,
      error: "Sync failed",
      details: error.message,
    });
  }
};

const checkOrderStatus = async (req, res) => {
  try {
    // Configuration options
    const BATCH_SIZE = 20; // SAP's recommended maximum batch size

    console.log("Starting simplified order status check...");

    // Set up filters for the query - only check orders with open status
    const query = {
      DocumentStatus: "bost_Open", // Only get orders that are currently open in our database
    };
    const SalesOrder = getModel(req.dbConnection, "SalesOrder");

    // Count total orders that need checking
    const totalOrdersToCheck = await SalesOrder.countDocuments(query);

    if (totalOrdersToCheck === 0) {
      return res.status(200).json({
        success: true,
        message: "No open orders need checking at this time",
        results: { totalChecked: 0 },
      });
    }

    console.log(`Found ${totalOrdersToCheck} open orders to check`);

    // Results tracking
    const results = {
      totalEligible: totalOrdersToCheck,
      totalChecked: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      details: [],
    };

    // Login to SAP once per run
    const cookies = await loginToSAP();

    // Initialize update operations array
    const updateOperations = [];
    const timestamp = new Date();

    // Process ALL orders in batches of 20
    let processedOrders = 0;
    let skip = 0;
    let currentBatch = [];
    let batchCount = 0;
    let hasMoreOrders = true;

    // Process all open orders in batches
    while (hasMoreOrders) {
      // Get next batch of orders
      currentBatch = await SalesOrder.find(query)
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean();

      // Check if we have more orders after this batch
      skip += currentBatch.length;
      hasMoreOrders = currentBatch.length === BATCH_SIZE;

      // If no orders in this batch, we're done
      if (currentBatch.length === 0) {
        break;
      }

      batchCount++;
      console.log(
        `Processing batch ${batchCount} with ${currentBatch.length} orders`
      );
      batchCount++;
      console.log(
        `Processing batch ${batchCount} with ${currentBatch.length} orders`
      );

      try {
        // Get all order entries for this batch
        const orderEntries = currentBatch.map((order) => order.DocEntry);

        // Update results counter
        results.totalChecked += currentBatch.length;

        // Build query for SAP API
        const batchQuery = orderEntries
          .map((entry) => `DocEntry eq ${entry}`)
          .join(" or ");
        const url = `${process.env.BASE_URL}/Orders?$filter=${batchQuery}&$select=DocEntry,DocNum,DocumentStatus,DocTotal,UpdateDate`;

        // Make a single API call to get all orders
        const response = await axios.get(url, {
          headers: { Cookie: cookies },
          timeout: 30000, // 30 second timeout for the batch
        });

        if (!response.data || !response.data.value) {
          throw new Error("Invalid response from SAP - missing value array");
        }

        const sapOrders = response.data.value;
        console.log(`Received ${sapOrders.length} orders from SAP`);

        // Create a map for quick lookups
        const sapOrderMap = {};
        sapOrders.forEach((order) => {
          sapOrderMap[order.DocEntry] = order;
        });

        // Process all orders in this batch
        for (const order of currentBatch) {
          try {
            const sapOrder = sapOrderMap[order.DocEntry];

            // If this order was not found in SAP response, skip it
            if (!sapOrder) {
              results.failed++;
              results.details.push({
                docNum: order.DocNum,
                error: "Not found in SAP response",
                success: false,
              });
              continue;
            }

            // Check if anything relevant has changed
            const statusChanged =
              order.DocumentStatus !== sapOrder.DocumentStatus;
            const totalChanged = order.DocTotal !== sapOrder.DocTotal;
            const updateDateChanged = order.UpdateDate !== sapOrder.UpdateDate;

            if (statusChanged || totalChanged || updateDateChanged) {
              // Prepare the update operation
              updateOperations.push({
                updateOne: {
                  filter: { DocEntry: order.DocEntry },
                  update: {
                    $set: {
                      DocumentStatus: sapOrder.DocumentStatus,
                      DocTotal: sapOrder.DocTotal,
                      UpdateDate: sapOrder.UpdateDate,
                      lastUpdated: timestamp,
                      lastStatusCheck: timestamp,
                    },
                  },
                },
              });

              results.updated++;
              if (results.details.length < 50) {
                // Limit details to avoid huge responses
                results.details.push({
                  docNum: order.DocNum,
                  oldStatus: order.DocumentStatus,
                  newStatus: sapOrder.DocumentStatus,
                  success: true,
                });
              }
            } else {
              // Update only the lastStatusCheck field
              updateOperations.push({
                updateOne: {
                  filter: { DocEntry: order.DocEntry },
                  update: {
                    $set: {
                      lastStatusCheck: timestamp,
                    },
                  },
                },
              });

              results.unchanged++;
            }
          } catch (error) {
            results.failed++;
            if (results.details.length < 50) {
              results.details.push({
                docNum: order.DocNum,
                error: error.message,
                success: false,
              });
            }
          }
        }

        processedOrders += currentBatch.length;
        console.log(
          `Processed ${processedOrders}/${totalOrdersToCheck} orders so far`
        );
      } catch (error) {
        console.error(`Error processing batch ${batchCount}:`, error);
        results.failed += currentBatch.length;
        results.details.push({
          error: `Batch ${batchCount} failed: ${error.message}`,
          success: false,
        });
      }
    }

    // Perform all database updates in a single bulk operation
    if (updateOperations.length > 0) {
      try {
        const bulkResult = await SalesOrder.bulkWrite(updateOperations, {
          ordered: false,
        });
        console.log(
          `Bulk update completed: ${bulkResult.modifiedCount} documents modified`
        );
      } catch (bulkError) {
        console.error("Error during bulk update:", bulkError);
        results.details.push({
          error: `Bulk update failed: ${bulkError.message}`,
          success: false,
        });
      }
    }

    // Return the results
    res.status(200).json({
      success: true,
      message: `Order status check completed successfully. Processed ${results.totalChecked} orders.`,
      results: {
        totalEligible: results.totalEligible,
        totalChecked: results.totalChecked,
        ordersUpdated: results.updated,
        ordersUnchanged: results.unchanged,
        checksFailed: results.failed,
        details: results.details,
      },
    });
  } catch (error) {
    console.error("Order status check failed:", error);
    res.status(500).json({
      success: false,
      error: "Order status check failed",
      details: error.message,
    });
  }
};
// Add this function to do periodic checks on a schedule without overloading the system
const scheduleOrderStatusChecks = () => {
  const scheduleCheck = async () => {
    try {
      // Base query for open orders
      const query = { DocumentStatus: "bost_Open" };

      // Count eligible orders
      const count = await SalesOrder.countDocuments(query);

      if (count === 0) {
        console.log("No orders need checking");
        return;
      }

      console.log(`Scheduled check: ${count} orders eligible for checking`);

      // Simulate request object for calling checkOrderStatus
      const mockReq = { query: { automated: true } };
      const mockRes = {
        status: (code) => ({
          json: (data) => {
            console.log(`Scheduled check completed with status ${code}`);
            if (code === 200) {
              console.log(`Updated ${data.results.ordersUpdated} orders`);
            } else {
              console.error(`Check failed: ${data.error}`);
            }
          },
        }),
      };

      await checkOrderStatus(mockReq, mockRes);
    } catch (error) {
      console.error("Scheduled order check failed:", error);
    }
  };

  // Schedule checks every hour
  setInterval(() => scheduleCheck(), 60 * 60 * 1000);

  // Run an initial check on startup (after a short delay)
  setTimeout(() => scheduleCheck(), 60 * 1000);
};

// Helper function to process local payment statuses when SAP is unavailable
const processLocalPaymentStatuses = async (orders, results) => {
  const paymentStatusPromises = [];

  // Process orders with Payment_id to check their payment status
  for (const order of orders) {
    if (order.Payment_id && order.Link_sent) {
      paymentStatusPromises.push(
        (async () => {
          try {
            // Check payment status directly with Adyen
            const response = await axios.get(
              `${process.env.ADYEN_API_BASE_URL}/paymentLinks/${order.Payment_id}`,
              {
                headers: {
                  "X-API-KEY": process.env.ADYEN_API_KEY,
                  "Content-Type": "application/json",
                },
                timeout: 10000,
              }
            );

            const paymentStatus = response.data.status;
            const oldStatus = order.payment_status || "unknown";

            if (oldStatus !== paymentStatus) {
              // Update order payment status
              await SalesOrder.updateOne(
                { DocNum: order.DocNum },
                {
                  $set: {
                    payment_status: paymentStatus,
                    lastUpdated: new Date(),
                  },
                }
              );

              results.updated++;
              results.details.push({
                docNum: order.DocNum,
                oldStatus: oldStatus,
                newStatus: paymentStatus,
                source: "payment_gateway",
                success: true,
              });
            } else {
              results.unchanged++;
            }
          } catch (error) {
            console.error(
              `Failed to check payment for order ${order.DocNum}:`,
              error.message
            );
            results.checksFailed++;
            results.details.push({
              docNum: order.DocNum,
              error: `Payment check failed: ${error.message}`,
              success: false,
            });
          }
        })()
      );
    } else {
      // Skip orders without payment IDs
      results.unchanged++;
    }
  }

  // Wait for all payment status checks to complete
  await Promise.allSettled(paymentStatusPromises);
};

// Helper function to process a batch of orders when SAP is available
const processBatch = async (orderBatch, cookies, timeout, results) => {
  // Use Promise.allSettled to ensure all order processing completes
  // even if some orders fail
  const batchPromises = orderBatch.map((order) =>
    processOrder(order, cookies, timeout, results)
  );

  return Promise.allSettled(batchPromises);
};

// Helper function to process a single order
const processOrder = async (order, cookies, timeout, results) => {
  try {
    const SalesOrder = getModel(req.dbConnection, "SalesOrder");

    // Create filter query for a single DocNum
    const response = await axios.get(
      `${process.env.BASE_URL}/Orders('${order.DocEntry}')`,
      {
        headers: { Cookie: cookies },
        timeout: timeout,
      }
    );

    if (!response.data.value || response.data.value.length === 0) {
      console.warn(`No data returned from SAP for order ${order.DocNum}`);
      results.checksFailed++;
      results.details.push({
        docNum: order.DocNum,
        error: "No data returned from SAP",
        success: false,
      });
      return;
    }

    const sapOrder = response.data.value[0];
    const oldStatus = order.DocumentStatus;
    const newStatus = sapOrder.DocumentStatus;
    let statusChanged = false;
    let fieldsToUpdate = {
      lastUpdated: new Date(),
    };

    // Check for status change
    if (oldStatus !== newStatus) {
      fieldsToUpdate.DocumentStatus = newStatus;
      statusChanged = true;
    }

    // Check for total change
    if (order.DocTotal !== sapOrder.DocTotal) {
      fieldsToUpdate.DocTotal = sapOrder.DocTotal;
      statusChanged = true;
    }

    // Check for UpdateDate change
    if (order.UpdateDate !== sapOrder.UpdateDate) {
      fieldsToUpdate.UpdateDate = sapOrder.UpdateDate;
      statusChanged = true;
    }

    // Only update if something changed
    if (statusChanged) {
      await SalesOrder.updateOne(
        { DocNum: order.DocNum },
        { $set: fieldsToUpdate }
      );

      results.updated++;
      results.details.push({
        docNum: order.DocNum,
        oldStatus: oldStatus,
        newStatus: newStatus,
        source: "sap",
        success: true,
      });
    } else {
      results.unchanged++;
    }

    // Additional check for payment status if the order has a payment ID
    if (order.Payment_id && !order.payment_status) {
      try {
        // Check payment status directly with Adyen
        const paymentResponse = await axios.get(
          `${process.env.ADYEN_API_BASE_URL}/paymentLinks/${order.Payment_id}`,
          {
            headers: {
              "X-API-KEY": process.env.ADYEN_API_KEY,
              "Content-Type": "application/json",
            },
            timeout: 5000,
          }
        );

        const paymentStatus = paymentResponse.data.status;
        if (paymentStatus && paymentStatus !== order.payment_status) {
          await SalesOrder.updateOne(
            { DocNum: order.DocNum },
            {
              $set: {
                payment_status: paymentStatus,
                lastUpdated: new Date(),
              },
            }
          );

          // Only count as update if not already counted above
          if (!statusChanged) {
            results.updated++;
            results.details.push({
              docNum: order.DocNum,
              oldStatus: order.payment_status || "none",
              newStatus: paymentStatus,
              source: "payment_gateway",
              success: true,
            });
          }
        }
      } catch (paymentError) {
        // Don't fail the entire order process if payment check fails
        console.warn(
          `Payment status check failed for order ${order.DocNum}: ${paymentError.message}`
        );
      }
    }
  } catch (error) {
    console.error(`Failed to check order ${order.DocNum}:`, error.message);
    results.checksFailed++;
    results.details.push({
      docNum: order.DocNum,
      error: error.message,
      success: false,
    });
  }
};  

module.exports = {
  getAllSalesOrders,
  getSalesOrdersByDateRange,
  getSalesOrderWithCustomer,
  generatePaymentLink,
  getUpdateOnPaymentLink,
  syncNewOrders,
  checkOrderStatus,
};
