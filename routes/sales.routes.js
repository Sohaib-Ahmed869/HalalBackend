const express = require("express");
const router = express.Router();
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const Sale = require("../models/sales.model");
const upload = multer({ storage: multer.memoryStorage() });

const FLASK_BACKEND_URL = "http://127.0.0.1:5000/process_excel";

// Function to transform data into desired schema
const transformData = (dayData, date) => {
  return {
    date,
    "Paiements Chèques": dayData["Paiements Chèques"] || [],
    "Paiements Espèces": dayData["Paiements Espèces"] || [],
    "Paiements CB Site": dayData["Paiements CB Site"] || [],
    "Paiements CB Téléphone": dayData["Paiements CB Téléphone"] || [],
    Virements: dayData["Virements"] || [],
    "Livraisons non payées": dayData["Livraisons non payées"] || [],
    POS: {
      "Caisse Espèces": dayData.POS["Caisse Espèces"] || [],
      "Caisse chèques": dayData.POS["Caisse chèques"] || [],
      "Caisse CB": dayData.POS["Caisse CB"] || [],
    },
  };
};

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    console.log("Processing file...");
    const { start, end } = req.query;
    console.log("Start date:", start);
    console.log("End date:", end);
    if (!start || !end) {
      console.log("Start and end dates are required");
      return res.status(400).json({
        error:
          "Start and end dates are required, e.g. ?start=YYYY-MM-DD&end=YYYY-MM-DD",
      });
    }

    if (!req.file) {
      console.log("No file uploaded. Please attach a file.");
      return res
        .status(400)
        .json({ error: "No file uploaded. Please attach a file." });
    }

    const formData = new FormData();
    formData.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const response = await axios.post(FLASK_BACKEND_URL, formData, {
      params: {
        start_date: start,
        end_date: end,
      },
      headers: {
        ...formData.getHeaders(),
      },
      proxy: false,
      httpAgent: new require("http").Agent({ family: 4 }),
    });

    const processedData = response.data;
    let savedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const [day, dayData] of Object.entries(processedData)) {
      try {
        // Construct the date
        const [year, month] = start.split("-");
        const date = new Date(Number(year), Number(month) - 1, Number(day));

        // Transform the data according to our schema
        const transformedData = transformData(dayData, date);

        // Check if a record for this date already exists
        const existing = await Sale.findOne({ date });
        if (!existing) {
          await Sale.create(transformedData);
          savedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        errors.push(`Error processing day ${day}: ${error.message}`);
      }
    }

    res.json({
      message: "Processing complete",
      processed: savedCount,
      skipped: skippedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || error.message,
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res
        .status(400)
        .json({ error: "Start and end dates are required" });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }

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
