const express = require('express');
const AuthController = require('../controllers/auth2.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/login', AuthController.login);
router.post('/logout', authenticateToken, AuthController.logout);

module.exports = router;