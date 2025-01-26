const express = require("express");
const router = express.Router();
const AnalysisController = require("../controllers/analysis.controller");

router.post("/compare", AnalysisController.compareData);
router.post("/resolve-discrepancy", AnalysisController.resolveDiscrepancy);
router.get("/history", AnalysisController.getAnalyses);
router.get("/datesNotDone", AnalysisController.getAnalysisNotDoneDates);
router.get("/:id", AnalysisController.getAnalysisById);
router.post("/bank-compare", AnalysisController.compareBankData);
router.post("/bankResolve", AnalysisController.resolveBankDiscrepancy);
router.get("/stats/:analysisId", AnalysisController.getAnalysisStats);
router.get("/matched-stats/:analysisId", AnalysisController.getMatchedStats);
router.post("/check-resolutions", AnalysisController.checkInvoiceResolutions);
router.post("/match-to-bank", AnalysisController.matchToBank);
router.post(
  "/resolve-sap-discrepancy",
  AnalysisController.resolveSAPDiscrepancy
);
router.post(
  "/find-potential-excel-matches",
  AnalysisController.findPotentialExcelMatchesForSAP
);
router.post("/reconcile-bank", AnalysisController.reconcileBank);
router.post("/closeOff", AnalysisController.closeOffWithANote);
router.post("/pos-closeOff", AnalysisController.POScloseOffWithANote);
router.put("/addNote", AnalysisController.addNoteToAnalysis);
router.post(
  "/resolve-unmatched-payment",
  AnalysisController.resolveUnmatchedPayment
);
router.post(
  "/find-potential-excel-matches-for-payment",
  AnalysisController.findPotentialExcelMatchesForPayment
);

module.exports = router;
