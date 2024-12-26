const BankStatement = require("../models/bankStatement.model");
const XLSX = require("xlsx");
const fs = require("fs");
const { parse } = require("ofx-parser");

class BankStatementController {
  static async uploadStatement(req, res) {
    try {
      const buffer = req.file.buffer;
      const fileType = req.file.originalname.split(".").pop().toLowerCase();

      let formattedData = [];

      if (fileType === "xlsx" || fileType === "xls") {
        // Process Excel file
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(firstSheet, { raw: false });

        formattedData = data.map((row) => ({
          operationDate: new Date(row["Date d'opération"]),
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
        return res.status(400).json({ message: "Unsupported file type" });
      }

      // Check if any valid transactions exist
      if (formattedData.length === 0) {
        return res
          .status(400)
          .json({ message: "No valid transactions found in the file" });
      }

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
