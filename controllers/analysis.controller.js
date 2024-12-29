const mongoose = require("mongoose");
const _ = require("lodash"); // Add this line
const Analysis = require("../models/analysis.model");
const Sale = require("../models/sales.model");
const Invoice = require("../models/invoice.model");
const stringSimilarity = require("string-similarity");

class AnalysisController {
  // Helper method to normalize company names
  static normalizeCompanyName(name) {
    if (!name) return "";

    let normalized = name.toLowerCase();
    const prefixes = ["sarl ", "sa ", "sas ", "eurl ", "sci "];

    prefixes.forEach((prefix) => {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length);
      }
    });

    normalized = normalized
      .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const replacements = {
      " co ": " company ",
      " co.": " company",
      " corp ": " corporation ",
      " corp.": " corporation",
      " bros ": " brothers ",
      " bros.": " brothers",
      "cie ": "company ",
      "cie.": "company",
      " ltd ": " limited ",
      " ltd.": " limited",
      " inc ": " incorporated ",
      " inc.": " incorporated",
    };

    for (const [key, value] of Object.entries(replacements)) {
      normalized = normalized.replace(new RegExp(key, "g"), value);
    }

    return normalized;
  }

  // Helper to check if transaction is POS
  static isPOSTransaction(transaction) {
    return (
      transaction.CardCode === "C9999" ||
      transaction.CardName?.toLowerCase().includes("comptoir") ||
      transaction.U_EPOSNo != null ||
      transaction.isPOS
    );
  }

  // Fetch sales data for the given date range
  static async fetchSalesData(startDate, endDate) {
    try {
      return await Sale.find({
        date: {
          $gte: startDate,
          $lte: endDate,
        },
      }).lean();
    } catch (error) {
      console.error("Error fetching sales data:", error);
      throw error;
    }
  }

  // Fetch invoices for the given date range
  static async fetchInvoices(startDate, endDate) {
    try {
      return await Invoice.find({
        DocDate: {
          $gte: startDate,
          $lte: endDate,
        },
      }).lean();
    } catch (error) {
      console.error("Error fetching invoices:", error);
      throw error;
    }
  }

  // Update verification status
  static async updateVerificationStatus(transactions) {
    try {
      // Process updates sequentially instead of in a transaction
      for (const { excelId, sapId } of transactions) {
        // Update Excel/Sales verification
        await Sale.findByIdAndUpdate(excelId, { $set: { verified: true } });

        // Update SAP/Invoice verification
        await Invoice.findByIdAndUpdate(sapId, { $set: { verified: true } });
      }
    } catch (error) {
      console.error("Error updating verification status:", error);
      throw error;
    }
  }

  // Main analysis method
  static async compareData(req, res) {
    try {
      const { startDate, endDate } = req.body;

      // Create extended date range (±50 days) for matching
      const extendedStartDate = new Date(startDate);
      const extendedEndDate = new Date(endDate);
      extendedStartDate.setDate(extendedStartDate.getDate() - 50);
      extendedEndDate.setDate(extendedEndDate.getDate() + 50);

      // Create analysis document
      const analysis = new Analysis({
        dateRange: {
          start: new Date(startDate),
          end: new Date(endDate),
        },
        status: "processing",
      });

      await analysis.save();

      try {
        // Fetch data from MongoDB
        const [salesData, extendedInvoiceData, exactInvoiceData] =
          await Promise.all([
            AnalysisController.fetchSalesData(startDate, endDate),
            // Extended range for matching
            AnalysisController.fetchInvoices(
              extendedStartDate,
              extendedEndDate
            ),
            // Exact range for display
            AnalysisController.fetchInvoices(startDate, endDate),
          ]);

        // Match transactions using extended range data
        const matchedTransactions = await AnalysisController.matchTransactions(
          salesData,
          extendedInvoiceData
        );

        // Update verification status for matched transactions
        await AnalysisController.updateVerificationStatus(matchedTransactions);

        const matchedSapIds = new Set(
          matchedTransactions.map((match) => match.sapId.toString())
        );
        const matchedExcelIds = new Set(
          matchedTransactions.map((match) => match.saleId.toString())
        );

        // Excel discrepancies
        const excelDiscrepancies = salesData
          .filter((sale) => !matchedExcelIds.has(sale._id.toString()))
          .map((sale) => ({
            type: "excel",
            documentId: sale._id,
            documentType: "Sale",
          }));

        // SAP discrepancies
        const sapDiscrepancies = exactInvoiceData
          .filter((invoice) => !matchedSapIds.has(invoice._id.toString()))
          .filter((invoice) => !AnalysisController.isPOSTransaction(invoice))
          .map((invoice) => ({
            type: "sap",
            documentId: invoice._id,
            documentType: "Invoice",
          }));

        // Process POS transactions (using exact range data)
        const posAnalysis = await AnalysisController.analyzePOSTransactions(
          salesData,
          exactInvoiceData
        );

        // Update analysis document
        analysis.matchedTransactions = matchedTransactions;
        analysis.discrepancies = [...excelDiscrepancies, ...sapDiscrepancies];
        analysis.posAnalysis = posAnalysis;
        analysis.status = "completed";
        analysis.processingTime = Date.now() - analysis.performed;

        await analysis.save();

        console.log("MATCHED TRANSACTIONS", matchedTransactions);

        res.json({
          analysisId: analysis._id,
          status: "completed",
          matches: matchedTransactions.map((match) => ({
            date: match.saleDate,
            excelClient: match.excelId.client,
            sapCustomer: match.sapId.CardName,
            excelAmount: match.excelId.amount,
            sapAmount: match.sapId.DocTotal,
            category: match.category,
          })),
          sapDiscrepancies: sapDiscrepancies,
          excelDiscrepancies: excelDiscrepancies,
          posAnalysis: {
            summary: {
              sapPOSTotal: posAnalysis.reduce((sum, p) => sum + p.sapTotal, 0),
              excelPOSTotal: posAnalysis.reduce(
                (sum, p) => sum + p.excelTotal,
                0
              ),
              difference: posAnalysis.reduce(
                (sum, p) => sum + (p.excelTotal - p.sapTotal),
                0
              ),
            },
            sapPOSDetails: posAnalysis.flatMap((p) => p.sapTransactions),
            excelPOSDetails: posAnalysis.flatMap((p) => p.excelTransactions),
            dailyComparisons: posAnalysis,
          },
        });
      } catch (error) {
        analysis.status = "error";
        analysis.errorMessage = error.message;
        await analysis.save();
        throw error;
      }
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // In AnalysisController

  static async matchTransactions(salesData, invoiceData) {
    const matches = [];

    for (const sale of salesData) {
      const categories = [
        "Paiements Chèques",
        "Paiements Espèces",
        "Paiements CB Site",
        "Paiements CB Téléphone",
        "Virements",
        "Livraisons non payées",
      ];

      for (const category of categories) {
        if (!sale[category]) continue;

        for (const transaction of sale[category]) {
          if (transaction.verified) continue;

          let bestMatch = null;
          let bestScore = 0;

          for (const invoice of invoiceData) {
            // Calculate date difference in days
            const dateDiff =
              Math.abs(sale.date - invoice.DocDate) / (1000 * 60 * 60 * 24);
            if (dateDiff > 50) continue;

            const transactionAmount = transaction.bank || transaction.amount;
            const amountDiff = Math.abs(transactionAmount - invoice.DocTotal);
            const amountTolerance = invoice.DocTotal * 0.01; // 1% tolerance

            if (amountDiff <= amountTolerance) {
              const normalizedSaleName =
                AnalysisController.normalizeCompanyName(transaction.client);
              const normalizedInvoiceName =
                AnalysisController.normalizeCompanyName(invoice.CardName);

              let score = 0;
              if (normalizedSaleName === normalizedInvoiceName) {
                score = 1;
              } else if (
                normalizedInvoiceName.includes(normalizedSaleName) ||
                normalizedSaleName.includes(normalizedInvoiceName)
              ) {
                score = 0.9;
              } else {
                score = stringSimilarity.compareTwoStrings(
                  normalizedSaleName,
                  normalizedInvoiceName
                );
              }

              if (score > bestScore) {
                bestScore = score;
                bestMatch = invoice;
              }
            }
          }

          if (bestMatch && bestScore > 0.3) {
            matches.push({
              saleId: sale._id,
              excelId: sale._id,
              excelType: "Sale",
              saleDate: sale.date,
              category,
              transactionClient: transaction.client || "",
              transactionAmount: transaction.bank || transaction.amount,
              sapId: bestMatch._id,
              sapCustomer: bestMatch.CardName,
              sapAmount: bestMatch.DocTotal,
              matchType: "automatic",
              matchDate: new Date(),
              remarks: transaction.remarks || "",
              docNum: bestMatch.DocNum,
              docDate: bestMatch.DocDate,
            });

            // Mark transaction as verified
            transaction.verified = true; // Local flag
          }
        }
      }
    }

    return matches;
  }

  static async analyzePOSTransactions(salesData, invoiceData) {
    const dateMap = new Map();

    // Process each day's sales
    for (const sale of salesData) {
      const dateStr = sale.date.toISOString().split("T")[0];
      if (!dateMap.has(dateStr)) {
        dateMap.set(dateStr, {
          date: sale.date,
          sapTotal: 0,
          excelTotal: 0,
          sapTransactions: [],
          excelTransactions: [],
        });
      }

      const dayData = dateMap.get(dateStr);

      // Calculate POS totals
      if (sale.POS) {
        let dayTotal = 0;
        const posTransactions = [];

        ["Caisse Espèces", "Caisse chèques", "Caisse CB"].forEach(
          (category) => {
            if (sale.POS[category]) {
              sale.POS[category].forEach((transaction) => {
                const amount = Number(transaction.amount) || 0;
                dayTotal += amount;
                posTransactions.push({
                  type: category,
                  client: transaction.client || "",
                  amount: amount,
                });
              });
            }
          }
        );

        dayData.excelTotal += dayTotal;
        dayData.excelTransactions.push(...posTransactions);
      }
    }

    // Process SAP POS transactions
    for (const invoice of invoiceData) {
      if (AnalysisController.isPOSTransaction(invoice)) {
        const dateStr = invoice.DocDate.toISOString().split("T")[0];
        if (!dateMap.has(dateStr)) {
          dateMap.set(dateStr, {
            date: invoice.DocDate,
            sapTotal: 0,
            excelTotal: 0,
            sapTransactions: [],
            excelTransactions: [],
          });
        }

        const dayData = dateMap.get(dateStr);
        const docTotal = Number(invoice.DocTotal) || 0;
        dayData.sapTotal += docTotal;

        // Create a clean transaction object
        const transaction = {
          DocDate: invoice.DocDate,
          CardName: invoice.CardName || "",
          DocTotal: docTotal,
          DocNum: invoice.DocNum || "",
        };

        dayData.sapTransactions.push(transaction);
      }
    }

    // Convert Map to Array and ensure all numbers are properly formatted
    const result = Array.from(dateMap.values()).map((day) => ({
      date: day.date,
      sapTotal: Number(day.sapTotal.toFixed(2)),
      excelTotal: Number(day.excelTotal.toFixed(2)),
      sapTransactions: day.sapTransactions.map((t) => ({
        ...t,
        DocTotal: Number(t.DocTotal.toFixed(2)),
      })),
      excelTransactions: day.excelTransactions.map((t) => ({
        ...t,
        amount: Number(t.amount.toFixed(2)),
      })),
    }));

    return result;
  }
  // Calculate POS day total
  static calculatePOSDayTotal(posData) {
    let total = 0;

    ["Caisse Espèces", "Caisse chèques", "Caisse CB"].forEach((category) => {
      if (posData[category]) {
        total += posData[category].reduce(
          (sum, entry) => sum + (entry.amount || 0),
          0
        );
      }
    });

    return total;
  }

  // Get analysis by ID with populated data
  static async getAnalysisById(req, res) {
    try {
      const { id } = req.params;
      const analysis = await Analysis.findById(id)
        .populate("matchedTransactions.excelId")
        .populate("matchedTransactions.sapId")
        .populate("discrepancies.documentId")
        .populate("discrepancies.matchedWith.documentId");

      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      console.log("ANALYSIS", analysis.matchedTransactions);

      // Transform data for frontend
      const formattedAnalysis = {
        analysisId: analysis._id,
        status: analysis.status,
        matches: analysis.matchedTransactions.map((match) => ({
          date: match.saleDate,
          excelClient: match.client,
          sapCustomer: match.sapId.CardName,
          excelAmount: match.amount,
          sapAmount: match.sapId.DocTotal,
          category: match.category,
          matchType: match.matchType,
          resolution: match.resolution,
        })),
        excelDiscrepancies: analysis.discrepancies
          .filter((d) => d.type === "excel")
          .map((disc) => ({
            date: disc.documentId.date,
            client: disc.documentId.client,
            amount: disc.documentId.amount,
            category: disc.category || "Uncategorized",
            resolution: disc.resolution,
            resolved: disc.resolved,
            matchedWith: disc.matchedWith,
          })),
        sapDiscrepancies: analysis.discrepancies
          .filter((d) => d.type === "sap")
          .map((disc) => ({
            DocDate: disc.documentId.DocDate,
            CardName: disc.documentId.CardName,
            DocTotal: disc.documentId.DocTotal,
            DocNum: disc.documentId.DocNum,
          })),
        posAnalysis: analysis.posAnalysis,
      };

      console.log("FORMATTED", formattedAnalysis.matches);

      res.json(formattedAnalysis);
    } catch (error) {
      console.error("Error fetching analysis:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // Resolve a discrepancy
  static async resolveDiscrepancy(req, res) {
    try {
      const { analysisId, discrepancyId, resolution, matchedDocuments } =
        req.body;

      const analysis = await Analysis.findById(analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      const discrepancy = analysis.discrepancies.id(discrepancyId);
      if (!discrepancy) {
        return res.status(404).json({ error: "Discrepancy not found" });
      }

      try {
        // Update discrepancy
        discrepancy.resolved = true;
        discrepancy.resolution = resolution;
        discrepancy.resolvedDate = new Date();
        discrepancy.matchedWith = matchedDocuments.map((doc) => ({
          documentId: doc._id,
          documentType: doc.type,
        }));

        // Create new matched transactions
        const newMatches = matchedDocuments.map((doc) => ({
          excelId:
            discrepancy.type === "excel" ? discrepancy.documentId : doc._id,
          excelType: "Sale",
          sapId: discrepancy.type === "sap" ? discrepancy.documentId : doc._id,
          category: "Resolved",
          matchType: "manual",
          matchDate: new Date(),
        }));

        analysis.matchedTransactions.push(...newMatches);

        // Update verification status without transaction
        await AnalysisController.updateVerificationStatus(newMatches);

        // Save the analysis document
        await analysis.save();

        res.json({ success: true });
      } catch (error) {
        console.error("Error processing resolution:", error);
        throw error;
      }
    } catch (error) {
      console.error("Error resolving discrepancy:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // Get list of analyses
  static async getAnalyses(req, res) {
    try {
      const { start, end, limit = 100, page = 1 } = req.query;
      const query = {};

      if (start || end) {
        query["dateRange.start"] = {};
        query["dateRange.end"] = {};

        if (start) {
          const startDate = new Date(start);
          startDate.setHours(0, 0, 0, 0);
          query["dateRange.start"].$gte = startDate;
        }

        if (end) {
          const endDate = new Date(end);
          endDate.setHours(23, 59, 59, 999);
          query["dateRange.end"].$lte = endDate;
        }
      }

      const skip = (page - 1) * limit;

      const [analyses, total] = await Promise.all([
        Analysis.find(query)
          .sort({ performed: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .select("-matchedTransactions -discrepancies -posAnalysis")
          .lean(),
        Analysis.countDocuments(query),
      ]);

      // Add summary counts
      const analysesWithCounts = analyses.map((analysis) => ({
        ...analysis,
        counts: {
          matched: analysis.matchedTransactions?.length || 0,
          discrepancies: analysis.discrepancies?.length || 0,
          pos: analysis.posAnalysis?.length || 0,
        },
      }));

      res.json({
        analyses: analysesWithCounts,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / limit),
          limit: parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Error fetching analyses:", error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = AnalysisController;
