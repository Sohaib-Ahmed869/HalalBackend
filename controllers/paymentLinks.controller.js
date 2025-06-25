// controllers/paymentController.js
const XLSX = require("xlsx");
const PaymentLink = require("../models/paymentLinks.model");
const { getModel } = require("../utils/modelFactory");

exports.uploadPayments = async (req, res) => {
  try {
    const startTime = Date.now();
    const PaymentLink = getModel(req.dbConnection, "PaymentLink");

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("Starting payment links Excel import...");

    // Read the Excel file with optimized settings
    const workbook = XLSX.read(req.file.buffer, {
      type: "buffer",
      cellDates: true,
      cellNF: true,
      cellStyles: false, // Disable styles for better performance
    });

    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet, {
      defval: "", // Default value for empty cells
      blankrows: false, // Skip blank rows
    });

    console.log(`Parsed ${data.length} rows from Excel`);

    // Helper function to parse dates with 2-digit year conversion
    const parseDate = (dateValue) => {
      if (!dateValue) return null;

      // If it's already a Date object (from Excel)
      if (dateValue instanceof Date && !isNaN(dateValue)) {
        return dateValue;
      }

      // If it's a string, handle the /23, /24, /25 format
      if (typeof dateValue === "string") {
        // Handle formats like "DD/MM/YY" where YY needs to be converted to 20YY
        const dateStr = dateValue.trim();

        // Match patterns like "15/08/23" or "15/8/23"
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

          if (!isNaN(parsedDate)) {
            return parsedDate;
          }
        }

        // Try standard date parsing as fallback
        const fallbackDate = new Date(dateStr);
        if (!isNaN(fallbackDate)) {
          return fallbackDate;
        }
      }

      // If it's a number (Excel serial date)
      if (typeof dateValue === "number") {
        try {
          return new Date((dateValue - 25569) * 86400 * 1000);
        } catch (error) {
          console.warn("Failed to parse Excel serial date:", dateValue);
        }
      }

      return null;
    };

    // Pre-process and validate data in memory first
    const validPaymentLinks = [];
    let errorCount = 0;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      try {
        // Parse and validate numeric fields
        const paymentNumber = parseInt(row.PAYMENTNO);
        const invoiceNumber = parseInt(row.INVOICENO);
        const paymentAmount = parseFloat(row.PAIDAMT);
        const invoiceAmount = parseFloat(row.INVAMT);

        // Parse dates with 2-digit year handling
        const paymentDate = parseDate(row.PAYDATE);
        const invoiceDate = parseDate(row.INVDATE);

        // Enhanced validation with detailed checking
        const validations = {
          paymentNumber: !isNaN(paymentNumber) && paymentNumber > 0,
          invoiceNumber: !isNaN(invoiceNumber) && invoiceNumber > 0,
          paymentAmount: !isNaN(paymentAmount), // Allow negative amounts (refunds/adjustments)
          invoiceAmount: !isNaN(invoiceAmount), // Allow negative amounts (credit notes)
          paymentDate: paymentDate && !isNaN(paymentDate),
          invoiceDate: invoiceDate && !isNaN(invoiceDate),
        };

        const isValid = Object.values(validations).every((v) => v === true);

        if (isValid) {
          validPaymentLinks.push({
            paymentNumber,
            invoiceNumber,
            paymentAmount,
            invoiceAmount,
            paymentDate,
            invoiceDate,
          });
        } else {
          // Detailed error logging
          const failedFields = Object.entries(validations)
            .filter(([key, valid]) => !valid)
            .map(([key]) => key);

          console.warn(
            `Invalid data in row ${i + 1} - Failed fields: ${failedFields.join(
              ", "
            )}:`,
            {
              paymentNo: row.PAYMENTNO,
              invoiceNo: row.INVOICENO,
              paidAmt: row.PAIDAMT,
              invAmt: row.INVAMT,
              paymentDate: row.PAYDATE,
              invoiceDate: row.INVDATE,
              parsedPaymentAmount: paymentAmount,
              parsedInvoiceAmount: invoiceAmount,
              parsedPaymentDate: paymentDate,
              parsedInvoiceDate: invoiceDate,
            }
          );
          errorCount++;
        }
      } catch (error) {
        console.error(`Error processing row ${i + 1}:`, error.message);
        errorCount++;
      }
    }

    console.log(
      `Validated ${validPaymentLinks.length} payment links, ${errorCount} errors`
    );

    // Check for existing payment links to avoid duplicates
    const paymentNumbers = validPaymentLinks.map((p) => p.paymentNumber);
    const existingPayments = await PaymentLink.find(
      { paymentNumber: { $in: paymentNumbers } },
      { paymentNumber: 1 }
    ).lean();

    const existingPaymentNumbers = new Set(
      existingPayments.map((p) => p.paymentNumber)
    );

    // Filter out existing payment links
    const newPaymentLinks = validPaymentLinks.filter(
      (p) => !existingPaymentNumbers.has(p.paymentNumber)
    );

    console.log(
      `Found ${existingPaymentNumbers.size} existing payments, ${newPaymentLinks.length} new payments to insert`
    );

    // Bulk insert new payment links
    let insertedCount = 0;
    if (newPaymentLinks.length > 0) {
      try {
        const result = await PaymentLink.insertMany(newPaymentLinks, {
          ordered: false, // Continue on error
          lean: true,
        });
        insertedCount = result.length;
        console.log(`Successfully inserted ${insertedCount} payment links`);
      } catch (error) {
        // Handle partial success
        if (error.writeErrors) {
          insertedCount = newPaymentLinks.length - error.writeErrors.length;
          console.log(
            `Partial success: ${insertedCount} inserted, ${error.writeErrors.length} failed`
          );
        } else {
          throw error;
        }
      }
    }

    const endTime = Date.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);

    res.status(200).json({
      success: true,
      message: "Payment links file processed successfully",
      data: {
        totalRowsProcessed: data.length,
        validRecords: validPaymentLinks.length,
        existingPayments: existingPaymentNumbers.size,
        newPaymentsInserted: insertedCount,
        skippedDuplicates: existingPaymentNumbers.size,
        errorCount,
        processingTimeSeconds: processingTime,
      },
    });
  } catch (error) {
    console.error("Error processing payment links file:", error);
    res.status(500).json({
      success: false,
      error: "Error processing payment links file",
      details: error.message,
    });
  }
};
