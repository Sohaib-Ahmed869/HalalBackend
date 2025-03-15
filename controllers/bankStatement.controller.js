const BankStatement = require("../models/bankStatement.model");
const XLSX = require("xlsx");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const { parse } = require("ofx-parser");

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
            bankName
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
      console.log("Transactions inserted successfully", result);

      res.status(200).json({
        message: "Bank statement uploaded successfully",
        count: 10,
      });
    } catch (error) {
      console.error("Upload error:", error.message);
      console.error("Full error:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Process PDF bank statements
   */
  static async processPDF(buffer, bankName) {
    try {
      const pdfData = await pdfParse(buffer);
      console.log("Raw PDF text length:", pdfData.text.length);

      let transactions = [];

      if (pdfData.text.includes("BRED Banque Populaire")) {
        console.log("Detected BRED bank statement");
        transactions =
          await BankStatementController.extractTransactionsFromBREDPDF(
            pdfData.text
          );
      } else if (pdfData.text.includes("Société Générale")) {
        console.log("Detected Société Générale bank statement");
        transactions =
          await BankStatementController.extractTransactionsFromSGPDF(
            pdfData.text
          );
      } else {
        console.log("Using generic PDF transaction extraction");
        transactions =
          await BankStatementController.extractTransactionsFromGenericPDF(
            pdfData.text
          );
      }

      return transactions.map((t) => {
        let operationDate = BankStatementController.parseDate(t.date);
        let amount = BankStatementController.parseAmount(t.amount);
        if (t.debit > 0) amount = -t.debit;
        if (t.credit > 0) amount = t.credit;

        return {
          operationDate,
          operationRef: t.reference || "",
          operationType: t.type || "AUTRE",
          amount,
          comment: t.description || "",
          bank: bankName,
        };
      });
    } catch (error) {
      console.error("PDF processing error:", error);
      throw new Error(`PDF processing error: ${error.message}`);
    }
  }

  /**
   * Extract transactions from BRED bank PDF statement
   */
  /**
   * Properly extract transactions from BRED bank PDF statement
   */
  static async extractTransactionsFromBREDPDF(text) {
    const transactions = [];
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    let currentTransaction = null;
    let currentDescription = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const dateMatch = line.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      const amountMatch = line.match(/([\d\s]+[,.]\d{2})/g);

      if (dateMatch) {
        if (currentTransaction) {
          currentTransaction.description = currentDescription.join(" ").trim();
          transactions.push(currentTransaction);
        }

        currentTransaction = {
          date: `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`,
          type: "AUTRE",
          amount: 0,
          description: "",
        };
        currentDescription = [line];
      } else if (currentTransaction) {
        currentDescription.push(line);
        if (amountMatch) {
          let amount = BankStatementController.parseAmount(amountMatch[0]);
          if (
            line.toLowerCase().includes("debit") ||
            line.toLowerCase().includes("prélèvement")
          ) {
            currentTransaction.amount = -amount;
          } else {
            currentTransaction.amount = amount;
          }
        }
      }
    }
    if (currentTransaction) {
      currentTransaction.description = currentDescription.join(" ").trim();
      transactions.push(currentTransaction);
    }
    return transactions;
  }

  /**
   * Parses amounts correctly, handling European format (1.234,56 -> 1234.56)
   */
  static parseAmount(amountStr) {
    if (!amountStr) return 0;
    let cleanStr = amountStr
      .replace(/\s+/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    return parseFloat(cleanStr) || 0;
  }

  /**
   * Parses dates from various formats
   */
  static parseDate(dateStr) {
    if (!dateStr) return new Date();
    const match = dateStr.match(/(\d{2})[\.\/-](\d{2})[\.\/-](\d{4})/);
    return match ? new Date(`${match[3]}-${match[2]}-${match[1]}`) : new Date();
  }
  /**
   * Extract transactions from Société Générale PDF statement
   */
  static async extractTransactionsFromSGPDF(text) {
    const transactions = [];
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    console.log("Sample of Société Générale PDF text lines:");
    lines
      .slice(0, 10)
      .forEach((line, idx) => console.log(`Line ${idx}: ${line}`));

    let inTransactionSection = false;
    let currentTransaction = null;
    let descriptionLines = [];

    // Find the start of the RELEVÉ DES OPÉRATIONS section
    let transactionSectionStart = lines.findIndex((line) =>
      line.includes("RELEVÉ DES OPÉRATIONS")
    );

    if (transactionSectionStart === -1) {
      // Alternative: look for "Date Valeur Nature de l'opération"
      transactionSectionStart = lines.findIndex((line) =>
        line.match(/Date\s+Valeur\s+Nature de l'opération/)
      );
    }

    if (transactionSectionStart !== -1) {
      console.log(
        `Found SG transactions section at line ${transactionSectionStart}`
      );
      // Skip the header lines
      transactionSectionStart += 2;
    } else {
      console.log(
        "Could not identify SG transaction section, processing all lines"
      );
      transactionSectionStart = 0;
    }

    for (let i = transactionSectionStart; i < lines.length; i++) {
      const line = lines[i];

      // Check for end of transactions section
      if (
        line.includes("TOTAUX DES MOUVEMENTS") ||
        line.includes("NOUVEAU SOLDE")
      ) {
        if (currentTransaction) {
          currentTransaction.description = descriptionLines.join(" ").trim();
          transactions.push(currentTransaction);
          currentTransaction = null;
          descriptionLines = [];
        }
        break;
      }

      // For SG, transactions often start with a date in DD/MM/YYYY format
      const dateMatch = line.match(/^(\d{2})\/(\d{2})\/(\d{4})/);

      if (dateMatch && i < lines.length - 1) {
        // Save the previous transaction if exists
        if (currentTransaction) {
          currentTransaction.description = descriptionLines.join(" ").trim();
          transactions.push(currentTransaction);
          descriptionLines = [];
        }

        const day = dateMatch[1];
        const month = dateMatch[2];
        const year = dateMatch[3];

        // Get the rest of the line (after the date) as description
        const descriptionStart =
          line.indexOf(dateMatch[0]) + dateMatch[0].length;
        let description = line.substring(descriptionStart).trim();

        // Process next line which should contain either "Débit" or "Crédit" amount
        const nextLine = lines[i + 1].trim();
        let debit = 0;
        let credit = 0;

        // Look for amount which is usually in format like "1.234,56" or "1 234,56"
        const amountMatch = nextLine.match(/(\d{1,3}(?:[\s\.]\d{3})*,\d{2})/);

        if (amountMatch) {
          const amount = BankStatementController.parseAmount(amountMatch[1]);

          // Determine if debit or credit based on the line content
          if (
            nextLine.includes("VIR INSTANTANE EMIS") ||
            nextLine.includes("VIR EUROPEEN EMIS") ||
            nextLine.includes("PRELEVEMENT") ||
            nextLine.includes("CARTE") ||
            nextLine.includes("FRAIS") ||
            nextLine.includes("COMMISSION")
          ) {
            debit = amount;
          } else {
            credit = amount;
          }

          // Add the rest of the next line to description
          const nextLineDescStart =
            nextLine.indexOf(amountMatch[1]) + amountMatch[1].length;
          description += " " + nextLine.substring(nextLineDescStart).trim();

          // Skip the next line as we've already processed it
          i++;
        }

        // Determine operation type
        const operationType =
          BankStatementController.determineOperationType(description);

        // Extract reference (often formatted as "REF: XXXXX" in SG statements)
        const refMatch = description.match(/REF[:\s]+([^,\s]+)/i);
        const reference = refMatch ? refMatch[1] : "";

        // Extract beneficiary
        const beneficiaryMatch =
          description.match(/POUR:\s+([^,]+)/i) ||
          description.match(/DE:\s+([^,]+)/i);
        const beneficiary = beneficiaryMatch ? beneficiaryMatch[1].trim() : "";

        currentTransaction = {
          date: `${day}/${month}/${year}`,
          type: operationType,
          debit: debit,
          credit: credit,
          description: description,
          reference: reference,
          beneficiary: beneficiary,
          raw: line + " " + nextLine,
        };

        descriptionLines = [description];
      } else if (currentTransaction) {
        // Add this line to the current transaction's description
        descriptionLines.push(line);

        // Check for additional reference information
        const refMatch = line.match(/REF[:\s]+([^,\s]+)/i);
        if (refMatch && !currentTransaction.reference) {
          currentTransaction.reference = refMatch[1];
        }

        // Check for beneficiary information
        const beneficiaryMatch =
          line.match(/POUR:\s+([^,]+)/i) || line.match(/DE:\s+([^,]+)/i);
        if (beneficiaryMatch && !currentTransaction.beneficiary) {
          currentTransaction.beneficiary = beneficiaryMatch[1].trim();
        }
      }
    }

    // Don't forget the last transaction
    if (currentTransaction) {
      currentTransaction.description = descriptionLines.join(" ").trim();
      transactions.push(currentTransaction);
    }

    console.log(`Extracted ${transactions.length} transactions from SG PDF`);

    return transactions;
  }

  /**
   * Generic PDF transaction extraction as fallback
   */
  static async extractTransactionsFromGenericPDF(text) {
    // This is a simplified fallback extraction that tries to identify
    // transaction data in any format
    const transactions = [];
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    console.log("Using generic PDF extraction");

    // Look for patterns that might indicate transaction data
    // This is a simple approach and may need refinement based on actual statements
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip lines that are likely headers or footers
      if (
        line.length < 10 ||
        line.match(/page|total|solde|balance|header|footer/i)
      ) {
        continue;
      }

      // Look for date patterns (DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD)
      const dateMatch =
        line.match(/(\d{2})[\/\.](\d{2})[\/\.](\d{4})/) ||
        line.match(/(\d{4})-(\d{2})-(\d{2})/);

      if (dateMatch) {
        // Look for amount patterns in the same line or next few lines
        let amountFound = false;
        let debit = 0;
        let credit = 0;
        let description = line;

        // Search in current line and next 3 lines for amount
        for (let j = 0; j <= 3 && i + j < lines.length; j++) {
          const searchLine = lines[i + j];

          // Look for amount patterns (with decimal comma or period)
          const amountMatches = searchLine.match(/(\d+[\s\.]?\d*[,\.]\d{2})/g);

          if (amountMatches) {
            amountFound = true;

            // Simple heuristic: If we find one amount, check context to determine debit/credit
            // If we find two amounts, assume first is debit, second is credit
            if (amountMatches.length === 1) {
              const amount = BankStatementController.parseAmount(
                amountMatches[0]
              );

              // Look for keywords indicating debit or credit
              if (searchLine.match(/debit|payment|withdrawal|fee|charge/i)) {
                debit = amount;
              } else if (
                searchLine.match(/credit|deposit|interest|received/i)
              ) {
                credit = amount;
              } else {
                // Default: positive numbers are credits, negative are debits
                if (amount < 0) {
                  debit = Math.abs(amount);
                } else {
                  credit = amount;
                }
              }
            } else if (amountMatches.length >= 2) {
              debit = BankStatementController.parseAmount(amountMatches[0]);
              credit = BankStatementController.parseAmount(amountMatches[1]);
            }

            // Add more content to description
            if (j > 0) {
              description += " " + searchLine;
            }

            break;
          }
        }

        if (amountFound) {
          // Format date based on the match pattern
          let dateString;

          if (dateMatch[0].includes("/") || dateMatch[0].includes(".")) {
            // DD/MM/YYYY or DD.MM.YYYY format
            const day = dateMatch[1];
            const month = dateMatch[2];
            const year = dateMatch[3];
            dateString = `${day}/${month}/${year}`;
          } else {
            // YYYY-MM-DD format
            const year = dateMatch[1];
            const month = dateMatch[2];
            const day = dateMatch[3];
            dateString = `${day}/${month}/${year}`;
          }

          const operationType =
            BankStatementController.determineOperationType(description);

          transactions.push({
            date: dateString,
            type: operationType,
            debit: debit,
            credit: credit,
            description: description,
            reference: "",
            beneficiary: "",
            raw: line,
          });
        }
      }
    }

    console.log(
      `Extracted ${transactions.length} transactions from generic PDF`
    );

    return transactions;
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
