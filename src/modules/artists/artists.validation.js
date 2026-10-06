'use strict';

const { z } = require('zod');

const artistIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

module.exports = { artistIdParamSchema, paginationSchema };
