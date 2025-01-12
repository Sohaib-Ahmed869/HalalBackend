const express = require("express");
const router = express.Router();
const CreditNoteController = require("../controllers/creditNote.controller");

router.get("/", CreditNoteController.getCreditNotesByDate);
router.get("/docnum/:docNum", CreditNoteController.getCreditNoteByDocNum);

module.exports = router;
