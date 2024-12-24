const stringSimilarity = require("string-similarity");
const Invoice = require("../models/invoice.model");
const Analysis = require("../models/analysis.model");
class AnalysisController {
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

      // Use the full date range for SAP data
      const startDate = new Date(dateRange.start);
      startDate.setDate(startDate.getDate() - 30);
      // set end date to be end date + 30 days
      const endDate = new Date(dateRange.end);
      endDate.setDate(endDate.getDate() + 50);
      startDate.setHours(0, 0, 0, 0); // Start of the day
      endDate.setHours(23, 59, 59, 999); // End of the day

      // Check if analysis already exists for this date range
      const existingAnalysis = await Analysis.findOne({
        "dateRange.start": startDate,
        "dateRange.end": endDate,
      });

      if (existingAnalysis) {
        // Return existing analysis
        return res.json({
          analysisId: existingAnalysis._id,
          matches: existingAnalysis.matches,
          excelDiscrepancies: existingAnalysis.excelDiscrepancies,
          sapDiscrepancies: existingAnalysis.sapDiscrepancies,
          posAnalysis: existingAnalysis.posAnalysis,
        });
      }

      // Fetch SAP invoices
      const sapData = await Invoice.find({
        DocDate: {
          $gte: startDate,
          $lte: endDate,
        },
      }).lean();

      console.log("Retrieved SAP Data:", sapData.length, "invoices");

      // Flatten Excel data
      const flattenedExcelData = [];
      excelData.forEach((dayData) => {
        const flattened = AnalysisController.flattenExcelData(dayData);
        flattenedExcelData.push(...flattened);
      });

      const matches = [];
      const excelDiscrepancies = [];
      const sapDiscrepancies = [...sapData];

      // Process regular transactions (excluding POS)
      for (const excelEntry of flattenedExcelData) {
        // Skip POS entries as we'll handle them separately
        if (excelEntry.isPOS) continue;

        let bestMatch = null;
        let bestScore = 0;
        let bestIndex = -1;

        sapData.forEach((sapEntry, index) => {
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

          if (dateDiff <= 3) {
            const amountDiff = Math.abs(excelEntry.amount - sapEntry.DocTotal);
            const amountTolerance = sapEntry.DocTotal * 0.01;

            if (amountDiff <= amountTolerance) {
              const similarity = stringSimilarity.compareTwoStrings(
                excelEntry.client.toLowerCase(),
                sapEntry.CardName.toLowerCase()
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

          sapDiscrepancies.splice(bestIndex, 1);
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
      const sapPOSSales = sapData.filter(
        (invoice) =>
          invoice.CardCode === "C9999" ||
          invoice.CardName?.toLowerCase().includes("comptoir") ||
          invoice.U_EPOSNo != null
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

      // In compareData method, update the analysis creation:
      const analysis = new Analysis({
        dateRange: {
          start: startDate,
          end: endDate,
        },
        // Add the matches map
        matches: groupedMatches,
        // Add excel discrepancies
        excelDiscrepancies: groupedExcelDiscrepancies,
        // Add SAP discrepancies
        sapDiscrepancies: sapDiscrepancies.filter(
          (invoice) =>
            !(
              invoice.CardCode === "C9999" ||
              invoice.CardName?.toLowerCase().includes("comptoir") ||
              invoice.U_EPOSNo != null
            )
        ),
        // Add complete POS analysis
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

      // Initialize the matches Map if empty
      if (!analysis.matches) {
        analysis.matches = new Map();
      }

      // Convert matches and discrepancies to Maps if they aren't already
      if (!(analysis.matches instanceof Map)) {
        analysis.matches = new Map(Object.entries(groupedMatches));
      }

      if (!(analysis.excelDiscrepancies instanceof Map)) {
        analysis.excelDiscrepancies = new Map(
          Object.entries(groupedExcelDiscrepancies)
        );
      }

      // Mark modified to ensure mongoose recognizes the Map changes
      analysis.markModified("matches");
      analysis.markModified("excelDiscrepancies");

      await analysis.save();

      res.json({
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

      const discrepancies = analysis.excelDiscrepancies.get(category);
      if (!discrepancies || !discrepancies[index]) {
        return res.status(404).json({ error: "Discrepancy not found" });
      }

      // Update the discrepancy with resolution details
      discrepancies[index].resolved = true;
      discrepancies[index].resolution = resolution;
      discrepancies[index].resolvedTimestamp = new Date();
      discrepancies[index].matchedInvoices = matchedInvoices;

      // Create a new match from the resolved discrepancy
      const newMatches = matchedInvoices.map((invoice) => ({
        date: discrepancies[index].date,
        excelClient: discrepancies[index].client,
        sapCustomer: invoice.sapCustomer,
        excelAmount: discrepancies[index].amount,
        sapAmount: invoice.sapAmount,
        category: discrepancies[index].category,
        remarks: discrepancies[index].remarks,
        docNum: invoice.docNum,
        docDate: invoice.docDate,
      }));

      // Add to matches
      const categoryMatches = analysis.matches.get(category) || [];
      categoryMatches.push(...newMatches);
      analysis.matches.set(category, categoryMatches);

      // Mark as modified since we're updating a Mixed type
      analysis.markModified("excelDiscrepancies");
      analysis.markModified("matches");

      await analysis.save();

      res.json({
        success: true,
        matches: analysis.matches.get(category),
        discrepancies: analysis.excelDiscrepancies.get(category),
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
