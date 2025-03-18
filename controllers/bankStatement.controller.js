const BankStatement = require("../models/bankStatement.model");
const XLSX = require("xlsx");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const { parse } = require("ofx-parser");
const axios = require("axios");
const FormData = require("form-data");

/**
 * Bank Statement Processor Module
 * Handles processing of bank statements from various banks and formats
 */
class BankStatementController {
  /**
   * Main method for uploading and processing statements
   */
  static async uploadStatement(req, res) {
    try {
      const buffer = req.file.buffer;
      const fileType = req.file.originalname.split(".").pop().toLowerCase();
      const bankName = req.body.bankName?.trim();

      if (!bankName) {
        return res.status(400).json({ message: "Bank name is required" });
      }

      console.log(`Processing file of type: ${fileType} for bank: ${bankName}`);

      let formattedData = [];

      try {
        if (fileType === "pdf") {
          formattedData = await BankStatementController.processPDF(
            buffer,
            bankName,
            req.file.originalname
          );
        } else if (fileType === "xlsx" || fileType === "xls") {
          formattedData = await BankStatementController.processExcel(
            buffer,
            bankName
          );
        } else if (fileType === "ofx") {
          formattedData = await BankStatementController.processOFX(
            buffer,
            bankName
          );
        } else if (fileType === "csv") {
          formattedData = await BankStatementController.processCSV(
            buffer,
            bankName
          );
        } else {
          return res.status(400).json({ message: "Unsupported file type" });
        }
      } catch (error) {
        console.error(`Error processing ${fileType} file:`, error);
        return res.status(400).json({
          message: `Error processing ${fileType} file: ${error.message}`,
          details: error.stack,
        });
      }

      // Check if any valid transactions exist
      if (!formattedData || formattedData.length === 0) {
        return res.status(400).json({
          message: "No valid transactions found in the file",
        });
      }

      console.log(
        `Prepared ${formattedData.length} transactions for database insertion`
      );

      // Log first and last transaction for debugging
      if (formattedData.length > 0) {
        console.log("First transaction:", JSON.stringify(formattedData[0]));
        console.log(
          "Last transaction:",
          JSON.stringify(formattedData[formattedData.length - 1])
        );
      }

      // Store valid transactions in the database
      const result = await BankStatement.insertMany(formattedData);
      console.log("Transactions inserted successfully", formattedData.length);

      res.status(200).json({
        message: "Bank statement uploaded successfully",
        count: result.length,
      });
    } catch (error) {
      console.error("Upload error:", error.message);
      console.error("Full error:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Process PDF bank statements by sending to Python API
   */
  static async processPDF(buffer, bankName, fileName) {
    try {
      // Create form data for file upload to Python API
      const formData = new FormData();
      formData.append("file", buffer, {
        filename: fileName || "statement.pdf",
        contentType: "application/pdf",
      });

      console.log("Sending PDF to Python API for processing");

      // Send request to Python API
      const response = await axios.post(
        "http://127.0.0.1:5000/process",
        formData,
        {
          headers: {
            ...formData.getHeaders(),
          },
          timeout: 30000, // 30 seconds timeout
        }
      );

      console.log("Received response from Python API");

      if (
        !response.data ||
        !response.data.transactions ||
        !Array.isArray(response.data.transactions)
      ) {
        throw new Error("Invalid response format from Python API");
      }

      // Transform data from Python API format to match our MongoDB model
      return BankStatementController.transformPythonResponseToModel(
        response.data,
        bankName
      );
    } catch (error) {
      console.error("Error communicating with Python API:", error);

      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.error("Python API error response:", error.response.data);
        throw new Error(
          `Python API error: ${error.response.data.error || "Unknown error"}`
        );
      } else if (error.request) {
        // The request was made but no response was received
        throw new Error(
          "Python API did not respond. Make sure the Python server is running on port 5000"
        );
      } else {
        // Something happened in setting up the request
        throw new Error(
          `Error setting up request to Python API: ${error.message}`
        );
      }
    }
  }

  /**
   * Transform Python API response to match our MongoDB model
   */
  static transformPythonResponseToModel(pythonData, bankName) {
    const { transactions, header } = pythonData;

    console.log(
      `Transforming ${transactions.length} transactions from Python API`
    );

    return transactions.map((transaction) => {
      // Parse date from Python response (format: "DD.MM" or "DD.MM.YY")
      // Parse date from Python response (format: "DD.MM" or "DD.MM.YY")
      let operationDate = new Date();
      if (transaction.date) {
        const dateParts = transaction.date.split(".");
        if (dateParts.length >= 2) {
          // Extract statement date from header to get the year
          let year = new Date().getFullYear() - 1; // Default to previous year as fallback

          // Try to extract year from statement date if available
          if (header && header.statement_date) {
            const statementDateMatch = header.statement_date.match(/\d{4}$/);
            if (statementDateMatch) {
              year = parseInt(statementDateMatch[0], 10);
            }
          }

          const month = parseInt(dateParts[1], 10) - 1; // JS months are 0-indexed
          const day = parseInt(dateParts[0], 10);

          // If year is provided in the date (DD.MM.YY or DD.MM.YYYY)
          if (dateParts.length > 2) {
            let transactionYear = parseInt(dateParts[2], 10);
            // Handle 2-digit years
            if (transactionYear < 100) {
              transactionYear =
                transactionYear < 50
                  ? 2000 + transactionYear
                  : 1900 + transactionYear;
            }
            operationDate = new Date(transactionYear, month, day);
          } else {
            // If no year in transaction date, use year from statement date
            operationDate = new Date(year, month, day);
          }
        }
      }

      // Handle effective date (valeur) if present
      let effectiveDate = null;
      if (transaction.valeur) {
        const dateParts = transaction.valeur.split(".");
        if (dateParts.length >= 2) {
          let year = new Date().getFullYear();
          if (dateParts.length > 2) {
            year = parseInt(dateParts[2], 10);
            if (year < 100) {
              year = year < 50 ? 2000 + year : 1900 + year;
            }
          }
          effectiveDate = new Date(
            year,
            parseInt(dateParts[1], 10) - 1,
            parseInt(dateParts[0], 10)
          );
        }
      }

      // Calculate amount (credit is positive, debit is negative)
      let amount = 0;
      if (transaction.credit && transaction.credit.trim() !== "") {
        amount = BankStatementController.parseAmount(transaction.credit);
      } else if (transaction.debit && transaction.debit.trim() !== "") {
        amount = -BankStatementController.parseAmount(transaction.debit);
      }

      // Determine operation type
      const operationType = BankStatementController.determineOperationType(
        transaction.reference || ""
      );

      // Extract beneficiary if possible
      const beneficiary = BankStatementController.extractBeneficiary(
        transaction.reference || ""
      );

      // Return object matching our MongoDB model
      return {
        operationDate,
        operationRef: transaction.reference
          ? transaction.reference.substring(0, 100)
          : "",
        operationType,
        amount,
        comment: transaction.raw || transaction.reference || "",
        detail1: beneficiary || "",
        detail2: transaction.date || "",
        detail3: transaction.valeur || "",
        detail4: header?.account_number || "",
        detail5: header?.statement_date || "",
        bank: bankName,
        uploadDate: new Date(),
        tag: null,
        taggedBy: null,
        taggedAt: null,
        tagNotes: null,
      };
    });
  }

  /**
   * Process Excel bank statements
   */
  static async processExcel(buffer, bankName) {
    try {
      const workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: true, // Parse dates properly
        cellStyles: true, // Keep cell styles
      });

      const firstSheetName = workbook.SheetNames[0];
      const firstSheet = workbook.Sheets[firstSheetName];

      // Check for multiple sheets
      console.log(
        `Excel file contains ${
          workbook.SheetNames.length
        } sheets: ${workbook.SheetNames.join(", ")}`
      );

      // Convert to JSON with all options
      const data = XLSX.utils.sheet_to_json(firstSheet, {
        raw: false,
        dateNF: "yyyy-mm-dd", // Date format
        defval: "", // Default value for empty cells
        blankrows: false, // Skip blank rows
      });

      console.log("Excel data sample:", JSON.stringify(data.slice(0, 2)));

      if (!data || data.length === 0) {
        throw new Error("No data found in Excel file");
      }

      return data.map((row) => {
        // Try to handle different Excel formats by looking for common column names
        const dateCol = BankStatementController.findColumnByNames(row, [
          "Date",
          "DATE",
          "Date d'opération",
          "Transaction Date",
          "Operation Date",
          "Date opération",
          "Date Opération",
          "TRANSACTION DATE",
        ]);

        const refCol = BankStatementController.findColumnByNames(row, [
          "Référence",
          "Reference",
          "ID",
          "Transaction ID",
          "Référence de l'opération",
          "REF",
          "Ref",
          "REFERENCE",
        ]);

        const typeCol = BankStatementController.findColumnByNames(row, [
          "Type",
          "TYPE",
          "Category",
          "Transaction Type",
          "Type de l'opération",
          "Catégorie",
          "CATEGORY",
          "OPERATION TYPE",
        ]);

        const amountCol = BankStatementController.findColumnByNames(row, [
          "Montant",
          "Amount",
          "Sum",
          "Value",
          "AMOUNT",
          "MONTANT",
          "Débit/Crédit",
        ]);

        const debitCol = BankStatementController.findColumnByNames(row, [
          "Débit",
          "Debit",
          "DEBIT",
          "DÉBIT",
          "Sortie",
          "SORTIE",
        ]);

        const creditCol = BankStatementController.findColumnByNames(row, [
          "Crédit",
          "Credit",
          "CREDIT",
          "CRÉDIT",
          "Entrée",
          "ENTRÉE",
        ]);

        const descriptionCol = BankStatementController.findColumnByNames(row, [
          "Description",
          "Libellé",
          "Label",
          "Comment",
          "Commentaire",
          "Details",
          "LIBELLE",
          "DESCRIPTION",
          "LABEL",
          "DETAILS",
          "Intitulé",
          "INTITULE",
        ]);

        const beneficiaryCol = BankStatementController.findColumnByNames(row, [
          "Bénéficiaire",
          "Beneficiary",
          "Payee",
          "BENEFICIARY",
          "BÉNÉFICIAIRE",
          "Destinataire",
          "DESTINATAIRE",
        ]);

        // Extract date and parse it
        let operationDate;
        try {
          if (dateCol && row[dateCol]) {
            // Handle Excel date formats
            if (row[dateCol] instanceof Date) {
              operationDate = row[dateCol];
            } else {
              // Try to parse date string
              operationDate = BankStatementController.parseDate(
                row[dateCol].toString()
              );
            }

            // Fallback for invalid dates
            if (isNaN(operationDate.getTime())) {
              operationDate = new Date();
            }
          } else {
            operationDate = new Date();
          }
        } catch (e) {
          console.warn(`Error parsing Excel date: ${row[dateCol]}`);
          operationDate = new Date();
        }

        // Extract amount
        let amount = 0;

        // If separate debit/credit columns
        if (debitCol && creditCol) {
          const debitStr = row[debitCol]?.toString().replace(",", ".") || "0";
          const creditStr = row[creditCol]?.toString().replace(",", ".") || "0";

          const debitAmount = parseFloat(debitStr);
          const creditAmount = parseFloat(creditStr);

          if (!isNaN(debitAmount) && debitAmount > 0) {
            amount = -debitAmount; // Debit is negative
          } else if (!isNaN(creditAmount) && creditAmount > 0) {
            amount = creditAmount; // Credit is positive
          }
        }
        // If single amount column
        else if (amountCol) {
          const amountStr = row[amountCol]?.toString().replace(",", ".") || "0";
          amount = parseFloat(amountStr);

          // If amount is text with a sign (e.g., "+100.00" or "-50.00")
          if (isNaN(amount)) {
            if (amountStr.startsWith("-")) {
              amount = -parseFloat(amountStr.substring(1));
            } else if (amountStr.startsWith("+")) {
              amount = parseFloat(amountStr.substring(1));
            }
          }

          if (isNaN(amount)) amount = 0;
        }

        // Create transaction object
        return {
          operationDate,
          operationRef: refCol && row[refCol] ? row[refCol].toString() : "",
          operationType:
            typeCol && row[typeCol] ? row[typeCol].toString() : "AUTRE",
          amount,
          comment:
            descriptionCol && row[descriptionCol]
              ? row[descriptionCol].toString()
              : "",
          detail1:
            beneficiaryCol && row[beneficiaryCol]
              ? row[beneficiaryCol].toString()
              : "",
          detail2: "", // Additional details can be added as needed
          detail3: "",
          detail4: "",
          detail5: JSON.stringify(row), // Store full row data as JSON for reference
          bank: bankName,
        };
      });
    } catch (error) {
      console.error("Excel processing error:", error);
      throw new Error(`Excel processing error: ${error.message}`);
    }
  }

  /**
   * Process OFX bank statements
   */
  static async processOFX(buffer, bankName) {
    try {
      const ofxString = buffer.toString("utf8");

      // Match all transactions
      const transactionMatches =
        ofxString.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/g) || [];

      return transactionMatches
        .map((transactionBlock) => {
          const getValue = (tag) => {
            const regex = new RegExp(`<${tag}>(.*?)\n`, "i");
            const match = transactionBlock.match(regex);
            return match ? match[1].trim() : null;
          };

          // Parse amount safely
          const rawAmount = getValue("TRNAMT");
          const amount = rawAmount ? parseFloat(rawAmount) : NaN;

          // Parse operationDate safely
          const rawDate = getValue("DTPOSTED");
          const operationDate = rawDate
            ? new Date(
                rawDate.slice(0, 4), // Year
                parseInt(rawDate.slice(4, 6), 10) - 1, // Month (0-indexed)
                rawDate.slice(6, 8), // Day
                rawDate.length > 8 ? rawDate.slice(8, 10) : 0, // Hour (optional)
                rawDate.length > 10 ? rawDate.slice(10, 12) : 0, // Minute (optional)
                rawDate.length > 12 ? rawDate.slice(12, 14) : 0 // Second (optional)
              )
            : null;

          // Log invalid transactions for debugging
          if (
            isNaN(amount) ||
            !operationDate ||
            operationDate.toString() === "Invalid Date"
          ) {
            console.error(`Invalid OFX transaction: ${transactionBlock}`);
            return null; // Skip invalid transactions
          }

          return {
            operationDate,
            operationRef: getValue("FITID"),
            operationType: getValue("TRNTYPE"),
            amount,
            comment: getValue("MEMO"),
            detail1: getValue("NAME"),
            detail2: getValue("CHECKNUM") || "",
            detail3: getValue("REFNUM") || "",
            detail4: "",
            detail5: transactionBlock, // Store raw transaction data for reference
            bank: bankName,
          };
        })
        .filter((transaction) => transaction !== null); // Remove invalid transactions
    } catch (error) {
      console.error("OFX processing error:", error);
      throw new Error(`OFX processing error: ${error.message}`);
    }
  }

  /**
   * Process CSV bank statements
   */
  static async processCSV(buffer, bankName) {
    try {
      const csvText = buffer.toString("utf8");
      const lines = csvText.split("\n").filter((line) => line.trim());

      if (lines.length <= 1) {
        throw new Error(
          "CSV file appears to be empty or contains only headers"
        );
      }

      // Detect delimiter by counting occurrences in first line
      const delimiters = [",", ";", "\t", "|"];
      let bestDelimiter = ",";
      let maxCount = 0;

      for (const delimiter of delimiters) {
        const count = (lines[0].match(new RegExp(delimiter, "g")) || []).length;
        if (count > maxCount) {
          maxCount = count;
          bestDelimiter = delimiter;
        }
      }

      // Parse headers
      const headers = lines[0]
        .split(bestDelimiter)
        .map((h) => h.trim().replace(/^"(.*)"$/, "$1"));

      // Map common header names to our standardized field names
      const headerMap = {
        date: [
          "date",
          "transaction date",
          "operation date",
          "date operation",
          "date opération",
          "date_operation",
          "valuedate",
          "date valeur",
        ],
        ref: [
          "reference",
          "ref",
          "id",
          "transaction id",
          "operation id",
          "reference_id",
          "ref_id",
        ],
        type: [
          "type",
          "operation type",
          "transaction type",
          "category",
          "type_operation",
          "operation_type",
        ],
        amount: [
          "amount",
          "montant",
          "sum",
          "value",
          "amount_eur",
          "montant_eur",
        ],
        debit: ["debit", "débit", "withdrawal", "expense", "retrait", "sortie"],
        credit: ["credit", "crédit", "deposit", "income", "dépôt", "entrée"],
        description: [
          "description",
          "libellé",
          "label",
          "details",
          "memo",
          "comment",
          "libelle",
          "detail",
          "commentaire",
        ],
        beneficiary: [
          "beneficiary",
          "bénéficiaire",
          "payee",
          "recipient",
          "destinataire",
          "beneficiaire",
        ],
      };

      // Map actual headers to our fields
      const fieldMap = {};
      headers.forEach((header, index) => {
        const headerLower = header.toLowerCase();
        for (const [field, possibleNames] of Object.entries(headerMap)) {
          if (possibleNames.includes(headerLower)) {
            fieldMap[field] = index;
            break;
          }
        }
      });

      // Parse data rows
      return lines
        .slice(1)
        .map((line, lineIndex) => {
          // Handle quoted fields correctly
          const fields = [];
          let inQuotes = false;
          let currentField = "";

          for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"' && (i === 0 || line[i - 1] !== "\\")) {
              inQuotes = !inQuotes;
            } else if (char === bestDelimiter && !inQuotes) {
              fields.push(currentField);
              currentField = "";
            } else {
              currentField += char;
            }
          }

          // Don't forget the last field
          fields.push(currentField);

          // Clean up fields (remove quotes)
          const cleanFields = fields.map((f) =>
            f.trim().replace(/^"(.*)"$/, "$1")
          );

          // Parse date
          let operationDate;
          if (fieldMap.date !== undefined) {
            const dateStr = cleanFields[fieldMap.date];
            operationDate = BankStatementController.parseDate(dateStr);
          } else {
            operationDate = new Date(); // Default to current date if no date column
          }

          // Parse amount
          let amount = 0;

          // If we have separate debit/credit columns
          if (fieldMap.debit !== undefined && fieldMap.credit !== undefined) {
            const debitStr =
              cleanFields[fieldMap.debit]?.replace(",", ".") || "0";
            const creditStr =
              cleanFields[fieldMap.credit]?.replace(",", ".") || "0";

            const debitAmount = parseFloat(debitStr);
            const creditAmount = parseFloat(creditStr);

            if (!isNaN(debitAmount) && debitAmount > 0) {
              amount = -debitAmount; // Make debits negative
            } else if (!isNaN(creditAmount) && creditAmount > 0) {
              amount = creditAmount;
            }
          }
          // If we have a single amount column
          else if (fieldMap.amount !== undefined) {
            const amountStr = cleanFields[fieldMap.amount].replace(",", ".");
            amount = parseFloat(amountStr);

            // Check if the amount string has signs
            if (isNaN(amount)) {
              if (amountStr.startsWith("-")) {
                amount = -parseFloat(amountStr.substring(1));
              } else if (amountStr.startsWith("+")) {
                amount = parseFloat(amountStr.substring(1));
              }
            }

            if (isNaN(amount)) amount = 0;
          }

          // Create transaction object
          return {
            operationDate,
            operationRef:
              fieldMap.ref !== undefined
                ? cleanFields[fieldMap.ref]
                : `CSV_${lineIndex}`,
            operationType:
              fieldMap.type !== undefined
                ? cleanFields[fieldMap.type]
                : "AUTRE",
            amount,
            comment:
              fieldMap.description !== undefined
                ? cleanFields[fieldMap.description]
                : "",
            detail1:
              fieldMap.beneficiary !== undefined
                ? cleanFields[fieldMap.beneficiary]
                : "",
            detail2: "", // Additional fields can be added as needed
            detail3: "",
            detail4: "",
            detail5: line, // Store the original line for reference
            bank: bankName,
          };
        })
        .filter((t) => t.operationDate && !isNaN(t.operationDate.getTime())); // Filter out invalid rows
    } catch (error) {
      console.error("CSV processing error:", error);
      throw new Error(`CSV processing error: ${error.message}`);
    }
  }

  /**
   * Helper method to parse amounts in various formats
   */
  static parseAmount(amountStr) {
    if (!amountStr) return 0;

    // Handle different number formats properly
    // First, remove any spaces or non-essential characters
    let cleanStr = amountStr.replace(/\s+/g, "");

    // European format handling (1.234,56 -> 1234.56)
    if (
      cleanStr.includes(",") &&
      (cleanStr.includes(".") || cleanStr.match(/\d{4,}/))
    ) {
      // If the string has both commas and dots, or has 4+ digits followed by a comma,
      // assume European format (dots as thousands separators, comma as decimal)
      cleanStr = cleanStr.replace(/\./g, "").replace(",", ".");
    } else {
      // Simple case: just replace comma with dot for decimal
      cleanStr = cleanStr.replace(",", ".");
    }

    // Parse the cleaned string
    const amount = parseFloat(cleanStr);

    // Return 0 if parsing failed
    return isNaN(amount) ? 0 : amount;
  }

  /**
   * Determine operation type from transaction description
   */
  static determineOperationType(line) {
    // Convert to lowercase for case-insensitive matching
    const lowercaseLine = line.toLowerCase();

    // Common transaction type mapping
    const typeMap = {
      // Transfers
      virement: "VIREMENT",
      transfer: "VIREMENT",
      "vir recu": "VIREMENT",
      "vir sepa": "VIREMENT",
      "vir instantané": "VIREMENT",
      "vir instant": "VIREMENT",
      "vir émis": "VIREMENT",
      // Card payments
      carte: "CARTE",
      card: "CARTE",
      cb: "CARTE",
      "achat cb": "CARTE",
      "paiement cb": "CARTE",
      "facture cb": "CARTE",
      "remise cb": "CARTE",
      // Direct debits
      prelevement: "PRELEVEMENT",
      "direct debit": "PRELEVEMENT",
      prelevt: "PRELEVEMENT",
      // Commissions and fees
      commission: "COMMISSION",
      frais: "FRAIS",
      fee: "FRAIS",
      cotisation: "FRAIS",
      // Cash operations
      retrait: "RETRAIT",
      withdrawal: "RETRAIT",
      versement: "VERSEMENT",
      deposit: "VERSEMENT",
      // Checks
      cheque: "CHEQUE",
      chèque: "CHEQUE",
      "remise cheque": "CHEQUE",
      // Interest
      interet: "INTERETS",
      interest: "INTERETS",
      // Salary
      salaire: "SALAIRE",
      salary: "SALAIRE",
      paie: "SALAIRE",
      // Taxes
      taxe: "TAXE",
      tax: "TAXE",
      impot: "TAXE",
      impôt: "TAXE",
      // Other common types
      sepa: "SEPA",
      facture: "FACTURE",
      remboursement: "REMBOURSEMENT",
      refund: "REMBOURSEMENT",
      abonnement: "ABONNEMENT",
      subscription: "ABONNEMENT",
    };

    for (const [key, value] of Object.entries(typeMap)) {
      if (lowercaseLine.includes(key)) {
        return value;
      }
    }

    return "AUTRE"; // Default if no match found
  }

  /**
   * Extract beneficiary from transaction line
   */
  static extractBeneficiary(line) {
    // Common patterns for beneficiary information
    const patterns = [
      // French patterns
      /(?:bénéficiaire|beneficiary)[\s:]+([^\s].*?)(?:\s{2,}|$)/i,
      /(?:destinataire|receiver)[\s:]+([^\s].*?)(?:\s{2,}|$)/i,
      /(?:pour|for|to):?\s+([^,\s].*?)(?:\s{2,}|[,]|$)/i,
      /(?:de|from):?\s+([^,\s].*?)(?:\s{2,}|[,]|$)/i,
      // In bank statements, beneficiary often follows standard keywords
      /(?:vir(?:ement)?\s+(?:de|from|to|à|a)\s+)([^,\s].*?)(?:\s{2,}|[,.]|$)/i,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match && match[1] && match[1].trim().length > 2) {
        // Cleanup the matched text to avoid extra info
        return match[1]
          .trim()
          .replace(/\d{2}\/\d{2}\/\d{4}/, "") // Remove dates
          .replace(/\b\d+[,.]\d{2}\b/, "") // Remove amounts
          .replace(/^\s+|\s+$/g, ""); // Trim whitespace
      }
    }

    // If no specific pattern matches, look for typical beneficiary format
    // in multi-line descriptions where the beneficiary is often on its own line
    if (
      line.trim().length > 2 &&
      line.trim().length < 50 &&
      !line.match(/^\d/) && // Doesn't start with a digit
      !line.includes("SEPA") && // Not a SEPA marker
      !line.includes("EUR") && // Not amount information
      !line.includes("Valeur") && // Not date value information
      !line.includes("Référence") && // Not reference information
      !line.includes("Date") && // Not date information
      !line.match(/\d{2}\/\d{2}\/\d{4}/) // Doesn't contain a date
    ) {
      return line.trim();
    }

    return "";
  }

  /**
   * Extract reference from transaction line
   */
  static extractReference(line) {
    const refPatterns = [
      /référence[:\s]+(\w+)/i,
      /reference[:\s]+(\w+)/i,
      /ref[:\s]+(\w+)/i,
      /ref[:\s]+([\w-]+)/i,
      /\bref:?\s*([a-zA-Z0-9]+)/i,
      /\b(?:n°|num|id)(?:\s|:|\.)+([a-zA-Z0-9]+)/i,
      /\b(\d{6,})\b/, // Look for 6+ digit number as a common reference pattern
    ];

    for (const pattern of refPatterns) {
      const match = line.match(pattern);
      if (match) return match[1];
    }

    return "";
  }

  /**
   * Extract value date from transaction line
   */
  static extractValueDate(line) {
    const datePatterns = [
      /valeur[:\s]+([\d\/\.]+)/i,
      /date valeur[:\s]+([\d\/\.]+)/i,
      /value date[:\s]+([\d\/\.]+)/i,
    ];

    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match) return match[1];
    }

    return "";
  }

  /**
   * Helper to find a column by possible names
   */
  static findColumnByNames(row, possibleNames) {
    for (const name of possibleNames) {
      if (row[name] !== undefined) {
        return name;
      }
    }
    return null;
  }

  /**
   * Parse date from various formats
   */
  static parseDate(dateStr) {
    if (!dateStr) return new Date();

    // Normalize the date string
    const normalizedDateStr = dateStr.toString().trim();

    // Try different date formats
    const formats = [
      // DD/MM/YYYY
      {
        regex: /^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/,
        parser: (match) => {
          const day = parseInt(match[1], 10);
          const month = parseInt(match[2], 10) - 1; // JavaScript months are 0-indexed
          const year = parseInt(match[3], 10);
          // Validate parts before creating date
          if (month < 0 || month > 11 || day < 1 || day > 31) {
            return new Date(); // Return current date for invalid dates
          }
          return new Date(year, month, day);
        },
      },
      // YYYY/MM/DD
      {
        regex: /^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/,
        parser: (match) => {
          const year = parseInt(match[1], 10);
          const month = parseInt(match[2], 10) - 1;
          const day = parseInt(match[3], 10);
          if (month < 0 || month > 11 || day < 1 || day > 31) {
            return new Date();
          }
          return new Date(year, month, day);
        },
      },
      // DD-MM-YYYY
      {
        regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
        parser: (match) => {
          const day = parseInt(match[1], 10);
          const month = parseInt(match[2], 10) - 1;
          const year = parseInt(match[3], 10);
          if (month < 0 || month > 11 || day < 1 || day > 31) {
            return new Date();
          }
          return new Date(year, month, day);
        },
      },
      // MM/DD/YYYY (US format)
      {
        regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
        parser: (match) => {
          // For US format, we'll check if the first number is > 12, which would indicate DD/MM format
          const firstNum = parseInt(match[1], 10);
          const secondNum = parseInt(match[2], 10);
          const year = parseInt(match[3], 10);

          let month, day;

          if (firstNum > 12) {
            // This must be DD/MM format
            day = firstNum;
            month = secondNum - 1;
          } else if (secondNum > 12) {
            // This must be MM/DD format
            month = firstNum - 1;
            day = secondNum;
          } else {
            // Ambiguous, default to DD/MM for European contexts
            day = firstNum;
            month = secondNum - 1;
          }

          if (month < 0 || month > 11 || day < 1 || day > 31) {
            return new Date();
          }
          return new Date(year, month, day);
        },
      },
      // Special format for short dates (DD/MM or MM/DD)
      {
        regex: /^(\d{1,2})[\/\.](\d{1,2})$/,
        parser: (match) => {
          const firstNum = parseInt(match[1], 10);
          const secondNum = parseInt(match[2], 10);
          const currentYear = new Date().getFullYear();

          let month, day;

          if (firstNum > 12) {
            // This must be DD/MM format
            day = firstNum;
            month = secondNum - 1;
          } else if (secondNum > 12) {
            // This must be MM/DD format
            month = firstNum - 1;
            day = secondNum;
          } else {
            // Ambiguous, default to DD/MM for European contexts
            day = firstNum;
            month = secondNum - 1;
          }

          if (month < 0 || month > 11 || day < 1 || day > 31) {
            return new Date();
          }
          return new Date(currentYear, month, day);
        },
      },
    ];

    for (const format of formats) {
      const match = normalizedDateStr.match(format.regex);
      if (match) {
        const date = format.parser(match);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    try {
      // If all else fails, try the JavaScript Date parser
      const date = new Date(normalizedDateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }
    } catch (e) {
      console.warn(`Error parsing date string: ${normalizedDateStr}`);
    }

    // Return current date as fallback
    return new Date();
  }

  // Methods for retrieving and working with statements
  static async getStatements(req, res) {
    try {
      const {
        startDate,
        endDate,
        bank,
        tag,
        search,
        limit = 100,
        skip = 0,
      } = req.query;
      const query = {};

      if (startDate || endDate) {
        query.operationDate = {};
        if (startDate) query.operationDate.$gte = new Date(startDate);
        if (endDate) query.operationDate.$lte = new Date(endDate);
      }

      if (bank) {
        query.bank = bank;
      }

      if (tag) {
        query.tag = tag;
      }

      if (search) {
        // Text search across multiple fields
        query.$or = [
          { comment: { $regex: search, $options: "i" } },
          { detail1: { $regex: search, $options: "i" } },
          { operationRef: { $regex: search, $options: "i" } },
          { operationType: { $regex: search, $options: "i" } },
        ];
      }

      // Count total before applying pagination
      const total = await BankStatement.countDocuments(query);

      const statements = await BankStatement.find(query)
        .sort({ operationDate: -1 })
        .skip(parseInt(skip, 10))
        .limit(parseInt(limit, 10));

      res.json({
        statements,
        pagination: {
          total,
          limit: parseInt(limit, 10),
          skip: parseInt(skip, 10),
          pages: Math.ceil(total / parseInt(limit, 10)),
        },
      });
    } catch (error) {
      console.error("Error fetching statements:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Tag a statement with a category
   */
  static async tagStatement(req, res) {
    try {
      const { statementId } = req.params;
      const { tag, notes } = req.body;

      if (
        !["sales", "expense", "transfer", "tax", "other", null].includes(tag)
      ) {
        return res.status(400).json({ error: "Invalid tag value" });
      }

      const statement = await BankStatement.findByIdAndUpdate(
        statementId,
        {
          tag,
          tagNotes: notes,
          taggedAt: tag ? new Date() : null,
          taggedBy: req.user?.username || "system", // Assuming you have user info in req
        },
        { new: true }
      );

      if (!statement) {
        return res.status(404).json({ error: "Statement not found" });
      }

      res.json(statement);
    } catch (error) {
      console.error("Error tagging statement:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get statements by tag with summary
   */
  static async getStatementsByTag(req, res) {
    try {
      const { tag, startDate, endDate, bank } = req.query;
      const query = { tag };

      if (startDate || endDate) {
        query.operationDate = {};
        if (startDate) query.operationDate.$gte = new Date(startDate);
        if (endDate) query.operationDate.$lte = new Date(endDate);
      }

      if (bank) {
        query.bank = bank;
      }

      const statements = await BankStatement.find(query).sort({
        operationDate: -1,
      });

      const total = await BankStatement.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
          },
        },
      ]);

      res.json({
        statements,
        total: total[0]?.total || 0,
        count: statements.length,
      });
    } catch (error) {
      console.error("Error fetching statements by tag:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get statistics by tag
   */
  static async getTagStats(req, res) {
    try {
      const { startDate, endDate, bank } = req.query;
      const dateMatch = {};

      if (startDate || endDate) {
        dateMatch.operationDate = {};
        if (startDate) dateMatch.operationDate.$gte = new Date(startDate);
        if (endDate) dateMatch.operationDate.$lte = new Date(endDate);
      }

      if (bank) {
        dateMatch.bank = bank;
      }

      const stats = await BankStatement.aggregate([
        { $match: dateMatch },
        {
          $group: {
            _id: "$tag",
            count: { $sum: 1 },
            total: { $sum: "$amount" },
            transactions: { $push: "$ROOT" },
          },
        },
        {
          $project: {
            tag: "$_id",
            count: 1,
            total: 1,
            sampleTransactions: { $slice: ["$transactions", 5] },
          },
        },
        { $sort: { total: -1 } },
      ]);

      // Calculate summary statistics
      const summary = {
        totalTransactions: 0,
        totalAmount: 0,
        income: 0,
        expenses: 0,
        taggedCount: 0,
        untaggedCount: 0,
      };

      stats.forEach((stat) => {
        summary.totalTransactions += stat.count;
        summary.totalAmount += stat.total;

        if (stat.total > 0) {
          summary.income += stat.total;
        } else {
          summary.expenses += Math.abs(stat.total);
        }

        if (stat.tag) {
          summary.taggedCount += stat.count;
        } else {
          summary.untaggedCount += stat.count;
        }
      });

      res.json({
        stats: stats.map((stat) => ({
          ...stat,
          tag: stat.tag || "untagged",
        })),
        summary,
      });
    } catch (error) {
      console.error("Error getting tag stats:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get monthly summary of transactions
   */
  static async getMonthlySummary(req, res) {
    try {
      const { year, bank } = req.query;

      // Default to current year if not specified
      const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

      const query = {
        operationDate: {
          $gte: new Date(targetYear, 0, 1), // January 1st
          $lt: new Date(targetYear + 1, 0, 1), // January 1st of next year
        },
      };

      if (bank) {
        query.bank = bank;
      }

      const monthlyData = await BankStatement.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              month: { $month: "$operationDate" },
              tag: "$tag",
            },
            count: { $sum: 1 },
            total: { $sum: "$amount" },
          },
        },
        {
          $group: {
            _id: "$_id.month",
            categories: {
              $push: {
                tag: "$_id.tag",
                count: "$count",
                total: "$total",
              },
            },
            totalAmount: { $sum: "$total" },
            totalCount: { $sum: "$count" },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      // Transform to more usable format with month names
      const months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];

      const formattedResults = monthlyData.map((month) => ({
        month: months[month._id - 1],
        monthNum: month._id,
        totalAmount: month.totalAmount,
        totalCount: month.totalCount,
        categories: month.categories.map((cat) => ({
          tag: cat.tag || "untagged",
          count: cat.count,
          total: cat.total,
        })),
      }));

      res.json({
        year: targetYear,
        summary: formattedResults,
      });
    } catch (error) {
      console.error("Error getting monthly summary:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get list of all available banks in the database
   */
  static async getBanks(req, res) {
    try {
      const banks = await BankStatement.distinct("bank");

      const bankStats = await Promise.all(
        banks.map(async (bank) => {
          const count = await BankStatement.countDocuments({ bank });
          const oldestTransaction = await BankStatement.findOne({ bank })
            .sort({ operationDate: 1 })
            .select("operationDate");
          const newestTransaction = await BankStatement.findOne({ bank })
            .sort({ operationDate: -1 })
            .select("operationDate");
          return {
            name: bank,
            transactionCount: count,
            oldestDate: oldestTransaction?.operationDate,
            newestDate: newestTransaction?.operationDate,
          };
        })
      );

      res.json({
        banks: bankStats,
      });
    } catch (error) {
      console.error("Error getting banks:", error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = BankStatementController;
