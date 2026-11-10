'use strict';

const { badRequest } = require('../utils/errors');

/**
 * validate({ body, query, params }) parses each part with its Zod schema and
 * stores the cleaned result on req.valid. Handlers only ever read req.valid,
 * so unvalidated input cannot reach the database.
 */
function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid || {};
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        const details = result.error.issues.map((i) => ({ field: i.path.join('.') || part, message: i.message }));
        return next(badRequest(`Invalid request ${part}`, details));
      }
      req.valid[part] = result.data;
    }
    return next();
  };
}

module.exports = { validate };
