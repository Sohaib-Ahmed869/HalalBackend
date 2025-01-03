const stringSimilarity = require("string-similarity");
const Invoice = require("../models/invoice.model");
const Analysis = require("../models/analysis.model");
const BankStatement = require("../models/bankStatement.model");
const Payment = require("../models/payment.model");
const Sale = require("../models/sales.model");
class AnalysisController {
  static normalizeCompanyName(name) {
    if (!name) return "";

    // Convert to lowercase
    let normalized = name.toLowerCase();

    // Remove common prefixes
    const prefixes = ["sarl ", "sa ", "sas ", "eurl ", "sci "];
    prefixes.forEach((prefix) => {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length);
      }
    });

    // Remove special characters and extra spaces
    normalized = normalized
      .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, " ") // Replace special chars with space
      .replace(/\s+/g, " ") // Replace multiple spaces with single space
      .trim();

    // Common abbreviations and variations
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

    // Apply replacements
    for (const [key, value] of Object.entries(replacements)) {
      normalized = normalized.replace(new RegExp(key, "g"), value);
    }

    return normalized;
  }
  static flattenExcelData(excelEntry) {
    const flattenedData = [];
    const date = excelEntry.date;

    // Helper function to add entries to flattenedData
    const addEntries = (entries, category) => {
      if (!Array.isArray(entries)) return;
      entries.forEach((entry) => {
        // Skip if client is any type of total entry
        if (
          entry.client &&
          entry.client.toLowerCase() !== "total" &&
          entry.client.toLowerCase() !== "client" &&
          entry.client !== "TOTAL ESPECES" &&
          entry.client !== "TOTAL CHEQUES" &&
          entry.client !== "TOTAL CB Internet & Phone"
        ) {
          flattenedData.push({
            date,
            client: entry.client,
            amount: entry.bank || entry.amount || 0,
            category,
            remarks: entry.remarks || "",
            isPOS: category.startsWith("POS"),
          });
        }
      });
    };

    // Process each category
    addEntries(excelEntry["Paiements Chèques"], "Chèques");
    addEntries(excelEntry["Paiements Espèces"], "Espèces");
    addEntries(excelEntry["Paiements CB Site"], "CB Site");
    addEntries(excelEntry["Paiements CB Téléphone"], "CB Téléphone");
    addEntries(excelEntry["Virements"], "Virements");
    addEntries(excelEntry["Livraisons non payées"], "Non Payées");

    // Process POS data with specific POS categories
    if (excelEntry.POS) {
      addEntries(excelEntry.POS["Caisse CB"], "POS CB");
      addEntries(excelEntry.POS["Caisse Espèces"], "POS Espèces");
      addEntries(excelEntry.POS["Caisse chèques"], "POS Chèques");
    }

    return flattenedData;
  }

  static groupByCategory(data) {
    return data.reduce((acc, item) => {
      const category = item.category || "Uncategorized";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(item);
      return acc;
    }, {});
  }

  static extractPOSDetails(excelData) {
    const posDetails = [];
    excelData.forEach((dayData) => {
      if (dayData.POS) {
        const date = dayData.date;
        ["Caisse CB", "Caisse Espèces", "Caisse chèques"].forEach(
          (category) => {
            const entries = dayData.POS[category] || [];
            entries.forEach((entry) => {
              if (
                entry.client?.toLowerCase() !== "total" &&
                entry.client?.toLowerCase() !== "client" &&
                entry.client !== "TOTAL ESPECES" &&
                entry.client !== "TOTAL CHEQUES" &&
                entry.client !== "TOTAL CB Internet & Phone"
              ) {
                posDetails.push({
                  date,
                  type: category,
                  client: entry.client,
                  amount: Number(entry.amount) || 0,
                });
              }
            });
          }
        );
      }
    });
    return posDetails;
  }
  static flattenPaymentData(payment) {
    return {
      DocEntry: payment.DocEntry,
      DocNum: payment.DocNum,
      DocDate: payment.DocDate,
      CardCode: payment.CardCode,
      CardName: payment.CardName,
      DocTotal: payment.CashSum + payment.TransferSum || 0,
      Remarks: payment.Remarks,
      source: "incoming",
    };
  }

  static async compareData(req, res) {
    try {
      const { excelData, dateRange } = req.body;
      console.log("Received Excel Data:", excelData);

      // Selected date range (for displaying discrepancies)
      const selectedStartDate = new Date(dateRange.start);
      const selectedEndDate = new Date(dateRange.end);
      selectedStartDate.setHours(0, 0, 0, 0);
      selectedEndDate.setHours(23, 59, 59, 999);

      // Extended date range (for matching purposes)
      const extendedStartDate = new Date(selectedStartDate);
      const extendedEndDate = new Date(selectedEndDate);
      extendedStartDate.setDate(extendedStartDate.getDate() - 50);
      extendedEndDate.setDate(extendedEndDate.getDate() + 50);

      // Check if analysis already exists for this date range
      const existingAnalysis = await Analysis.findOne({
        "dateRange.start": selectedStartDate,
        "dateRange.end": selectedEndDate,
      });

      if (existingAnalysis) {
        // console.log(existingAnalysis.extendedSapDiscrepancies);
        return res.json({
          analysisId: existingAnalysis._id,
          matches: existingAnalysis.matches,
          excelDiscrepancies: existingAnalysis.excelDiscrepancies,
          sapDiscrepancies: existingAnalysis.sapDiscrepancies,
          extendedSapDiscrepancies: existingAnalysis.extendedSapDiscrepancies,
          posAnalysis: existingAnalysis.posAnalysis,
        });
      }

      // Fetch invoices and payments from SAP
      const sapInvoices = await Invoice.find({
        DocDate: { $gte: extendedStartDate, $lte: extendedEndDate },
      }).lean();
      const sapPayments = await Payment.find({
        DocDate: { $gte: extendedStartDate, $lte: extendedEndDate },
      }).lean();

      const flattenedPayments = sapPayments.map(
        AnalysisController.flattenPaymentData
      );

      // Fetch SAP invoices for extended date range
      const allSapData = [...sapInvoices, ...flattenedPayments];

      // Filter SAP data for selected date range
      const selectedRangeSapData = allSapData.filter((invoice) => {
        const invoiceDate = new Date(invoice.DocDate);
        return (
          invoiceDate >= selectedStartDate && invoiceDate <= selectedEndDate
        );
      });

      console.log("Retrieved SAP Data:", allSapData.length, "invoices");

      // Flatten Excel data
      const flattenedExcelData = [];
      excelData.forEach((dayData) => {
        const flattened = AnalysisController.flattenExcelData(dayData);
        flattenedExcelData.push(...flattened);
      });

      const matches = [];
      const excelDiscrepancies = [];
      const sapDiscrepancies = [...selectedRangeSapData]; // Use selected range for discrepancies
      const extendedSapDiscrepancies = [...allSapData]; // Keep full range for matching

      // Process regular transactions (excluding POS)
      for (const excelEntry of flattenedExcelData) {
        if (excelEntry.isPOS) continue;

        let bestMatch = null;
        let bestScore = 0;
        let bestIndex = -1;

        allSapData.forEach((sapEntry, index) => {
          // Skip POS entries in SAP
          if (
            sapEntry.CardCode === "C9999" ||
            sapEntry.CardName?.toLowerCase().includes("comptoir") ||
            sapEntry.U_EPOSNo != null
          ) {
            return;
          }

          const excelDate = new Date(excelEntry.date);
          const sapDate = new Date(sapEntry.DocDate);
          const dateDiff =
            Math.abs(excelDate - sapDate) / (1000 * 60 * 60 * 24);

          if (dateDiff <= 50) {
            // Extended matching window
            const amountDiff = Math.abs(excelEntry.amount - sapEntry.DocTotal);
            const amountTolerance = sapEntry.DocTotal * 0.01;

            if (amountDiff <= amountTolerance) {
              // Normalize both names before comparison
              const normalizedExcelName =
                AnalysisController.normalizeCompanyName(excelEntry.client);
              const normalizedSapName = AnalysisController.normalizeCompanyName(
                sapEntry.CardName
              );

              // First try exact match after normalization
              if (normalizedExcelName === normalizedSapName) {
                bestScore = 1;
                bestMatch = sapEntry;
                bestIndex = index;
                return; // Exit the loop as we found an exact match
              }

              // If no exact match, check if one name contains the other
              if (
                normalizedSapName.includes(normalizedExcelName) ||
                normalizedExcelName.includes(normalizedSapName)
              ) {
                const containsScore = 0.9; // High score for containment
                if (containsScore > bestScore) {
                  bestScore = containsScore;
                  bestMatch = sapEntry;
                  bestIndex = index;
                  return;
                }
              }

              // If still no match, use string similarity
              const similarity = stringSimilarity.compareTwoStrings(
                normalizedExcelName,
                normalizedSapName
              );

              if (similarity > bestScore) {
                bestScore = similarity;
                bestMatch = sapEntry;
                bestIndex = index;
              }
            }
          }
        });

        if (bestMatch && bestScore > 0.6) {
          matches.push({
            date: excelEntry.date,
            excelClient: excelEntry.client,
            sapCustomer: bestMatch.CardName,
            excelAmount: excelEntry.amount,
            sapAmount: bestMatch.DocTotal,
            category: excelEntry.category,
            similarity: bestScore,
            remarks: excelEntry.remarks,
          });

          // Remove from both discrepancy arrays if found
          const selectedIndex = sapDiscrepancies.findIndex(
            (inv) => inv._id === bestMatch._id
          );
          if (selectedIndex !== -1) {
            sapDiscrepancies.splice(selectedIndex, 1);
          }
          const extendedIndex = extendedSapDiscrepancies.findIndex(
            (inv) => inv._id === bestMatch._id
          );
          if (extendedIndex !== -1) {
            extendedSapDiscrepancies.splice(extendedIndex, 1);
          }
        } else {
          excelDiscrepancies.push({
            date: excelEntry.date,
            client: excelEntry.client,
            amount: excelEntry.amount,
            category: excelEntry.category,
            remarks: excelEntry.remarks,
          });
        }
      }

      // Process POS data separately
      const sapPOSSales = selectedRangeSapData.filter(
        (invoice) =>
          invoice.CardCode === "C9999" ||
          invoice.paymentMethod?.toLowerCase().includes("POS") ||
          invoice.U_EPOSNo != null ||
          invoice.isPOS
      );

      // Calculate POS totals from Excel data
      const sapPOSTotal = sapPOSSales.reduce(
        (sum, invoice) => sum + invoice.DocTotal,
        0
      );
      const excelPOSDetails = AnalysisController.extractPOSDetails(excelData);
      const excelPOSTotal = excelPOSDetails.reduce(
        (sum, entry) => sum + entry.amount,
        0
      );

      // Calculate daily POS totals comparison
      const dailyComparisons = {};

      // Add SAP daily totals
      sapPOSSales.forEach((invoice) => {
        const date = invoice.DocDate.toISOString().split("T")[0];
        if (!dailyComparisons[date]) {
          dailyComparisons[date] = { sapTotal: 0, excelTotal: 0 };
        }
        dailyComparisons[date].sapTotal += invoice.DocTotal;
      });

      // Add Excel daily totals for each date
      // Add Excel daily totals for each date
      excelData.forEach((dayData) => {
        const date = new Date(dayData.date);
        // Normalize the date to start of day in local timezone
        date.setHours(0, 0, 0, 0);
        const dateStr = date.toISOString().split("T")[0];

        // Initialize if not exists
        if (!dailyComparisons[dateStr]) {
          dailyComparisons[dateStr] = { sapTotal: 0, excelTotal: 0 };
        }

        // Add Excel data regardless of SAP data existence
        const posDetails = AnalysisController.extractPOSDetails([dayData]);
        dailyComparisons[dateStr].excelTotal = posDetails.reduce(
          (sum, entry) => sum + entry.amount,
          0
        );
      });

      // Convert daily comparisons to array and calculate differences
      const posDateComparisons = Object.entries(dailyComparisons)
        .map(([date, totals]) => ({
          date,
          sapTotal: totals.sapTotal,
          excelTotal: totals.excelTotal,
          difference: totals.excelTotal - totals.sapTotal,
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      // Group matches and discrepancies by category
      const groupedMatches = AnalysisController.groupByCategory(matches);
      const groupedExcelDiscrepancies =
        AnalysisController.groupByCategory(excelDiscrepancies);

      console.log("Analysis complete", {
        matchesCount: matches.length,
        excelDiscrepanciesCount: excelDiscrepancies.length,
        sapDiscrepanciesCount: sapDiscrepancies.length,
        posComparisonsCount: posDateComparisons.length,
      });

      const processedSapDiscrepancies = sapDiscrepancies.map((invoice) => ({
        ...invoice,
        potentialMatches: AnalysisController.findPotentialExcelMatches(
          invoice,
          flattenedExcelData
        ),
      }));

      // Create new analysis document
      const analysis = new Analysis({
        dateRange: {
          start: selectedStartDate,
          end: selectedEndDate,
        },
        matches: groupedMatches,
        excelDiscrepancies: groupedExcelDiscrepancies,
        sapDiscrepancies: processedSapDiscrepancies.filter(
          (invoice) =>
            !(
              invoice.CardCode === "C9999" ||
              invoice.CardName?.toLowerCase().includes("comptoir") ||
              invoice.U_EPOSNo != null
            )
        ),
        extendedSapDiscrepancies: extendedSapDiscrepancies.filter(
          (invoice) =>
            !(
              invoice.CardCode === "C9999" ||
              invoice.CardName?.toLowerCase().includes("comptoir") ||
              invoice.U_EPOSNo != null
            )
        ),
        posAnalysis: {
          summary: {
            sapPOSTotal,
            excelPOSTotal,
            difference: excelPOSTotal - sapPOSTotal,
          },
          sapPOSDetails: sapPOSSales,
          excelPOSDetails,
          dailyComparisons: posDateComparisons,
        },
        // Add default bank reconciliation data
        bankReconciliation: {
          matches: [],
          discrepancies: [],
          summary: {
            totalTransactions: 0,
            matchedCount: 0,
            unmatchedCount: 0,
            totalAmount: 0,
            matchedAmount: 0,
          },
          lastUpdated: new Date(),
        },
      });
      // Initialize maps if empty
      if (!analysis.matches) {
        analysis.matches = new Map();
      }
      if (!(analysis.matches instanceof Map)) {
        analysis.matches = new Map(Object.entries(groupedMatches));
      }
      if (!(analysis.excelDiscrepancies instanceof Map)) {
        analysis.excelDiscrepancies = new Map(
          Object.entries(groupedExcelDiscrepancies)
        );
      }

      analysis.markModified("matches");
      analysis.markModified("excelDiscrepancies");

      await analysis.save();

      res.json({
        analysisId: analysis._id,
        matches: groupedMatches,
        excelDiscrepancies: groupedExcelDiscrepancies,
        sapDiscrepancies: sapDiscrepancies.filter(
          (invoice) =>
            !(
              invoice.CardCode === "C9999" ||
              invoice.CardName?.toLowerCase().includes("comptoir") ||
              invoice.U_EPOSNo != null
            )
        ),
        extendedSapDiscrepancies: extendedSapDiscrepancies.filter(
          (invoice) =>
            !(
              invoice.CardCode === "C9999" ||
              invoice.CardName?.toLowerCase().includes("comptoir") ||
              invoice.U_EPOSNo != null
            )
        ),
        posAnalysis: analysis.posAnalysis,
      });
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: "Analysis failed: " + error.message });
    }
  }

  static async resolveDiscrepancy(req, res) {
    try {
      const { analysisId, category, index, resolution, matchedInvoices } =
        req.body;

      const analysis = await Analysis.findById(analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // Convert Map-like object to Map if necessary
      let discrepanciesMap = analysis.excelDiscrepancies;
      if (!(discrepanciesMap instanceof Map)) {
        discrepanciesMap = new Map(Object.entries(analysis.excelDiscrepancies));
      }

      const discrepancies = discrepanciesMap.get(category);
      if (!discrepancies || !discrepancies[index]) {
        return res.status(404).json({ error: "Discrepancy not found" });
      }

      // Preserve all original fields when updating the discrepancy
      const originalDiscrepancy = discrepancies[index];
      discrepancies[index] = {
        ...originalDiscrepancy,
        date: originalDiscrepancy.date,
        client: originalDiscrepancy.client,
        amount: originalDiscrepancy.amount,
        category: originalDiscrepancy.category,
        remarks: originalDiscrepancy.remarks || "",
        resolved: true,
        resolution,
        resolvedTimestamp: new Date(),
        matchedInvoices: matchedInvoices.map((inv) => ({
          _id: inv._id,
          sapCustomer: inv.sapCustomer,
          sapAmount: Number(inv.sapAmount),
          docNum: inv.docNum,
          docDate: new Date(inv.docDate),
        })),
      };

      // Create new matches
      const newMatches = matchedInvoices.map((invoice) => ({
        date: new Date(originalDiscrepancy.date),
        excelClient: originalDiscrepancy.client,
        sapCustomer: invoice.sapCustomer,
        excelAmount: Number(originalDiscrepancy.amount),
        sapAmount: Number(invoice.sapAmount),
        category: originalDiscrepancy.category, // Make sure to include the category
        remarks: originalDiscrepancy.remarks || "",
        docNum: invoice.docNum,
        docDate: new Date(invoice.docDate),
        isResolved: true,
        resolution,
      }));

      // Update matches Map
      let matchesMap = analysis.matches;
      if (!(matchesMap instanceof Map)) {
        matchesMap = new Map(Object.entries(analysis.matches));
      }

      // Create a new category for resolved matches if it doesn't exist
      const resolvedCategory = "Resolved and Matched";
      const resolvedMatches = matchesMap.get(resolvedCategory) || [];
      resolvedMatches.push(...newMatches);
      matchesMap.set(resolvedCategory, resolvedMatches);

      // Update analysis document
      analysis.matches = matchesMap;
      analysis.excelDiscrepancies = discrepanciesMap;

      analysis.markModified("matches");
      analysis.markModified("excelDiscrepancies");

      await analysis.save();

      res.json({
        success: true,
        matches: Array.from(matchesMap.get(resolvedCategory) || []),
        discrepancies: Array.from(discrepanciesMap.get(category) || []),
      });
    } catch (error) {
      console.error("Error resolving discrepancy:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async getAnalyses(req, res) {
    try {
      const { start, end } = req.query;
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

      const analyses = await Analysis.find(query)
        .sort({ performed: -1 })
        .limit(100)
        .lean(); // Add .lean() to get plain objects

      // Transform Map-like objects to regular objects if needed
      const transformedAnalyses = analyses.map((analysis) => ({
        ...analysis,
        matches: analysis.matches
          ? Object.fromEntries(Object.entries(analysis.matches))
          : {},
        excelDiscrepancies: analysis.excelDiscrepancies
          ? Object.fromEntries(Object.entries(analysis.excelDiscrepancies))
          : {},
      }));

      res.json(transformedAnalyses);
    } catch (error) {
      console.error("Error fetching analyses:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async getAnalysisById(req, res) {
    try {
      const { id } = req.params;
      const analysis = await Analysis.findById(id).lean();

      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      res.json(analysis);
    } catch (error) {
      console.error("Error fetching analysis by ID:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async compareBankData(req, res) {
    try {
      const { analysisId, dateRange } = req.body;

      // 1) Load the analysis
      const analysis = await Analysis.findById(analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // 2) Fetch ALL bank statements
      const allBankStatements = await BankStatement.find({
        amount: { $exists: true, $ne: null },
        operationDate: { $exists: true, $ne: null },
        operationRef: { $exists: true, $ne: null, $ne: "" },
      }).sort({ operationDate: 1 });

      // 3) If dateRange exists, define a filtered subset for display
      const filteredBankStatements = dateRange
        ? allBankStatements.filter((stmt) => {
            const stmtDate = new Date(stmt.operationDate);
            return (
              stmtDate >= new Date(dateRange.start) &&
              stmtDate <= new Date(dateRange.end)
            );
          })
        : allBankStatements;

      // ----------------------------------------------------------------
      // 4) We'll gather NEW auto-detected matches and discrepancies
      //    (We will merge them with old matches later.)
      // ----------------------------------------------------------------
      const allBankMatches = [];
      const allBankDiscrepancies = [];
      const unmatchedBank = [...allBankStatements];

      // Helper to normalize text and compare
      const normalizeAndCompare = (str1, str2) => {
        if (!str1 || !str2) return 0;
        str1 = AnalysisController.normalizeCompanyName(str1);
        str2 = AnalysisController.normalizeCompanyName(str2);
        return stringSimilarity.compareTwoStrings(str1, str2);
      };

      // ----------------------------------------------------------------
      // 5) Convert Mongoose Map of transactions (analysis.matches) to an object
      //    so we can safely do `Object.entries(...)`.
      // ----------------------------------------------------------------
      let matchesObj = {};
      if (analysis.matches && typeof analysis.matches.toObject === "function") {
        // Mongoose Map => plain JS object
        matchesObj = analysis.matches.toObject();
      } else if (analysis.matches instanceof Map) {
        // If it’s a native Map for some reason
        matchesObj = Object.fromEntries(analysis.matches);
      } else {
        // Already a plain object or undefined
        matchesObj = analysis.matches || {};
      }

      // 6) Now do the matching logic over ALL bank statements
      for (const bankStmt of allBankStatements) {
        let bestMatch = null;
        let bestScore = 0;
        let matchSource = null;
        let matchType = null;

        // ------------------------------------------------------------
        // (A) Check "Excel" transactions from `analysis.matches`
        //     Remember: matchesObj => { categoryName: Transaction[] }
        // ------------------------------------------------------------
        for (const [category, transactions] of Array.from(
          analysis.matches.entries()
        )) {
          for (const txn of transactions) {
            if (txn.isResolved) continue;
            // Compare amounts
            const amountDiff = Math.abs(txn.excelAmount - bankStmt.amount);
            if (amountDiff < 0.01) {
              // Compare potential names
              const nameScore = Math.max(
                normalizeAndCompare(bankStmt.comment, txn.excelClient),
                normalizeAndCompare(bankStmt.detail1, txn.excelClient),
                normalizeAndCompare(bankStmt.detail2, txn.excelClient)
              );
              if (nameScore > bestScore) {
                bestScore = nameScore;
                bestMatch = txn;
                matchSource = "excel";
                matchType = nameScore > 0.6 ? "amount_and_name" : "amount_only";
              } else if (!bestMatch) {
                bestMatch = txn;
                bestScore = 0;
                matchSource = "excel";
                matchType = "amount_only";
              }
            }
          }
        }

        // ------------------------------------------------------------
        // (B) Check SAP discrepancies (`analysis.sapDiscrepancies`)
        // ------------------------------------------------------------
        if (
          analysis.sapDiscrepancies &&
          Array.isArray(analysis.sapDiscrepancies)
        ) {
          for (const sapTxn of analysis.sapDiscrepancies) {
            const amountDiff = Math.abs(sapTxn.DocTotal - bankStmt.amount);
            if (amountDiff < 0.01) {
              const nameScore = Math.max(
                normalizeAndCompare(bankStmt.comment, sapTxn.CardName),
                normalizeAndCompare(bankStmt.detail1, sapTxn.CardName),
                normalizeAndCompare(bankStmt.detail2, sapTxn.CardName),
                normalizeAndCompare(bankStmt.operationRef, sapTxn.DocNum),
                normalizeAndCompare(bankStmt.operationRef, sapTxn.U_EPOSNo)
              );
              if (nameScore > bestScore) {
                bestScore = nameScore;
                bestMatch = sapTxn;
                matchSource = "sap";
                matchType = nameScore > 0.6 ? "amount_and_name" : "amount_only";
              } else if (!bestMatch) {
                bestMatch = sapTxn;
                bestScore = 0;
                matchSource = "sap";
                matchType = "amount_only";
              }
            }
          }
        }

        // ------------------------------------------------------------
        // (C) If we found something that matches better than 0
        //     => create a new BankMatch object
        // ------------------------------------------------------------
        if (bestMatch) {
          const match = {
            bankStatement: bankStmt,
            matchedTransaction: bestMatch,
            matchSource,
            matchType,
            confidence:
              bestScore > 0.8 ? "high" : bestScore > 0.6 ? "medium" : "low",
            status: "pending",
            amount: bankStmt.amount,
            date: bankStmt.operationDate,
          };
          allBankMatches.push(match);

          // Remove from unmatched if desired
          const idx = unmatchedBank.findIndex(
            (b) => b._id.toString() === bankStmt._id.toString()
          );
          if (idx !== -1) unmatchedBank.splice(idx, 1);
        } else {
          // No match => discrepancy
          allBankDiscrepancies.push({
            bankStatement: bankStmt,
            status: "unresolved",
            amount: bankStmt.amount,
            date: bankStmt.operationDate,
          });
        }
      }

      // ----------------------------------------------------------------
      // 7) Build “filtered” sets if dateRange is specified
      // ----------------------------------------------------------------
      const filteredBankMatches = [];
      const filteredBankDiscrepancies = [];
      if (dateRange) {
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);

        for (const m of allBankMatches) {
          const matchDate = new Date(m.bankStatement.operationDate);
          if (matchDate >= startDate && matchDate <= endDate) {
            filteredBankMatches.push(m);
          }
        }
        for (const d of allBankDiscrepancies) {
          const discrepancyDate = new Date(d.bankStatement.operationDate);
          if (discrepancyDate >= startDate && discrepancyDate <= endDate) {
            filteredBankDiscrepancies.push(d);
          }
        }
      } else {
        // If no date range, "filtered" just equals "all"
        filteredBankMatches.push(...allBankMatches);
        filteredBankDiscrepancies.push(...allBankDiscrepancies);
      }

      // ----------------------------------------------------------------
      // 8) Summaries for the filtered sets
      // ----------------------------------------------------------------
      const filteredSummary = {
        totalTransactions: filteredBankStatements.length,
        matchedCount: filteredBankMatches.length,
        unmatchedCount: filteredBankDiscrepancies.length,
        totalAmount: filteredBankStatements.reduce(
          (sum, stmt) => sum + stmt.amount,
          0
        ),
        matchedAmount: filteredBankMatches.reduce(
          (sum, match) => sum + match.amount,
          0
        ),
      };

      // 9) Summaries for ALL data
      const allDataSummary = {
        totalTransactions: allBankStatements.length,
        matchedCount: allBankMatches.length,
        unmatchedCount: allBankDiscrepancies.length,
        totalAmount: allBankStatements.reduce(
          (sum, stmt) => sum + stmt.amount,
          0
        ),
        matchedAmount: allBankMatches.reduce(
          (sum, match) => sum + match.amount,
          0
        ),
      };

      // ----------------------------------------------------------------
      // 10) Merge newly found matches with old matches already stored
      //     in analysis.bankReconciliation
      // ----------------------------------------------------------------

      // (A) Load old matches
      let oldMatches = [];
      if (
        analysis.bankReconciliation &&
        Array.isArray(analysis.bankReconciliation.matches)
      ) {
        oldMatches = analysis.bankReconciliation.matches;
      }

      // (B) Make a set of old matched bankStatement IDs
      const oldMatchedIds = new Set(
        oldMatches.map((m) => m.bankStatement?._id?.toString())
      );

      // (C) Filter new matches so we don't double-match the same statement
      const newUniqueMatches = [];
      for (const nm of allBankMatches) {
        const bankId = nm.bankStatement?._id?.toString();
        if (!oldMatchedIds.has(bankId)) {
          newUniqueMatches.push(nm);
        }
      }

      // (D) Final merged array
      const mergedAllMatches = [...oldMatches, ...newUniqueMatches];

      // (E) Rebuild allDiscrepancies to exclude matched ones
      const matchedBankIds = new Set(
        mergedAllMatches.map((m) => m.bankStatement._id.toString())
      );
      const finalAllDiscrepancies = allBankStatements
        .filter((stmt) => !matchedBankIds.has(stmt._id.toString()))
        .map((stmt) => ({
          bankStatement: stmt,
          status: "unresolved",
          amount: stmt.amount,
          date: stmt.operationDate,
        }));

      // (F) Rebuild filtered sets from the mergedAllMatches, finalAllDiscrepancies
      const mergedFilteredMatches = [];
      const mergedFilteredDiscrepancies = [];

      if (dateRange) {
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);

        // Filter mergedAllMatches
        for (const m of mergedAllMatches) {
          const d = new Date(m.bankStatement.operationDate);
          if (d >= startDate && d <= endDate) {
            mergedFilteredMatches.push(m);
          }
        }
        // Filter finalAllDiscrepancies
        for (const dd of finalAllDiscrepancies) {
          const dateD = new Date(dd.bankStatement.operationDate);
          if (dateD >= startDate && dateD <= endDate) {
            mergedFilteredDiscrepancies.push(dd);
          }
        }
      } else {
        // No dateRange => all
        mergedFilteredMatches.push(...mergedAllMatches);
        mergedFilteredDiscrepancies.push(...finalAllDiscrepancies);
      }

      // (G) Build updated summary for merged filtered sets
      const mergedFilteredSummary = {
        totalTransactions: filteredBankStatements.length,
        matchedCount: mergedFilteredMatches.length,
        unmatchedCount: mergedFilteredDiscrepancies.length,
        totalAmount: filteredBankStatements.reduce(
          (sum, stmt) => sum + stmt.amount,
          0
        ),
        matchedAmount: mergedFilteredMatches.reduce(
          (sum, match) => sum + match.amount,
          0
        ),
      };

      // ----------------------------------------------------------------
      // 11) Finally, save everything back into analysis.bankReconciliation
      // ----------------------------------------------------------------
      analysis.bankReconciliation = {
        matches: mergedAllMatches,
        discrepancies: finalAllDiscrepancies,
        summary: mergedFilteredSummary,
        lastUpdated: new Date(),
        allDataSummary, // optional
        filteredMatches: mergedFilteredMatches, // optional
        filteredDiscrepancies: mergedFilteredDiscrepancies, // optional
      };

      await analysis.save();

      // ----------------------------------------------------------------
      // 12) Respond with the arrays your frontend needs
      // ----------------------------------------------------------------
      return res.json({
        // Merged final arrays (for entire DB range)
        allMatches: mergedAllMatches,
        allDiscrepancies: finalAllDiscrepancies,
        // Merged filtered arrays (for date range, if any)
        filteredMatches: mergedFilteredMatches,
        filteredDiscrepancies: mergedFilteredDiscrepancies,
        // Summaries
        summary: mergedFilteredSummary,
        allDataSummary,
      });
    } catch (error) {
      console.error("Bank reconciliation error:", error);
      return res.status(500).json({
        error: "Bank reconciliation failed: " + error.message,
      });
    }
  }

  static async resolveBankDiscrepancy(req, res) {
    try {
      const { analysisId, bankStatementId, resolution, matchedTransactions } =
        req.body;

      const analysis = await Analysis.findById(analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // Find the bank discrepancy
      const discrepancyIndex =
        analysis.bankReconciliation.discrepancies.findIndex(
          (d) => d.bankStatement._id.toString() === bankStatementId
        );

      if (discrepancyIndex === -1) {
        return res.status(404).json({ error: "Bank discrepancy not found" });
      }

      // Update the discrepancy
      analysis.bankReconciliation.discrepancies[discrepancyIndex] = {
        ...analysis.bankReconciliation.discrepancies[discrepancyIndex],
        status: "resolved",
        resolution,
        matchedTransactions,
        resolvedAt: new Date(),
      };

      // Update summary
      const summary = analysis.bankReconciliation.summary;
      summary.matchedCount++;
      summary.unmatchedCount--;
      summary.matchedAmount +=
        analysis.bankReconciliation.discrepancies[discrepancyIndex].amount;

      await analysis.save();

      res.json({
        success: true,
        discrepancy:
          analysis.bankReconciliation.discrepancies[discrepancyIndex],
        summary,
      });
    } catch (error) {
      console.error("Error resolving bank discrepancy:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async updateBankMatchStatus(req, res) {
    try {
      const { analysisId, matchId, status, notes } = req.body;

      const analysis = await Analysis.findById(analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // Find and update the match
      const matchIndex = analysis.bankReconciliation.matches.findIndex(
        (m) => m._id.toString() === matchId
      );

      if (matchIndex === -1) {
        return res.status(404).json({ error: "Match not found" });
      }

      analysis.bankReconciliation.matches[matchIndex] = {
        ...analysis.bankReconciliation.matches[matchIndex],
        status,
        notes,
        updatedAt: new Date(),
      };

      await analysis.save();

      res.json({
        success: true,
        match: analysis.bankReconciliation.matches[matchIndex],
      });
    } catch (error) {
      console.error("Error updating bank match status:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async getAnalysisStats(req, res) {
    try {
      const { analysisId } = req.params;

      // 1) Load the Analysis
      const analysis = await Analysis.findById(analysisId).lean();
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // 2) Gather all invoice IDs from the analysis
      //    For example, from sapDiscrepancies, extendedSapDiscrepancies, etc.
      const sapInvoiceIds = (analysis.sapDiscrepancies || []).map(
        (inv) => inv._id
      );
      const extendedInvoiceIds = (analysis.extendedSapDiscrepancies || []).map(
        (inv) => inv._id
      );

      // If you also store invoice IDs inside "matches" or "excelDiscrepancies.matchedInvoices",
      // you can similarly gather them. Example:
      /*
      const matches = analysis.matches || new Map();
      for (const [category, transactions] of matches.entries()) {
        transactions.forEach((t) => {
          // If you store the invoice _id in matched transactions, push it into array
          // But your TransactionSchema doesn't show an _id for the SAP invoice. 
          // If you do store it, do something like:
          if (t.sapInvoiceId) allInvoiceIds.push(t.sapInvoiceId);
        });
      }
      */

      // Combine and remove duplicates
      const invoiceIds = [
        ...new Set([...sapInvoiceIds, ...extendedInvoiceIds]),
      ];
      if (invoiceIds.length === 0) {
        // If we have no invoices associated, return empty stats
        return res.json({
          invoiceCount: 0,
          totalRevenue: 0,
          topCustomers: [],
          topProducts: [],
          paymentMethodBreakdown: [],
          averageInvoiceValue: 0,
          minInvoiceValue: 0,
          maxInvoiceValue: 0,
          monthlySales: [],
          weeklySales: [],
          docCurrencyBreakdown: [],
          // ... any other stats you want to default
        });
      }

      // 3) Fetch all relevant invoices from DB
      const invoices = await Invoice.find({ _id: { $in: invoiceIds } }).lean();

      // 4) Now we do the aggregator logic
      let invoiceCount = 0;
      let totalRevenue = 0;

      // For "Top Customers"
      const customerTotals = {}; // { [customerName]: sumOfDocTotal }
      // For "Top Products"
      const productTotals = {}; // { [ItemCode or ItemDescription]: sumOfLineTotal }
      // Payment method breakdown
      const paymentMethodTotals = {}; // { [paymentMethod]: sumOfDocTotal }
      // Summaries for min, max, average
      let minInvoiceValue = Number.POSITIVE_INFINITY;
      let maxInvoiceValue = Number.NEGATIVE_INFINITY;
      // For sales by date, month, week, currency, etc.
      const monthlySalesMap = {}; // { YYYY-MM: totalAmount }
      const weeklySalesMap = {}; // { "YYYY-WW": totalAmount } (ISO week style or custom)
      const currencyTotals = {}; // { [DocCurrency]: sumOfDocTotal }

      invoices.forEach((inv) => {
        invoiceCount += 1;

        const docTotal = inv.DocTotal || 0;
        totalRevenue += docTotal;

        // Track min / max
        if (docTotal < minInvoiceValue) {
          minInvoiceValue = docTotal;
        }
        if (docTotal > maxInvoiceValue) {
          maxInvoiceValue = docTotal;
        }

        // 4.1) **Customer Totals**
        const custName = inv.CardName || "Unknown Customer";
        if (!customerTotals[custName]) customerTotals[custName] = 0;
        customerTotals[custName] += docTotal;

        // 4.2) **Payment Method** from your custom invoice field
        const payMethod = inv.paymentMethod || "Unknown";
        if (!paymentMethodTotals[payMethod]) paymentMethodTotals[payMethod] = 0;
        paymentMethodTotals[payMethod] += docTotal;

        // 4.3) **Currency** breakdown
        const currency = inv.DocCurrency || "Local";
        if (!currencyTotals[currency]) currencyTotals[currency] = 0;
        currencyTotals[currency] += docTotal;

        // 4.4) **Monthly sales** (by year-month)
        // e.g. "2024-02" => $ sum
        const dateObj = inv.DocDate ? new Date(inv.DocDate) : null;
        if (dateObj) {
          const yyyy = dateObj.getFullYear();
          const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
          const monthKey = `${yyyy}-${mm}`;
          if (!monthlySalesMap[monthKey]) {
            monthlySalesMap[monthKey] = 0;
          }
          monthlySalesMap[monthKey] += docTotal;

          // 4.5) **Weekly sales** (ISO week or custom)
          // This example uses ISO week number
          const firstThursday = new Date(dateObj.getFullYear(), 0, 4);
          const dayOfYear =
            (dateObj - new Date(dateObj.getFullYear(), 0, 1) + 86400000) /
            86400000;
          // Calculate the ISO week (simplified approach, there are more robust formulas)
          const weekNum = Math.ceil(
            (dayOfYear + firstThursday.getDay() + 1) / 7
          );
          const weekKey = `${yyyy}-W${String(weekNum).padStart(2, "0")}`;
          if (!weeklySalesMap[weekKey]) {
            weeklySalesMap[weekKey] = 0;
          }
          weeklySalesMap[weekKey] += docTotal;
        }

        // 4.6) **Top Products** from the DocumentLines array
        if (Array.isArray(inv.DocumentLines)) {
          inv.DocumentLines.forEach((line) => {
            const lineTotal = line.LineTotal || 0;
            const productName =
              line.ItemDescription || line.ItemCode || "Unknown";
            if (!productTotals[productName]) {
              productTotals[productName] = 0;
            }
            productTotals[productName] += lineTotal;
          });
        }
      });

      // 5) Convert aggregated objects into sorted arrays for the frontend

      // 5.1) **Top Customers**: sort by total desc, pick top 10
      const topCustomers = Object.entries(customerTotals)
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // 5.2) **Top Products**: sort by total desc, pick top 10
      const topProducts = Object.entries(productTotals)
        .map(([product, total]) => ({ product, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // 5.3) Payment methods -> array
      const paymentMethodBreakdown = Object.entries(paymentMethodTotals).map(
        ([method, total]) => ({ method, total })
      );

      // 5.4) Currency breakdown -> array
      const docCurrencyBreakdown = Object.entries(currencyTotals).map(
        ([currency, total]) => ({ currency, total })
      );

      // 5.5) Monthly sales -> array, sorted by month
      const monthlySales = Object.entries(monthlySalesMap)
        .map(([month, total]) => ({ month, total }))
        .sort((a, b) => (a.month > b.month ? 1 : -1));

      // 5.6) Weekly sales -> array, sorted by weekKey
      const weeklySales = Object.entries(weeklySalesMap)
        .map(([week, total]) => ({ week, total }))
        .sort((a, b) => (a.week > b.week ? 1 : -1));

      // 6) Additional summary stats
      const averageInvoiceValue =
        invoiceCount > 0 ? totalRevenue / invoiceCount : 0;
      if (minInvoiceValue === Number.POSITIVE_INFINITY) minInvoiceValue = 0;
      if (maxInvoiceValue === Number.NEGATIVE_INFINITY) maxInvoiceValue = 0;

      // 7) Return the result as JSON
      return res.json({
        invoiceCount,
        totalRevenue,
        averageInvoiceValue,
        minInvoiceValue,
        maxInvoiceValue,
        topCustomers,
        topProducts,
        paymentMethodBreakdown,
        docCurrencyBreakdown,
        monthlySales,
        weeklySales,
        // If you want to include POS analysis from analysis.posAnalysis, feel free
        posAnalysis: analysis.posAnalysis || null,
        // And you can add any other aggregated stats here...
      });
    } catch (error) {
      console.error("Error in getAnalysisStats:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  static async getMatchedStats(req, res) {
    try {
      const { analysisId } = req.params;

      // 1) Load analysis
      const analysis = await Analysis.findById(analysisId).lean();
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // 2) Flatten matches
      const matchesMap = analysis.matches || {};
      let allMatches = [];
      for (const [category, txns] of Object.entries(matchesMap)) {
        for (const txn of txns) {
          allMatches.push(txn);
        }
      }

      // (Optional) filter by overall dateRange
      const startDate = new Date(analysis.dateRange.start);
      const endDate = new Date(analysis.dateRange.end);

      allMatches = allMatches.filter((tx) => {
        if (!tx.date) return false;
        const txDate = new Date(tx.date);
        return txDate >= startDate && txDate <= endDate;
      });

      if (!allMatches.length) {
        // No matched tx in date range, return empty
        return res.json({
          invoiceCount: 0,
          totalRevenue: 0,
          averageInvoiceValue: 0,
          minInvoiceValue: 0,
          maxInvoiceValue: 0,
          topCustomers: [],
          topProducts: [],
          paymentMethodBreakdown: [],
          docCurrencyBreakdown: [],
          monthlySales: [],
          weeklySales: [],
        });
      }

      /**
       * 3) For each matched transaction T:
       *    - We do a "best-match" invoice search:
       *      (a) CardName == T.sapCustomer
       *      (b) DocDate in [T.date - 100 days, T.date + 100 days]
       *    Then pick the invoice that has closest DocTotal to T.sapAmount
       */

      // We'll collect found invoice IDs in a set
      const matchedInvoiceIds = new Set();

      for (const tx of allMatches) {
        // If no sapCustomer or date, skip
        if (!tx.sapCustomer || !tx.date) continue;

        // ±100 days from tx.date
        const txDate = new Date(tx.date);
        const extendedStart = new Date(txDate);
        extendedStart.setDate(extendedStart.getDate() - 100);
        const extendedEnd = new Date(txDate);
        extendedEnd.setDate(extendedEnd.getDate() + 100);

        // We'll do a single DB query for invoices with CardName == tx.sapCustomer
        // and DocDate in [extendedStart, extendedEnd]
        // Then pick the one whose DocTotal is "closest" to tx.sapAmount
        // or within some tolerance, e.g. ±5% or ±some fixed value.

        // a) Simple find
        const candidateInvoices = await Invoice.find({
          CardName: tx.sapCustomer,
          DocDate: { $gte: extendedStart, $lte: extendedEnd },
        }).lean();

        if (!candidateInvoices.length) {
          continue; // no candidate found
        }

        // b) Pick best by docTotal closeness
        let bestInvoice = null;
        let bestDiff = Infinity;
        for (const inv of candidateInvoices) {
          // The difference between tx.sapAmount and inv.DocTotal
          const amtDiff = Math.abs((tx.sapAmount || 0) - (inv.DocTotal || 0));
          // e.g., if we want to require a tolerance, like ±10%,
          //   const tolerance = inv.DocTotal * 0.10;
          //   if (amtDiff <= tolerance && amtDiff < bestDiff) ...
          // But let's just pick the closest one, no strict cut-off:
          if (amtDiff < bestDiff) {
            bestDiff = amtDiff;
            bestInvoice = inv;
          }
        }

        if (bestInvoice) {
          matchedInvoiceIds.add(bestInvoice._id.toString());
        }
      }

      if (!matchedInvoiceIds.size) {
        // None of the matched transactions had a matching invoice
        return res.json({
          invoiceCount: 0,
          totalRevenue: 0,
          averageInvoiceValue: 0,
          minInvoiceValue: 0,
          maxInvoiceValue: 0,
          topCustomers: [],
          topProducts: [],
          paymentMethodBreakdown: [],
          docCurrencyBreakdown: [],
          monthlySales: [],
          weeklySales: [],
        });
      }

      // 4) Aggregate stats from the found invoices
      const invoiceIdsArray = Array.from(matchedInvoiceIds).map(
        (id) =>
          // Convert to mongoose ObjectId if needed
          // new mongoose.Types.ObjectId(id)
          id
      );

      // fetch them from DB
      const matchedInvoices = await Invoice.find({
        _id: { $in: invoiceIdsArray },
      }).lean();

      // 5) aggregator logic
      let invoiceCount = 0;
      let totalRevenue = 0;
      let minInvoiceValue = Number.POSITIVE_INFINITY;
      let maxInvoiceValue = Number.NEGATIVE_INFINITY;

      // for "top customers"
      const customerTotals = {};
      // for "top products"
      const productTotals = {};
      // payment method
      const paymentMethodTotals = {};
      // currency
      const currencyTotals = {};
      // monthly / weekly
      const monthlySalesMap = {};
      const weeklySalesMap = {};

      matchedInvoices.forEach((inv) => {
        invoiceCount += 1;
        const docTotal = inv.DocTotal || 0;
        totalRevenue += docTotal;

        if (docTotal < minInvoiceValue) minInvoiceValue = docTotal;
        if (docTotal > maxInvoiceValue) maxInvoiceValue = docTotal;

        // Customer
        const custName = inv.CardName || "Unknown Customer";
        if (!customerTotals[custName]) customerTotals[custName] = 0;
        customerTotals[custName] += docTotal;

        // Payment method
        const payMethod = inv.paymentMethod || "Unknown";
        if (!paymentMethodTotals[payMethod]) paymentMethodTotals[payMethod] = 0;
        paymentMethodTotals[payMethod] += docTotal;

        // Currency
        const ccy = inv.DocCurrency || "Local";
        if (!currencyTotals[ccy]) currencyTotals[ccy] = 0;
        currencyTotals[ccy] += docTotal;

        // monthly / weekly
        if (inv.DocDate) {
          const d = new Date(inv.DocDate);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const monthKey = `${yyyy}-${mm}`;
          if (!monthlySalesMap[monthKey]) monthlySalesMap[monthKey] = 0;
          monthlySalesMap[monthKey] += docTotal;

          // approx week
          const startOfYear = new Date(yyyy, 0, 1);
          const dayOfYear = Math.floor((d - startOfYear) / 86400000) + 1;
          const weekNum = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);
          const weekKey = `${yyyy}-W${String(weekNum).padStart(2, "0")}`;
          if (!weeklySalesMap[weekKey]) weeklySalesMap[weekKey] = 0;
          weeklySalesMap[weekKey] += docTotal;
        }

        // top products from DocumentLines
        if (Array.isArray(inv.DocumentLines)) {
          inv.DocumentLines.forEach((line) => {
            const lineTotal = line.LineTotal || 0;
            const prodName = line.ItemDescription || line.ItemCode || "Unknown";
            if (!productTotals[prodName]) productTotals[prodName] = 0;
            productTotals[prodName] += lineTotal;
          });
        }
      });

      if (minInvoiceValue === Number.POSITIVE_INFINITY) minInvoiceValue = 0;
      if (maxInvoiceValue === Number.NEGATIVE_INFINITY) maxInvoiceValue = 0;
      const averageInvoiceValue =
        invoiceCount > 0 ? totalRevenue / invoiceCount : 0;

      // convert objects to arrays
      const topCustomers = Object.entries(customerTotals)
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      const topProducts = Object.entries(productTotals)
        .map(([product, total]) => ({ product, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      const paymentMethodBreakdown = Object.entries(paymentMethodTotals).map(
        ([method, total]) => ({ method, total })
      );

      const docCurrencyBreakdown = Object.entries(currencyTotals).map(
        ([currency, total]) => ({ currency, total })
      );

      const monthlySales = Object.entries(monthlySalesMap)
        .map(([month, total]) => ({ month, total }))
        .sort((a, b) => (a.month > b.month ? 1 : -1));

      const weeklySales = Object.entries(weeklySalesMap)
        .map(([week, total]) => ({ week, total }))
        .sort((a, b) => (a.week > b.week ? 1 : -1));

      // 6) Return stats
      return res.json({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        invoiceCount,
        totalRevenue,
        averageInvoiceValue,
        minInvoiceValue,
        maxInvoiceValue,
        topCustomers,
        topProducts,
        paymentMethodBreakdown,
        docCurrencyBreakdown,
        monthlySales,
        weeklySales,
      });
    } catch (error) {
      console.error("Error in getMatchedStats:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  static async checkInvoiceResolutions(req, res) {
    try {
      const { analysisId } = req.body;

      // Get the original analysis to get the SAP discrepancies
      const analysis = await Analysis.findById(analysisId).lean();
      if (!analysis || !analysis.sapDiscrepancies) {
        return res
          .status(404)
          .json({ error: "Analysis or SAP discrepancies not found" });
      }

      const sapDiscrepancies = analysis.sapDiscrepancies;

      // Get date range for all discrepancies
      const dates = sapDiscrepancies.map((inv) => new Date(inv.DocDate));
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));
      minDate.setDate(minDate.getDate() - 70);
      maxDate.setDate(maxDate.getDate() + 70);

      // Find all analyses that might contain matches
      const analyses = await Analysis.find({
        _id: { $ne: analysisId }, // Exclude current analysis
        $and: [
          {
            $or: [
              { "matches.Resolved and Matched": { $exists: true } },
              { "matches.Chèques": { $exists: true } },
              { "matches.Espèces": { $exists: true } },
              { "matches.CB Site": { $exists: true } },
              { "matches.CB Téléphone": { $exists: true } },
              { "matches.Virements": { $exists: true } },
            ],
          },
          {
            "dateRange.start": { $gte: minDate },
            "dateRange.end": { $lte: maxDate },
          },
        ],
      }).lean();

      console.log("Found analyses:", analyses.length);

      // Create resolution map
      const resolutionMap = {};

      // Process each analysis
      analyses.forEach((existingAnalysis) => {
        if (!existingAnalysis.matches) return;

        Object.entries(existingAnalysis.matches).forEach(
          ([category, transactions]) => {
            transactions.forEach((transaction) => {
              sapDiscrepancies.forEach((invoice) => {
                const key = `${invoice.DocNum}-${invoice.CardName}`;

                // Skip if already found in a more recent analysis
                if (
                  resolutionMap[key] &&
                  new Date(existingAnalysis.dateRange.start) <=
                    new Date(resolutionMap[key].analysisDate)
                ) {
                  return;
                }

                if (
                  (transaction.docNum &&
                    transaction.docNum === invoice.DocNum) ||
                  (transaction.sapCustomer === invoice.CardName &&
                    Math.abs(transaction.sapAmount - invoice.DocTotal) < 0.01 &&
                    Math.abs(
                      new Date(transaction.date) - new Date(invoice.DocDate)
                    ) <
                      70 * 24 * 60 * 60 * 1000)
                ) {
                  resolutionMap[key] = {
                    resolved: true,
                    analysisId: existingAnalysis._id,
                    analysisDate: existingAnalysis.dateRange.start,
                    resolution:
                      transaction.resolution || "Matched in another analysis",
                    category,
                    matchDetails: {
                      docNum: transaction.docNum,
                      amount: transaction.sapAmount,
                      date: transaction.date,
                    },
                  };
                }
              });
            });
          }
        );
      });

      res.json({ resolutions: resolutionMap });
    } catch (error) {
      console.error("Error checking invoice resolutions:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async matchToBank(req, res) {
    try {
      const { analysisId, bankStatement, excelMatch, resolution, date } =
        req.body;

      // Find the analysis
      const analysis = await Analysis.findById(analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // Create the match
      const match = {
        bankStatement,
        matchedTransaction: {
          ...excelMatch,
          sapCustomer: excelMatch.sapCustomer,
          sapAmount: excelMatch.sapAmount,
          date: date || excelMatch.date,
          category: excelMatch.category,
        },
        matchSource: "excel",
        matchType: "manual",
        confidence: "high", // Since it's manually matched
        status: "confirmed",
        resolution,
        date: date || excelMatch.date,
        amount: bankStatement.amount,
      };

      // Add to matches array if it doesn't exist
      if (!analysis.bankReconciliation) {
        analysis.bankReconciliation = {
          matches: [],
          discrepancies: [],
          summary: {
            totalTransactions: 0,
            matchedCount: 0,
            unmatchedCount: 0,
            totalAmount: 0,
            matchedAmount: 0,
          },
          lastUpdated: new Date(),
        };
      }

      // Add the new match
      if (!analysis.bankReconciliation.matches) {
        analysis.bankReconciliation.matches = [];
      }
      console.log("Adding match", match);
      analysis.bankReconciliation.matches.push(match);
      console.log("Added");

      // Remove from discrepancies if it exists
      if (analysis.bankReconciliation.discrepancies) {
        analysis.bankReconciliation.discrepancies =
          analysis.bankReconciliation.discrepancies.filter(
            (d) =>
              d.bankStatement._id.toString() !== bankStatement._id.toString()
          );
      }

      // Update the summary
      analysis.bankReconciliation.summary.matchedCount++;
      analysis.bankReconciliation.summary.unmatchedCount--;
      analysis.bankReconciliation.summary.matchedAmount += bankStatement.amount;
      analysis.bankReconciliation.lastUpdated = new Date();

      // Mark as modified since we're updating nested objects
      analysis.markModified("bankReconciliation");

      // Save the analysis
      await analysis.save();

      res.json({
        success: true,
        match,
        summary: analysis.bankReconciliation.summary,
      });
    } catch (error) {
      console.error("Error matching to bank:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async resolveSAPDiscrepancy(req, res) {
    try {
      const { analysisId, sapInvoiceId, resolution, matchedTransactions } =
        req.body;

      const analysis = await Analysis.findById(analysisId);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }

      // Find the SAP discrepancy to resolve
      const discrepancyIndex = analysis.sapDiscrepancies.findIndex(
        (d) => d._id.toString() === sapInvoiceId
      );

      if (discrepancyIndex === -1) {
        return res.status(404).json({ error: "SAP discrepancy not found" });
      }

      // Get the original discrepancy
      const originalDiscrepancy = analysis.sapDiscrepancies[discrepancyIndex];

      // Update the selected Excel transactions as verified
      for (const match of matchedTransactions) {
        if (match.originalEntry) {
          // Find the sale document
          const sale = await Sale.findOne({ date: match.date });
          if (sale) {
            // Update the verified status based on category
            if (match.category.startsWith("POS")) {
              // Handle POS categories
              const posCategory = {
                "POS CB": "Caisse CB",
                "POS Espèces": "Caisse Espèces",
                "POS Chèques": "Caisse chèques",
              }[match.category];

              const entryIndex = sale.POS[posCategory].findIndex(
                (e) => e.client === match.client && e.amount === match.amount
              );
              if (entryIndex !== -1) {
                sale.POS[posCategory][entryIndex].verified = true;
              }
            } else {
              // Handle regular categories
              const entryIndex = sale[match.category].findIndex(
                (e) =>
                  e.client === match.client &&
                  (e.amount === match.amount || e.bank === match.amount)
              );
              if (entryIndex !== -1) {
                sale[match.category][entryIndex].verified = true;
              }
            }
            await sale.save();
          }
        }
      }

      // Update the discrepancy with resolution info AND include matched SAP invoice
      analysis.sapDiscrepancies[discrepancyIndex] = {
        // Keep all original SAP invoice fields
        DocDate: originalDiscrepancy.DocDate,
        CardName: originalDiscrepancy.CardName,
        DocTotal: originalDiscrepancy.DocTotal,
        CardCode: originalDiscrepancy.CardCode,
        U_EPOSNo: originalDiscrepancy.U_EPOSNo,
        DocNum: originalDiscrepancy.DocNum,
        _id: originalDiscrepancy._id,
        source: originalDiscrepancy.source || "sap",

        // Add resolution fields
        resolved: true,
        resolution,
        resolvedTimestamp: new Date(),
        matchedTransactions: [
          // Include the SAP invoice details
          {
            date: originalDiscrepancy.DocDate,
            client: originalDiscrepancy.CardName,
            amount: originalDiscrepancy.DocTotal,
            docNum: originalDiscrepancy.DocNum,
            category: "SAP Invoice",
            type: "sap",
            remarks: resolution || "",
          },
          // Then include the Excel matches
          ...matchedTransactions.map((tx) => ({
            date: tx.date,
            client: tx.client,
            amount: Number(tx.amount),
            category: tx.category,
            type: "excel",
            remarks: tx.remarks || "",
          })),
        ],
      };

      // Create new matches
      const newMatches = matchedTransactions.map((tx) => ({
        date: new Date(tx.date),
        excelClient: tx.client,
        sapCustomer: originalDiscrepancy.CardName,
        excelAmount: Number(tx.amount),
        sapAmount: Number(originalDiscrepancy.DocTotal),
        category: tx.category,
        remarks: tx.remarks || "",
        docNum: originalDiscrepancy.DocNum,
        docDate: originalDiscrepancy.DocDate,
        isResolved: true,
        resolution,
        type: "sap_to_excel",
      }));

      // Update matches Map
      let matchesMap = analysis.matches;
      if (!(matchesMap instanceof Map)) {
        matchesMap = new Map(Object.entries(analysis.matches));
      }

      const resolvedCategory = "SAP Resolved Matches";
      const resolvedMatches = matchesMap.get(resolvedCategory) || [];
      resolvedMatches.push(...newMatches);
      matchesMap.set(resolvedCategory, resolvedMatches);

      // Update analysis document
      analysis.matches = matchesMap;

      analysis.markModified("matches");
      analysis.markModified("sapDiscrepancies");

      await analysis.save();

      res.json({
        success: true,
        matches: Array.from(matchesMap.get(resolvedCategory) || []),
        sapDiscrepancies: analysis.sapDiscrepancies,
      });
    } catch (error) {
      console.error("Error resolving SAP discrepancy:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async findPotentialExcelMatches(sapInvoice) {
    try {
      // Calculate date range (±20 days)
      const sapDate = new Date(sapInvoice.DocDate);
      const startDate = new Date(sapDate);
      const endDate = new Date(sapDate);
      startDate.setDate(startDate.getDate() - 20);
      endDate.setDate(endDate.getDate() + 20);

      // Fetch sales data within the date range
      const salesData = await Sale.find({
        date: {
          $gte: startDate,
          $lte: endDate,
        },
      }).sort({ date: 1 });

      const potentialMatches = [];

      // Helper function to process each entry
      const processEntry = (entry, category, date) => {
        // Skip if this is a total entry
        if (
          entry.client?.toLowerCase() === "total" ||
          entry.client?.toLowerCase() === "client" ||
          entry.client === "TOTAL ESPECES" ||
          entry.client === "TOTAL CHEQUES" ||
          entry.client === "TOTAL CB Internet & Phone"
        ) {
          return;
        }

        // Calculate amount difference
        const amount = entry.bank || entry.amount || 0;
        const amountDiff = Math.abs(amount - sapInvoice.DocTotal);
        const amountTolerance = sapInvoice.DocTotal * 0.3; // 10% tolerance

        if (amountDiff <= amountTolerance) {
          // Calculate name similarity
          const similarity = stringSimilarity.compareTwoStrings(
            AnalysisController.normalizeCompanyName(entry.client),
            AnalysisController.normalizeCompanyName(sapInvoice.CardName)
          );

          potentialMatches.push({
            date,
            client: entry.client,
            amount,
            category,
            remarks: entry.remarks || "",
            similarity,
            originalEntry: entry,
          });
        }
      };

      // Process each day's data
      salesData.forEach((dayData) => {
        // Process regular payment categories
        const categories = [
          "Paiements Chèques",
          "Paiements Espèces",
          "Paiements CB Site",
          "Paiements CB Téléphone",
          "Virements",
          "Livraisons non payées",
        ];

        categories.forEach((category) => {
          if (Array.isArray(dayData[category])) {
            dayData[category].forEach((entry) =>
              processEntry(entry, category, dayData.date)
            );
          }
        });

        // Process POS categories
        if (dayData.POS) {
          const posCategories = {
            "Caisse CB": "POS CB",
            "Caisse Espèces": "POS Espèces",
            "Caisse chèques": "POS Chèques",
          };

          Object.entries(posCategories).forEach(([key, category]) => {
            if (Array.isArray(dayData.POS[key])) {
              dayData.POS[key].forEach((entry) =>
                processEntry(entry, category, dayData.date)
              );
            }
          });
        }
      });

      // Sort by similarity and amount difference, then return top matches
      return potentialMatches
        .sort((a, b) => {
          if (Math.abs(b.similarity - a.similarity) < 0.6) {
            // If similarities are close, prefer closer amounts
            const aDiff = Math.abs(a.amount - sapInvoice.DocTotal);
            const bDiff = Math.abs(b.amount - sapInvoice.DocTotal);
            return aDiff - bDiff;
          }
          return b.similarity - a.similarity;
        })
        .slice(0, 5); // Return top 5 matches
    } catch (error) {
      console.error("Error finding potential Excel matches:", error);
      return [];
    }
  }

  static async findPotentialExcelMatchesForSAP(req, res) {
    try {
      const { analysisId, sapInvoiceId } = req.body;

      const analysis = await Analysis.findById(analysisId);
      if (!analysis) {
        console.log("SAP analysis not found");

        return res.status(404).json({ error: "Analysis not found" });
      }

      // Find the SAP invoice
      const sapInvoice = analysis.sapDiscrepancies.find(
        (d) => d._id.toString() === sapInvoiceId
      );

      if (!sapInvoice) {
        console.log("SAP invoice not found");
        return res.status(404).json({ error: "SAP invoice not found" });
      }

      // Get potential matches
      const potentialMatches =
        await AnalysisController.findPotentialExcelMatches(sapInvoice);

      res.json({ potentialMatches });
    } catch (error) {
      console.error("Error finding potential matches:", error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = AnalysisController;
