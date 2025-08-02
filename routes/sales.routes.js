const express = require("express");
const router = express.Router();
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const Sale = require("../models/sales.model");
const upload = multer({ storage: multer.memoryStorage() });

const { getModel } = require("../utils/modelFactory");

const FLASK_BACKEND_URL = "http://127.0.0.1:5001/process_excel";
``;
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
      "Caisse Espèces": dayData.POS?.["Caisse Espèces"] || [],
      "Caisse chèques": dayData.POS?.["Caisse chèques"] || [],
      "Caisse CB": dayData.POS?.["Caisse CB"] || [],
    },
  };
};

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const Sale = getModel(req.dbConnection, "Sale");
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

    console.log("Sending request to Flask backend...");
    console.log("Flask URL:", FLASK_BACKEND_URL);
    console.log("Query params:", { start_date: start, end_date: end });

    // Add timeout to prevent hanging
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
      timeout: 60000, // 60 second timeout
    });

    console.log("Flask response status:", response.status);
    console.log("Flask response headers:", response.headers);

    const processedData = response.data;
    console.log("Response type:", typeof processedData);
    console.log("Response status:", response.status);
    console.log("Response content-type:", response.headers["content-type"]);

    // Log the actual response content (first 500 chars)
    console.log(
      "Response content (first 500 chars):",
      typeof processedData === "string"
        ? processedData.substring(0, 500)
        : JSON.stringify(processedData).substring(0, 500)
    );

    // Check if response is valid
    if (!processedData || typeof processedData !== "object") {
      console.error("Invalid response from Flask backend");
      console.error("Full response:", processedData);
      return res.status(500).json({
        error: "Invalid response from Flask backend",
        received: typeof processedData,
        content:
          typeof processedData === "string"
            ? processedData.substring(0, 200)
            : processedData,
        status: response.status,
        contentType: response.headers["content-type"],
      });
    }

    let savedCount = 0;
    let skippedCount = 0;
    const errors = [];

    console.log(`Processing ${Object.keys(processedData).length} days...`);

    for (const [day, dayData] of Object.entries(processedData)) {
      try {
        console.log(`Processing day ${day}...`);

        // Validate dayData
        if (!dayData || typeof dayData !== "object") {
          console.error(`Invalid dayData for day ${day}:`, dayData);
          errors.push(`Error processing day ${day}: Invalid day data`);
          continue;
        }

        // Log dayData structure
        console.log(`Day ${day} data keys:`, Object.keys(dayData));
        console.log(`Day ${day} has POS:`, !!dayData.POS);

        // Construct the date
        const [year, month] = start.split("-");
        const dayNum = parseInt(day);

        if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
          console.error(`Invalid day number: ${day}`);
          errors.push(`Error processing day ${day}: Invalid day number`);
          continue;
        }

        const date = new Date(Number(year), Number(month) - 1, dayNum);

        if (isNaN(date.getTime())) {
          console.error(`Invalid date constructed for day ${day}`);
          errors.push(`Error processing day ${day}: Invalid date`);
          continue;
        }

        //set hours to 22:00:00
        date.setHours(22, 0, 0, 0);
        console.log(`Day ${day} date:`, date.toISOString());

        // Transform the data according to our schema
        const transformedData = transformData(dayData, date);
        console.log(`Day ${day} transformed successfully`);

        // Check if a record for this date already exists
        const existing = await Sale.findOne({ date });
        if (!existing) {
          await Sale.create(transformedData);
          savedCount++;
          console.log(`✅ Saved day ${day}`);
        } else {
          skippedCount++;
          console.log(`⏭️ Skipped day ${day} (exists)`);
        }
      } catch (error) {
        console.error(`Error processing day ${day}:`, error);
        errors.push(`Error processing day ${day}: ${error.message}`);
      }
    }

    console.log("Processing complete!");
    console.log(
      `Saved: ${savedCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`
    );

    res.json({
      message: "Processing complete",
      processed: savedCount,
      skipped: skippedCount,
      errors: errors.length > 0 ? errors : undefined,
      totalDaysReceived: Object.keys(processedData).length,
    });
  } catch (error) {
    console.error("Error processing file:", error.message);
    console.error("Error stack:", error.stack);

    if (error.code === "ECONNREFUSED") {
      return res.status(500).json({
        error: "Flask backend is not running or not accessible",
        details: "Make sure Flask server is running on http://127.0.0.1:5001",
      });
    }

    if (error.code === "ETIMEDOUT") {
      return res.status(500).json({
        error: "Request to Flask backend timed out",
        details: "Flask backend took too long to process the file",
      });
    }

    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || error.message,
      type: error.constructor.name,
      code: error.code,
    });
  }
});
router.get("/", async (req, res) => {
  try {
    const Sale = getModel(req.dbConnection, "Sale");

    const { start, end } = req.query;
    console.log("Start date:", start);
    console.log("End date:", end);
    if (!start || !end) {
      return res
        .status(400)
        .json({ error: "Start and end dates are required" });
    }

    const startDate = new Date(start);
    startDate.setDate(startDate.getDate());
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 0);
    console.log("Start date:", startDate);
    console.log("End date:", endDate);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    const sales = await Sale.find({
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    }).sort({ date: 1 });

    console.log("Sales fetched:", sales.length);

    res.json(sales);
  } catch (error) {
    console.error("Error fetching sales:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
