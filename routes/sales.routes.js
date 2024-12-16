// routes/sales.routes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const Sale = require("../models/sales.model");
const upload = multer({ storage: multer.memoryStorage() });

// Upload Excel file
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const worksheet = workbook.Sheets["TOTAL"];

    // Configure the header row and start row
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      raw: false, // Changed to false to get formatted values
      dateNF: "DD/MM/YYYY", // Specify date format
      range: 1,
    });

    // Transform and save data
    const salesData = jsonData.map((row) => {
      // Helper function to clean numbers
      const cleanNumber = (value) => {
        if (!value || value === "-" || value === "€ -") return 0;
        if (typeof value === "string") {
          return (
            parseFloat(value.replace("€", "").replace(",", ".").trim()) || 0
          );
        }
        return parseFloat(value) || 0;
      };

      // Convert Excel date number to JS Date
      const excelDateToJSDate = (excelDate) => {
        if (!excelDate) return new Date();

        // If it's already a date string, parse it
        if (typeof excelDate === "string") {
          const parts = excelDate.split("/");
          if (parts.length === 3) {
            return new Date(parts[2], parts[1] - 1, parts[0]);
          }
        }

        // If it's an Excel date number
        const unixTimestamp = (excelDate - 25569) * 86400 * 1000;
        return new Date(unixTimestamp);
      };

      // Log the raw date value for debugging
      console.log("Raw date value:", row.DATE);

      return {
        date: excelDateToJSDate(row.DATE),
        ventePlace: {
          esp: cleanNumber(row.ESPECE),
          chq: cleanNumber(row.CHEQUE),
          cb: cleanNumber(row.cb),
          depense: cleanNumber(row.depense),
        },
        venteLivraison: {
          virement: cleanNumber(row.VIREMENT),
        },
      };
    });

    // Filter out any invalid entries
    const validSalesData = salesData.filter(
      (sale) =>
        sale.date instanceof Date &&
        !isNaN(sale.date) && // Check if date is valid
        (sale.ventePlace.esp !== 0 ||
          sale.ventePlace.chq !== 0 ||
          sale.ventePlace.cb !== 0 ||
          sale.venteLivraison.virement !== 0)
    );

    // Log the processed data for debugging
    console.log("First few processed entries:", validSalesData.slice(0, 3));

    const existingDates = await Sale.find({
      date: {
        $in: validSalesData.map((sale) => sale.date),
      },
    });

    // Filter out sales data that already exists
    const newSalesData = validSalesData.filter(
      (newSale) =>
        !existingDates.some(
          (existingSale) =>
            existingSale.date.getTime() === newSale.date.getTime()
        )
    );

    if (newSalesData.length > 0) {
      await Sale.insertMany(newSalesData);
    }

    res.json({
      message: "Data uploaded successfully",
      count: newSalesData.length,
      skipped: validSalesData.length - newSalesData.length,
    });
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get sales by date range
router.get("/", async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = new Date(start);
    const endDate = new Date(end);

    const sales = await Sale.find({
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    }).sort({ date: 1 });

    res.json(sales);
  } catch (error) {
    console.error("Error fetching sales:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
