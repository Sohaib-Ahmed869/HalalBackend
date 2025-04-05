const axios = require("axios");
const Payment = require("../models/payment.model");
const multer = require("multer");
const csv = require("csv-parser");
const XLSX = require("xlsx");
const fs = require("fs");
const { getModel } = require("../utils/modelFactory");


const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
});
class PaymentController {
  static async getPayments(req, res) {
    try {
      const Payment = getModel(req.dbConnection, "Payment");
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100;
      const sortField = req.query.sortField || "DocDate";
      const sortOrder = parseInt(req.query.sortOrder) || -1;
      const { startDate, endDate } = req.query;

      const skip = (page - 1) * limit;
      const sort = { [sortField]: sortOrder };
      let query = {};

      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        query.DocDate = {
          $gte: start,
          $lte: end,
        };
      }

      const totalCount = await Payment.countDocuments(query);
      const payments = await Payment.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean();

      res.json({
        data: payments,
        metadata: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalRecords: totalCount,
          limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  }

  static async syncPayments(req, res) {
    try {
      const Payment = getModel(req.dbConnection, "Payment");

      const headers = {
        Cookie: req.headers.cookie,
      };

      let created = 0;
      let skipped = 0;
      let errors = [];
      let totalProcessed = 0;

      const startDate = "2024-11-01";
      const endDate = "2024-11-01";

      let nextLink = `${process.env.BASE_URL}/IncomingPayments?$filter=DocDate ge '${startDate}' and DocDate le '${endDate}'&$orderby=DocDate&$skip=1`;

      while (nextLink) {
        try {
          console.log(`Fetching data from: ${nextLink}`);
          const response = await axios.get(nextLink, { headers });
          const currentBatch = response.data.value;
          console.log(`Processing batch of ${currentBatch.length} payments`);

          for (const payment of currentBatch) {
            try {
              const existingPayment = await Payment.findOne({
                DocEntry: payment.DocEntry,
              });

              if (!existingPayment) {
                const paymentWithTracking = {
                  ...payment,
                  dateStored: new Date(),
                  verified: false,
                };

                await Payment.create(paymentWithTracking);
                created++;
              } else {
                skipped++;
              }
              totalProcessed++;

              if (totalProcessed % 100 === 0) {
                console.log(
                  `Progress: Processed ${totalProcessed} payments. Created: ${created}, Skipped: ${skipped}, Errors: ${errors.length}`
                );
              }
            } catch (error) {
              errors.push({ DocEntry: payment.DocEntry, error: error.message });
              console.error(
                `Error processing payment ${payment.DocEntry}:`,
                error
              );
            }
          }

          nextLink = response.data["odata.nextLink"];
          console.log("Next link:", nextLink);

          if (nextLink && nextLink.startsWith("IncomingPayments")) {
            nextLink = `${process.env.BASE_URL}/${nextLink}`;
          }

          response.data = null;
        } catch (error) {
          console.error("Error in batch processing:", error);
          errors.push({ batch: nextLink, error: error.message });
          break;
        }
      }

      res.json({
        message: "Sync completed for all payments from 2023 onwards",
        stats: {
          period: `${startDate} to ${endDate}`,
          totalProcessed,
          created,
          skipped,
          errors: errors.length,
        },
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Error syncing payments:", error);
      res.status(500).json({ error: "Failed to sync payments" });
    }
  }

  static async getPaymentStats(req, res) {
    try {
      const Payment = getModel(req.dbConnection, "Payment");

      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          error: "Both startDate and endDate are required",
        });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const stats = await Payment.aggregate([
        {
          $match: {
            DocDate: {
              $gte: start,
              $lte: end,
            },
          },
        },
        {
          $facet: {
            paymentMethods: [
              {
                $group: {
                  _id: {
                    hasCash: { $gt: ["$CashSum", 0] },
                    hasCheck: { $gt: ["$CheckSum", 0] },
                    hasTransfer: { $gt: ["$TransferSum", 0] },
                  },
                  count: { $sum: 1 },
                  total: { $sum: "$DocTotal" },
                },
              },
            ],
            dailyTotals: [
              {
                $group: {
                  _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$DocDate" },
                  },
                  total: { $sum: "$DocTotal" },
                  count: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
            customerStats: [
              {
                $group: {
                  _id: "$CardCode",
                  customerName: { $first: "$CardName" },
                  total: { $sum: "$DocTotal" },
                  count: { $sum: 1 },
                },
              },
              { $sort: { total: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ]);

      res.json({
        period: { startDate: start, endDate: end },
        stats: stats[0],
      });
    } catch (error) {
      console.error("Error fetching payment stats:", error);
      res.status(500).json({ error: "Failed to fetch payment statistics" });
    }
  }

  static async toggleVerified(req, res) {
    try {
      const Payment = getModel(req.dbConnection, "Payment");

      const { DocEntry } = req.params;

      const payment = await Payment.findOne({ DocEntry });

      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      payment.verified = !payment.verified;
      await payment.save();

      res.json(payment);
    } catch (error) {
      console.error("Error toggling payment verification:", error);
      res.status(500).json({ error: "Failed to toggle payment verification" });
    }
  }
  static async processCSV(req, res) {
    try {
      const Payment = getModel(req.dbConnection, "Payment");

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const batchSize = 500;
      let processedCount = 0;
      let records = [];
      let totalProcessed = 0;
      let errors = [];
      let rowNumber = 0;

      // Helper function to parse DD/MM/YY date format
      const parseDate = (dateStr) => {
        const [day, month, year] = dateStr.split("/");
        return new Date(`20${year}-${month}-${day}`);
      };

      const processingPromise = new Promise((resolve, reject) => {
        const stream = fs
          .createReadStream(req.file.path, { encoding: "utf16le" })
          .pipe(
            csv({
              skipEmptyLines: true,
              trim: true,
              headers: [
                "#",
                "Creation Date",
                "Customer/Supplier No.",
                "Internal Number",
                "Customer/Supplier Name",
                "Document Number",
                "Posting Date",
                "Cash Amount",
                "Credit Amount",
                "Cheque Amount",
                "Transfer Amount",
                "Document Total",
                "Transaction Number",
                "User Signature",
              ],
              skipLines: 1,
            })
          );

        stream.on("data", async (row) => {
          rowNumber++;
          try {
            const cleanAmount = (amount) => {
              return parseFloat(amount.replace(/[^\d.-]/g, "")) || 0;
            };

            const payment = {
              DocEntry: parseInt(row["Internal Number"]),
              DocNum: parseInt(row["Document Number"]),
              DocDate: parseDate(row["Posting Date"]),
              CardCode: row["Customer/Supplier No."],
              CardName: row["Customer/Supplier Name"],
              CashSum: cleanAmount(row["Cash Amount"]),
              CreditSum: cleanAmount(row["Credit Amount"]),
              TransferSum: cleanAmount(row["Transfer Amount"]),
              CheckSum: cleanAmount(row["Cheque Amount"]),
              DocTotal: cleanAmount(row["Document Total"]),
              CreationDate: parseDate(row["Creation Date"]),
              TransactionNumber: row["Transaction Number"],
              UserSignature: row["User Signature"],
              verified: false,
              dateStored: new Date(),
            };

            records.push(payment);
            processedCount++;

            // Process every 500 records
            if (records.length === batchSize) {
              await saveRecords(records);
              totalProcessed += records.length;
              console.log(`Processed and saved ${totalProcessed} payments`);
              records = []; // Clear the array after saving
            }
          } catch (error) {
            errors.push({
              row: {
                rowNumber,
                data: row,
              },
              error: error.message,
            });
          }
        });

        stream.on("end", async () => {
          try {
            // Save any remaining records
            if (records.length > 0) {
              await saveRecords(records);
              totalProcessed += records.length;
            }

            // Clean up uploaded file
            fs.unlink(req.file.path, (err) => {
              if (err) console.error("Error deleting file:", err);
            });

            resolve({
              totalProcessed,
              errors,
            });
          } catch (error) {
            reject(error);
          }
        });

        stream.on("error", (error) => {
          console.error("Stream error:", error);
          reject(error);
        });
      });

      const result = await processingPromise;

      res.json({
        message: "CSV processing completed",
        stats: {
          totalProcessed: result.totalProcessed,
          errorsCount: result.errors.length,
        },
        errors:
          result.errors.length > 0 ? result.errors.slice(0, 10) : undefined,
      });
    } catch (error) {
      console.error("Error processing CSV:", error);
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Error deleting file:", err);
        });
      }
      res
        .status(500)
        .json({ error: error.message || "Failed to process CSV file" });
    }
  }

  // Helper function to process a batch of payments
  static async processExcel(req, res) {
    try {
      const Payment = getModel(req.dbConnection, "Payment");

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const batchSize = 500;
      let records = [];
      let totalProcessed = 0;
      let errors = [];
      let rowNumber = 0;

      // Helper function to parse date format DD/MM/YY
      const parseDate = (dateStr) => {
        if (!dateStr) return null;

        try {
          // Handle DD/MM/YY format
          if (typeof dateStr === "string" && dateStr.includes("/")) {
            const [day, month, year] = dateStr
              .split("/")
              .map((num) => num.trim());
            // Ensure all components exist
            if (!day || !month || !year) return null;

            // Convert YY to YYYY
            const fullYear = year.length === 2 ? `20${year}` : year;

            // Create date string in ISO format (YYYY-MM-DD)
            const dateString = `${fullYear}-${month.padStart(
              2,
              "0"
            )}-${day.padStart(2, "0")}`;
            const parsed = new Date(dateString);

            // Validate the parsed date
            if (isNaN(parsed.getTime())) return null;
            return parsed;
          }

          // If it's already a Date object
          if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
            return dateStr;
          }

          return null;
        } catch (error) {
          console.error(`Error parsing date ${dateStr}:`, error);
          return null;
        }
      };

      // Helper function to clean amount
      const cleanAmount = (amount) => {
        if (typeof amount === "number") return amount;
        if (!amount) return 0;
        return parseFloat(amount.toString().replace(/[^\d.-]/g, "")) || 0;
      };

      try {
        // Read the Excel file
        const workbook = XLSX.readFile(req.file.path, {
          cellDates: true,
          cellNF: true,
          cellText: false,
        });

        // Assume first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to JSON with raw values
        const rows = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          raw: true,
          dateNF: "dd/mm/yy",
        });

        // Skip header row
        for (let i = 1; i < rows.length; i++) {
          rowNumber = i + 1;
          const row = rows[i];

          try {
            // Ensure we have enough columns

            // Map columns according to the actual data structure
            // [index, CreationDate, CardCode, DocNum, CardName, PostingDate, CashAmount, CreditAmount, ChequeAmount, TransferAmount, DocTotal, TransactionNumber, InternalNumber, UserSignature]
            const docDate = parseDate(row[5]); // Posting Date (index 5)
            const creationDate = parseDate(row[1]); // Creation Date (index 1)

            // Skip row if crucial dates are invalid
            if (!docDate || !creationDate) {
              throw new Error(
                `Invalid dates - DocDate: ${row[5]}, CreationDate: ${row[1]}`
              );
            }

            const payment = {
              DocEntry: 0,
              DocNum: parseInt(row[3]), // Document Number (index 3)
              DocDate: docDate,
              CardCode: row[2], // Customer/Supplier No. (index 2)
              CardName: row[4], // Customer/Supplier Name (index 4)
              CashSum: cleanAmount(row[6]), // Cash Amount (index 6)
              CreditSum: cleanAmount(row[7]), // Credit Amount (index 7)
              TransferSum: cleanAmount(row[9]), // Transfer Amount (index 9)
              CheckSum: cleanAmount(row[8]), // Cheque Amount (index 8)
              DocTotal: cleanAmount(row[10]), // Document Total (index 10)
              CreationDate: creationDate,
              TransactionNumber: row[11]?.toString(), // Transaction Number (index 11)
              UserSignature: 0,
              verified: false,
              dateStored: new Date(),
            };

            records.push(payment);

            // Process in batches
            if (records.length === batchSize) {
              await saveRecords(records);
              totalProcessed += records.length;
              console.log(`Processed and saved ${totalProcessed} payments`);
              records = []; // Clear the array after saving
            }
          } catch (error) {
            errors.push({
              row: {
                rowNumber,
                data: row,
              },
              error: error.message,
            });
          }
        }

        // Save any remaining records
        if (records.length > 0) {
          await saveRecords(records);
          totalProcessed += records.length;
        }

        // Clean up uploaded file
        const fs = require("fs");
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Error deleting file:", err);
        });

        res.json({
          message: "Excel processing completed",
          stats: {
            totalProcessed,
            errorsCount: errors.length,
          },
          errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
        });
      } catch (error) {
        throw new Error(`Error processing Excel file: ${error.message}`);
      }
    } catch (error) {
      console.error("Error processing Excel:", error);
      if (req.file && req.file.path) {
        const fs = require("fs");
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Error deleting file:", err);
        });
      }
      res.status(500).json({
        error: error.message || "Failed to process Excel file",
      });
    }
  }
}
async function saveRecords(records) {
  try {
    const Payment = getModel(req.dbConnection, "Payment");

    for (const record of records) {
      try {
        await Payment.findOneAndUpdate(
          { DocEntry: record.DocEntry },
          { $set: record },
          { upsert: true, new: true }
        );
      } catch (error) {
        console.error(`Error saving payment ${record.DocEntry}:`, error);
        throw error;
      }
    }
  } catch (error) {
    console.error("Error in saveRecords:", error);
    throw error;
  }
}

module.exports = {
  getPayments: PaymentController.getPayments,
  syncPayments: PaymentController.syncPayments,
  getPaymentStats: PaymentController.getPaymentStats,
  toggleVerified: PaymentController.toggleVerified,
  processCSV: PaymentController.processCSV,
  processExcel: PaymentController.processExcel,
  upload: upload,
};
