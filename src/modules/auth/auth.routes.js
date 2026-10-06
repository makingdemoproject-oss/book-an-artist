'use strict';

const express = require('express');
const validate = require('../../middleware/validate');
const { loginRateLimiter } = require('../../middleware/security');
const { loginSchema } = require('./auth.validation');
const authController = require('./auth.controller');

const router = express.Router();

router.post('/login', loginRateLimiter, validate(loginSchema), authController.login);

module.exports = router;
