'use strict';

const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

module.exports = { loginSchema };
