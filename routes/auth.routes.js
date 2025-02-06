const express = require('express');
const AuthController = require('../controllers/auth.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/login', AuthController.login);
router.post('/logout', authenticateToken, AuthController.logout);
router.post('/users', AuthController.createUser);
router.get('/users/:userId/access', authenticateToken, AuthController.getUserAccess);
router.get('/users', authenticateToken, AuthController.getAllUsers);


module.exports = router;