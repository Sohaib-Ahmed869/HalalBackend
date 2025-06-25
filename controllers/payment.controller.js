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
      const startTime = Date.now();
      const Payment = getModel(req.dbConnection, "Payment");

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log("Starting payment Excel import...");

      // Helper function to parse date format DD/MM/YY with improved performance
      const parseDate = (dateValue) => {
        if (!dateValue) return null;

        try {
          // If it's already a Date object (from Excel)
          if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
            return dateValue;
          }

          // Handle DD/MM/YY string format
          if (typeof dateValue === "string") {
            const dateStr = dateValue.trim();

            // Match DD/MM/YY or D/M/YY patterns
            const shortYearPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/;
            const match = dateStr.match(shortYearPattern);

            if (match) {
              const [, day, month, shortYear] = match;
              const fullYear = 2000 + parseInt(shortYear); // Convert 23 -> 2023

              // Create date in YYYY-MM-DD format to avoid timezone issues
              const paddedMonth = month.padStart(2, "0");
              const paddedDay = day.padStart(2, "0");
              const parsedDate = new Date(
                `${fullYear}-${paddedMonth}-${paddedDay}`
              );

              if (!isNaN(parsedDate.getTime())) {
                return parsedDate;
              }
            }

            // Try standard date parsing as fallback
            const fallbackDate = new Date(dateStr);
            if (!isNaN(fallbackDate.getTime())) {
              return fallbackDate;
            }
          }

          // Handle Excel serial dates
          if (typeof dateValue === "number") {
            const parsedDate = new Date((dateValue - 25569) * 86400 * 1000);
            if (!isNaN(parsedDate.getTime())) {
              return parsedDate;
            }
          }

          return null;
        } catch (error) {
          console.warn(`Error parsing date ${dateValue}:`, error.message);
          return null;
        }
      };

      // Helper function to clean amount (optimized)
      const cleanAmount = (amount) => {
        if (typeof amount === "number" && !isNaN(amount)) return amount;
        if (!amount) return 0;

        const cleaned = parseFloat(amount.toString().replace(/[^\d.-]/g, ""));
        return isNaN(cleaned) ? 0 : cleaned;
      };

      // Read the Excel file with optimized settings
      let workbook;
      if (req.file.buffer) {
        // Memory storage - read from buffer
        workbook = XLSX.read(req.file.buffer, {
          type: "buffer",
          cellDates: true,
          cellNF: true,
          cellStyles: false, // Disable for performance
          sheetStubs: false, // Skip empty cells
        });
      } else if (req.file.path) {
        // Disk storage - read from file path
        const fs = require("fs");
        workbook = XLSX.readFile(req.file.path, {
          cellDates: true,
          cellNF: true,
          cellStyles: false, // Disable for performance
          sheetStubs: false, // Skip empty cells
        });
      } else {
        throw new Error("No file buffer or path available");
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Convert to JSON with optimized settings
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: false, // Get formatted values
        defval: "", // Default for empty cells
        blankrows: false, // Skip blank rows
      });

      console.log(`Parsed ${rows.length - 1} data rows from Excel`);

      // Pre-process and validate all data in memory first
      const validPayments = [];
      const errors = [];
      const currentDate = new Date();

      // Skip header row and process data
      for (let i = 1; i < rows.length; i++) {
        const rowNumber = i + 1;
        const row = rows[i];

        try {
          // Skip completely empty rows
          if (!row || row.every((cell) => !cell)) {
            continue;
          }

          // Parse dates with validation
          const docDate = parseDate(row[5]); // Posting Date
          const creationDate = parseDate(row[1]); // Creation Date

          // Validate required fields
          const docNum = parseInt(row[3]);
          const cardCode = row[2]?.toString().trim();
          const cardName = row[4]?.toString().trim();

          // Enhanced validation
          if (!docDate || !creationDate) {
            throw new Error(
              `Invalid dates - DocDate: '${row[5]}', CreationDate: '${row[1]}'`
            );
          }

          if (!docNum || isNaN(docNum) || docNum <= 0) {
            throw new Error(`Invalid DocNum: '${row[3]}'`);
          }

          if (!cardCode) {
            throw new Error(`Missing CardCode`);
          }

          if (!cardName) {
            throw new Error(`Missing CardName`);
          }

          // Create payment object
          const payment = {
            DocEntry: docNum, // Use DocNum as DocEntry since it should be unique
            DocNum: docNum,
            DocDate: docDate,
            CardCode: cardCode,
            CardName: cardName,
            CashSum: cleanAmount(row[6]),
            CreditSum: cleanAmount(row[7]), // Note: Schema doesn't have CreditSum field
            TransferSum: cleanAmount(row[9]),
            CheckSum: cleanAmount(row[8]), // Note: Schema doesn't have CheckSum field
            DocTotal: cleanAmount(row[10]), // Note: Schema doesn't have DocTotal field
            CreationDate: creationDate, // Note: Schema doesn't have CreationDate field
            TransactionNumber: row[11]?.toString() || null,
            UserSignature: 0, // Note: Schema doesn't have UserSignature field
            verified: false,
            dateStored: currentDate,
          };

          validPayments.push(payment);
        } catch (error) {
          errors.push({
            row: rowNumber,
            data: row.slice(0, 15), // Limit data size in error log
            error: error.message,
          });
        }
      }

      console.log(
        `Validated ${validPayments.length} payments, ${errors.length} errors`
      );

      // Check for existing payments with optimized query
      console.log("Checking for existing payments...");
      const docEntries = validPayments.map((p) => p.DocEntry);

      // Check by DocEntry since that's the unique field
      const existingPayments = await Payment.find(
        { DocEntry: { $in: docEntries } },
        { DocEntry: 1, _id: 0 } // Exclude _id for better performance
      ).lean();

      const existingDocEntries = new Set(
        existingPayments.map((p) => p.DocEntry)
      );

      // Filter out existing payments
      const newPayments = validPayments.filter(
        (p) => !existingDocEntries.has(p.DocEntry)
      );

      console.log(
        `Found ${existingDocEntries.size} existing payments, ${newPayments.length} new payments to insert`
      );

      // High-performance batch insert with smaller chunks
      let insertedCount = 0;
      let duplicateCount = existingDocEntries.size;
      let insertErrors = 0;

      if (newPayments.length > 0) {
        const batchSize = 1000; // Even smaller batches for debugging
        const totalBatches = Math.ceil(newPayments.length / batchSize);

        console.log(
          `Processing ${newPayments.length} payments in ${totalBatches} batches of ${batchSize}`
        );

        // Test with first record to identify schema issues
        console.log(
          "Testing first record structure:",
          JSON.stringify(newPayments[0], null, 2)
        );

        for (let i = 0; i < newPayments.length; i += batchSize) {
          const batch = newPayments.slice(i, i + batchSize);
          const batchNumber = Math.floor(i / batchSize) + 1;

          try {
            const startBatch = Date.now();
            const result = await Payment.insertMany(batch, {
              ordered: false,
              lean: true,
              writeConcern: { w: 1, j: false }, // Faster write concern
            });

            insertedCount += result.length;
            const batchTime = ((Date.now() - startBatch) / 1000).toFixed(1);

            console.log(
              `Batch ${batchNumber}/${totalBatches}: ${result.length} inserted in ${batchTime}s (Total: ${insertedCount})`
            );
          } catch (error) {
            if (error.writeErrors) {
              const batchInserted = batch.length - error.writeErrors.length;
              insertedCount += batchInserted;
              insertErrors += error.writeErrors.length;

              // Log detailed error info for first few errors
              if (batchNumber <= 3) {
                console.error(`Batch ${batchNumber} errors (first 3):`);
                error.writeErrors.slice(0, 3).forEach((writeError, idx) => {
                  console.error(`Error ${idx + 1}:`, writeError.errmsg);
                  console.error(
                    `Failed record:`,
                    JSON.stringify(batch[writeError.index], null, 2)
                  );
                });
              }

              console.log(
                `Batch ${batchNumber}/${totalBatches}: ${batchInserted} inserted, ${error.writeErrors.length} errors`
              );
            } else {
              console.error(
                `Batch ${batchNumber} failed completely:`,
                error.message
              );

              // Try single record insert to identify specific issue
              if (batchNumber === 1) {
                console.log(
                  "Attempting single record insert to diagnose issue..."
                );
                try {
                  const singleResult = await Payment.create(batch[0]);
                  console.log("Single insert successful:", singleResult._id);
                } catch (singleError) {
                  console.error("Single insert failed:", singleError.message);
                  console.error(
                    "Record that failed:",
                    JSON.stringify(batch[0], null, 2)
                  );
                }
              }

              insertErrors += batch.length;
            }
          }

          // Break early if first few batches all fail
          if (batchNumber === 3 && insertedCount === 0) {
            console.error(
              "First 3 batches failed completely. Stopping to prevent further issues."
            );
            console.error(
              "Please check the data structure and schema validation."
            );
            break;
          }
        }
      }

      // Clean up uploaded file (only if file was stored on disk)
      if (req.file.path) {
        const fs = require("fs");
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Error deleting file:", err);
        });
      }

      const endTime = Date.now();
      const processingTime = ((endTime - startTime) / 1000).toFixed(2);

      res.json({
        success: true,
        message: "Payment Excel import completed",
        data: {
          totalRowsProcessed: rows.length - 1, // Exclude header
          validRecords: validPayments.length,
          existingPayments: duplicateCount,
          newPaymentsInserted: insertedCount,
          skippedDuplicates: duplicateCount,
          validationErrors: errors.length,
          insertErrors: insertErrors,
          processingTimeSeconds: processingTime,
          summary: {
            successRate: `${(
              (insertedCount / validPayments.length) *
              100
            ).toFixed(1)}%`,
            duplicateRate: `${(
              (duplicateCount / validPayments.length) *
              100
            ).toFixed(1)}%`,
            errorRate: `${((errors.length / (rows.length - 1)) * 100).toFixed(
              1
            )}%`,
          },
        },
        // Include error samples if present
        ...(errors.length > 0 &&
          errors.length <= 10 && {
            errorDetails: errors,
          }),
        ...(errors.length > 10 && {
          errorSample: errors.slice(0, 5),
          totalErrors: errors.length,
          note: "Showing first 5 errors. Check server logs for complete error list.",
        }),
      });
    } catch (error) {
      console.error("Error processing Excel:", error);

      // Clean up file on error
      if (req.file && req.file.path) {
        const fs = require("fs");
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Error deleting file:", err);
        });
      }

      res.status(500).json({
        success: false,
        error: "Error processing Excel file",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
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
