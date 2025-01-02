const express = require("express");
const router = express.Router();
const AnalysisController = require("../controllers/analysis.controller");

router.post("/compare", AnalysisController.compareData);
router.post("/resolve-discrepancy", AnalysisController.resolveDiscrepancy);
router.get("/history", AnalysisController.getAnalyses);
router.get("/:id", AnalysisController.getAnalysisById);
router.post("/bank-compare", AnalysisController.compareBankData);
router.post("/bankResolve", AnalysisController.resolveBankDiscrepancy);
router.get("/stats/:analysisId", AnalysisController.getAnalysisStats);
router.get("/matched-stats/:analysisId", AnalysisController.getMatchedStats);
router.post('/check-resolutions', AnalysisController.checkInvoiceResolutions);
router.post('/match-to-bank', AnalysisController.matchToBank);


module.exports = router;
