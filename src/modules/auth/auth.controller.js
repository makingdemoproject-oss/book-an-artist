'use strict';

const { sendSuccess, asyncHandler } = require('../../utils/response');
const authService = require('./auth.service');

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.validated.body;
  const result = await authService.login(email, password);
  return sendSuccess(res, result);
});

module.exports = { login };
