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
      DocumentStatus: "bost_Open",
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
    salesOrdersWithCustomer.forEach((order) => {
      console.log(order.DocNum);
    });

    console.log(total);

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

const loginToSAP = async () => {
  try {
    const loginData = {
      CompanyDB: process.env.COMPANY_DB,
      UserName: process.env.USER_NAME,
      Password: process.env.PASSWORD,
    };
    console.log(loginData);

    console.log("Attempting to login to SAP...");

    const response = await axios.post(
      `${process.env.BASE_URL}/Login`,
      loginData,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const cookies = response.headers["set-cookie"];
    if (!cookies) {
      throw new Error("No session cookies received from SAP");
    }

    // Format cookies for subsequent requests
    const sessionCookie = cookies
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    console.log("Successfully logged in to SAP");

    return sessionCookie;
  } catch (error) {
    console.error("SAP Login failed:", error.message);
    throw error;
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

    const customer_acount_info = [
      {
        unique_account_identifier: salesOrder.CardCode,
      },
    ];

    //encode it into base 64
    const account_info = Buffer.from(
      JSON.stringify(customer_acount_info)
    ).toString("base64");

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
        manualCapture: "true",
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
    console.log("Starting manual sync for today's orders...");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const formattedToday = today.toISOString();
    const formattedTomorrow = tomorrow.toISOString();

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
    const cookies = await loginToSAP();
    console.log(cookies);

    let nextLink = `${process.env.BASE_URL}/Orders?$filter=CreationDate ge '${formattedToday}' and CreationDate lt '${formattedTomorrow}'&$orderby=CreationDate`;

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

    // Prepare summary response
    const summary = {
      date: today.toLocaleDateString(),
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
    const openOrders = await SalesOrder.find({ DocumentStatus: "bost_Open" });
    console.log(`Found ${openOrders.length} open orders to check`);

    const cookies = await loginToSAP();

    const results = {
      total: openOrders.length,
      updated: 0,
      unchanged: 0,
      failed: 0,
      details: [],
    };

    for (const order of openOrders) {
      try {
        const response = await axios.get(
          `${process.env.BASE_URL}/Orders?$filter=DocNum eq ${order.DocNum}`,
          {
            headers: { Cookie: cookies },
          }
        );

        const sapOrder = response.data.value[0];

        const changes = getChangedFields(order, sapOrder);
        const hasChanges = Object.keys(changes).length > 0;

        if (hasChanges) {
          await SalesOrder.updateOne(
            { DocNum: order.DocNum },
            {
              $set: {
                ...sapOrder,
                lastUpdated: new Date(),
                syncedAt: new Date(),
              },
            }
          );

          results.updated++;
          results.details.push({
            docNum: order.DocNum,
            changes,
            success: true,
          });
        } else {
          results.unchanged++;
        }
      } catch (error) {
        console.error(`Failed to check order ${order.DocNum}:`, error.message);
        results.failed++;
        results.details.push({
          docNum: order.DocNum,
          error: error.message,
          success: false,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "Order sync completed",
      results: {
        totalChecked: results.total,
        ordersUpdated: results.updated,
        ordersUnchanged: results.unchanged,
        syncFailed: results.failed,
        details: results.details,
      },
    });
  } catch (error) {
    console.error("Order sync failed:", error);
    res.status(500).json({
      success: false,
      error: "Order sync failed",
      details: error.message,
    });
  }
};

const getChangedFields = (mongoOrder, sapOrder) => {
  const changes = {};
  const fieldsToCompare = [
    // Document Header Fields
    "DocEntry",
    "DocNum",
    "DocType",
    "DocumentStatus",
    "Cancelled",
    "DocDate",
    "DocDueDate",
    "CardCode",
    "CardName",
    "NumAtCard",
    "DocTotal",
    "VatSum",
    "DiscountPercent",
    "Comments",
    "Series",
    "DocCurrency",
    "DocRate",
    "Reference1",
    "Reference2",
    "CreationDate",
    "UpdateDate",
    "SalesPersonCode",
    "TransportationCode",
    "Confirmed",
    "ImportFileNum",
    "PaymentGroupCode",
    "TaxDate",
    "PickStatus",
    "DocumentLines",
    "ShipToCode",
    "Address",
    "Address2",
    "OrderPriority",
    "CancelDate",
    "RequiredDate",
    "ContactPersonCode",
    "TotalDiscount",
    "DownPaymentAmount",
    "DownPaymentPercentage",
    "StartDeliveryDate",
    "EndDeliveryDate",
    "OrderDate",
    "ExtraMonth",
    "ExtraMonth",
    "CashDiscountDateOffset",
    "StartDeliveryTime",
    "EndDeliveryTime",
    "ElectronicProtocols",
    "DocumentsOwner",
    "FolioNumber",
    "DocumentSubType",
    "BaseAmount",
    "VatPercent",
    "ServiceGrossProfitPercent",
    "OpeningRemarks",
    "ClosingRemarks",
    "RoundingDiffAmount",
    "Indicator",
    "PaymentReference",
    "FederalTaxID",
    "GroupNumber",
    "Project",
    "PaymentMethod",
    "PaymentBlock",
    "PaymentBlockEntry",
    "CentralBankIndicator",
    "MaximumCashDiscount",
    "Reserve",
    "ExemptionValidityDateFrom",
    "ExemptionValidityDateTo",
    "WareHouseUpdateType",
    "Rounding",
    "ExternalCorrectedDocNum",
    "InternalCorrectedDocNum",
    "NextCorrectingDocument",
    "DeferredTax",
    "TaxExemptionLetterNum",
    "WTApplied",
    "WTAppliedSC",
    "BillOfExchangeReserved",
    "AgentCode",
    "WTAppliedFC",
    "WTAppliedSys",
    "Period",
    "PeriodIndicator",
    "PayToCode",
    "ManualNumber",
    "UseShpdGoodsAct",
    "IsPayToBank",
    "PayToBankCountry",
    "PayToBankCode",
    "PayToBankAccountNo",
    "PayToBankBranch",
    "BPL_IDAssignedToInvoice",
    "DownPayment",
    "ReserveInvoice",
    "LanguageCode",
    "TrackingNumber",
    "PickRemark",
    "ClosingDate",
    "SequenceCode",
    "SequenceSerial",
    "SeriesString",
    "SubSeriesString",
    "SequenceModel",
    "UseCorrectionVATGroup",
    "TotalDiscount",
    "DownPaymentAmount",
    "DownPaymentPercentage",
    "DownPaymentType",
    "DownPaymentAmountSC",
    "DownPaymentAmountFC",
    "VatPercent",
    "ServiceGrossProfitPercent",
    "OpeningRemarks",
    "ClosingRemarks",
    "RoundingDiffAmount",
    "RoundingDiffAmountFC",
    "RoundingDiffAmountSC",
    "Cancelled",
    "SignatureInputMessage",
    "SignatureDigest",
    "CertificationNumber",
    "PrivateKeyVersion",
    "ControlAccount",
    "InsuranceOperation347",
    "ArchiveNonremovableSalesQuotation",
    "GTSChecker",
    "GTSPayee",
    "ExtraMonth",
    "ExtraDays",
    "CashDiscountDateOffset",
    "StartDeliveryDate",
    "StartDeliveryTime",
    "EndDeliveryDate",
    "EndDeliveryTime",
    "VehiclePlate",
    "ATDocumentType",
    "ElecCommStatus",
    "ElecCommMessage",
    "ReuseDocumentNum",
    "ReuseNotaFiscalNum",
    "PrintSEPADirect",
    "FiscalDocNum",
    "POSDailySummaryNo",
    "POSReceiptNo",
    "PointOfIssueCode",
    "Letter",
    "FolioNumberFrom",
    "FolioNumberTo",
    "InterimType",
    "RelatedType",
    "RelatedEntry",
    "DocumentTaxID",
    "DateOfReportingControlStatementVAT",
    "ClosingOption",
    "SpecifiedClosingDate",
    "OpenForLandedCosts",
    "AuthorizationStatus",
    "BPLID",
    "BPLName",
    "VATRegNum",
    // Document Lines
    "DocumentLines",
  ];

  for (const field of fieldsToCompare) {
    if (JSON.stringify(mongoOrder[field]) !== JSON.stringify(sapOrder[field])) {
      changes[field] = {
        old: mongoOrder[field],
        new: sapOrder[field],
      };
    }
  }
  return changes;
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
