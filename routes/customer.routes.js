const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer.controller');

router.post('/import', customerController.importCustomer);

module.exports = router;