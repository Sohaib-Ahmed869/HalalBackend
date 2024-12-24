const express = require("express");
const router = express.Router();
const AnalysisController = require("../controllers/analysis.controller");

router.post("/compare", AnalysisController.compareData);
router.post("/resolve-discrepancy", AnalysisController.resolveDiscrepancy);
router.get("/history", AnalysisController.getAnalyses);
router.get("/:id", AnalysisController.getAnalysisById);

module.exports = router;
