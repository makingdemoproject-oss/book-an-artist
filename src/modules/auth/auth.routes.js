'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../../config/env');
const validate = require('../../middleware/validate');
const { sendError } = require('../../utils/response');
const { loginSchema } = require('./auth.validation');
const authController = require('./auth.controller');

const router = express.Router();

// Basic brute-force protection on the login endpoint.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (req, res) => sendError(res, 429, 'Too many login attempts, please try again later'),
});

router.post('/login', loginLimiter, validate(loginSchema), authController.login);

module.exports = router;
