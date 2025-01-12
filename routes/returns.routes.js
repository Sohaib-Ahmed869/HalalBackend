const express = require("express");
const router = express.Router();
const ReturnsController = require("../controllers/returns.controller");

router.get("/", ReturnsController.getReturnsByDate);
router.get("/customer/:cardCode", ReturnsController.getReturnsByCustomer);
router.get("/docnum/:docNum", ReturnsController.getReturnByDocNum);


module.exports = router;