const express = require('express');
const router = express.Router();
const multer = require('multer');
const paymentController = require('../controllers/paymentLinks.controller');

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Route for uploading Excel file
router.post('/upload', upload.single('file'), paymentController.uploadPayments);

module.exports = router;  