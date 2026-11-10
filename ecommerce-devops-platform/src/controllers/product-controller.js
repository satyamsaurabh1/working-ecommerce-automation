'use strict';

const productService = require('../services/product-service');

// Express 5 forwards rejected promises to the error handler, so no try/catch is needed here.
const list = async (req, res) => res.json(await productService.listProducts(req.valid.query));
const getById = async (req, res) => res.json(await productService.getProduct(req.valid.params.id));

module.exports = { list, getById };
