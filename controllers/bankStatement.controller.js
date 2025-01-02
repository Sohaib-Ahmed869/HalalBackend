const BankStatement = require("../models/bankStatement.model");
const XLSX = require("xlsx");
const fs = require("fs");
const { parse } = require("ofx-parser");
const pdfParse = require("pdf-parse");

class PDFProcessor {
  static async processPDF(buffer) {
    try {
      const pdfData = await pdfParse(buffer);
      console.log("Raw PDF text:", pdfData.text); // Add this
      console.log("=".repeat(50)); // Line separator

      // Split into lines and show first few lines
      const lines = pdfData.text.split("\n");
      console.log("First 10 lines:");
      lines.slice(0, 10).forEach((line, i) => {
        console.log(`Line ${i}:`, line);
      });

      const transactions = await this.extractTransactions(pdfData.text);
      console.log("Found transactions:", transactions.length); // Add this
      return transactions;
    } catch (error) {
      console.error("PDF processing error:", error);
      throw new Error(`PDF processing error: ${error.message}`);
    }
  }

  static async extractTransactions(text) {
    const transactions = [];
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    let currentTransaction = null;
    let descriptionLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match date pattern DD.01
      const dateMatch = line.match(/^(\d{2})\.(\d{2})/);

      if (dateMatch) {
        // If we have a previous transaction, save it
        if (currentTransaction) {
          currentTransaction.description = descriptionLines.join(" ").trim();
          transactions.push(currentTransaction);
          descriptionLines = [];
        }

        // Start a new transaction
        const parts = line.split(/\s+/);

        // Extract amount and value date
        const amountMatch = line.match(
          /(\d+[\d\s]*(?:,\d{2})?)\s*(\d{2}\.\d{2}\.\d{2})?$/
        );
        let amount = null;
        let valueDate = null;

        if (amountMatch) {
          const [_, amountStr, date] = amountMatch;
          amount = this.parseAmount(amountStr);
          valueDate = date;
        }

        // Get operation type - look for common transaction types
        const operationType = this.determineOperationType(line);

        currentTransaction = {
          date: `${dateMatch[1]}.${dateMatch[2]}.23`, // Assuming year 2023
          operationType: operationType,
          amount: amount || 0,
          valueDate: valueDate,
          description: "",
          raw: line,
        };

        // Start collecting description
        const descStart = line.indexOf(parts[1]);
        if (descStart > -1) {
          const desc = line.substring(descStart).trim();
          if (desc) descriptionLines.push(desc);
        }
      } else if (currentTransaction) {
        // Continue collecting description lines
        descriptionLines.push(line);
      }
    }

    // Don't forget the last transaction
    if (currentTransaction) {
      currentTransaction.description = descriptionLines.join(" ").trim();
      transactions.push(currentTransaction);
    }

    return transactions;
  }

  static determineOperationType(line) {
    const typeMap = {
      Virement: "VIREMENT",
      Prélèvement: "PRELEVEMENT",
      "Remise carte": "CARTE",
      Commission: "COMMISSION",
      Versement: "VERSEMENT",
      Retrait: "RETRAIT",
      Intérêts: "INTERETS",
    };

    const lowercaseLine = line.toLowerCase();
    for (const [key, value] of Object.entries(typeMap)) {
      if (lowercaseLine.includes(key.toLowerCase())) {
        return value;
      }
    }
    return "AUTRE";
  }

  static parseAmount(amountStr) {
    if (!amountStr) return 0;
    // Remove spaces and convert French number format
    return parseFloat(amountStr.replace(/\s/g, "").replace(",", "."));
  }

  static cleanDescription(desc) {
    // Remove reference numbers and clean up the description
    return desc
      .replace(/\d{6,}/g, "") // Remove long number sequences
      .replace(/sepa|rcur/gi, "") // Remove common banking terms
      .replace(/\s+/g, " ") // Normalize spaces
      .trim();
  }
}

class BankStatementController {
  static async uploadStatement(req, res) {
    try {
      const buffer = req.file.buffer;
      const fileType = req.file.originalname.split(".").pop().toLowerCase();
      const bankName = req.body.bankName;

      let formattedData = [];
      if (fileType === "pdf") {
        formattedData = await PDFProcessor.processPDF(buffer);
      } else if (fileType === "xlsx" || fileType === "xls") {
        // Process Excel file
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(firstSheet, { raw: false });

        //print all data
        console.log(data);

        formattedData = data.map((row) => ({
          operationDate: new Date(row["Date d'opération"]) || new Date(),
          operationRef: row["Référence de l'opération"],
          operationType: row["Type de l'opération"],
          amount: parseFloat(row["Montant"].replace(",", ".")),
          comment: row["Commentaire"],
          detail1: row["Détail 1"],
          detail2: row["Détail 2"],
          detail3: row["Détail 3"],
          detail4: row["Détail 4"],
          detail5: row["Détail 5"],
        }));
      } else if (fileType === "ofx") {
        const ofxString = buffer.toString("utf8");

        // Match all transactions
        const transactionMatches =
          ofxString.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/g) || [];

        formattedData = transactionMatches
          .map((transactionBlock) => {
            const getValue = (tag) => {
              const regex = new RegExp(`<${tag}>(.*?)\n`, "i"); // Adjusted to match newline after tag value
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
              console.error(`Invalid transaction: ${transactionBlock}`);
              return null; // Skip invalid transactions
            }

            return {
              operationDate,
              operationRef: getValue("FITID"),
              operationType: getValue("TRNTYPE"),
              amount,
              comment: getValue("MEMO"),
              detail1: getValue("NAME"),
            };
          })
          .filter((transaction) => transaction !== null); // Remove invalid transactions
      } else {
        console.error("Unsupported file type:", fileType);
        return res.status(400).json({ message: "Unsupported file type" });
      }

      // Check if any valid transactions exist
      if (formattedData.length === 0) {
        console.error("No valid transactions found in the file");
        return res
          .status(400)
          .json({ message: "No valid transactions found in the file" });
      }

      // Add bankName to each transaction
      formattedData = formattedData.map((transaction) => ({
        ...transaction,
        bank:bankName, // Add the bank name to each transaction
      }));

      // Store valid transactions in the database
      await BankStatement.insertMany(formattedData);

      res.status(200).json({
        message: "Bank statement uploaded successfully",
        count: formattedData.length,
      });
    } catch (error) {
      console.error("Upload error:", error.message);
      res.status(500).json({ error: error.message });
    }
  }

  static async getStatements(req, res) {
    try {
      const { startDate, endDate } = req.query;
      const query = {};

      if (startDate || endDate) {
        query.operationDate = {};
        if (startDate) query.operationDate.$gte = new Date(startDate);
        if (endDate) query.operationDate.$lte = new Date(endDate);
      }

      const statements = await BankStatement.find(query).sort({
        operationDate: -1,
      });

      res.json(statements);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = BankStatementController;
