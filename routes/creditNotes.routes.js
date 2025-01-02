const express = require("express");
const router = express.Router();
const CreditNoteController = require("../controllers/creditNote.controller");

router.get("/", CreditNoteController.getCreditNotesByDate);

module.exports = router;
