const stringSimilarity = require("string-similarity");
const Invoice = require("../models/invoice.model");
const Analysis = require("../models/analysis.model");
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

      // Fetch SAP invoices for extended date range
      const allSapData = await Invoice.find({
        DocDate: {
          $gte: extendedStartDate,
          $lte: extendedEndDate,
        },
      }).lean();

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
      // Create new analysis document
      const analysis = new Analysis({
        dateRange: {
          start: selectedStartDate,
          end: selectedEndDate,
        },
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

  // Add to AnalysisController.js
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
}

module.exports = AnalysisController;
