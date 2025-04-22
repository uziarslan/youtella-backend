const express = require('express');
const wrapAsync = require('../utils/wrapAsync');
const {
    handleWebhook,
} = require('../controllers/webhook');

const router = express.Router();

// Stripe webhook
router.post(
    '/webhook',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
        req.rawBody = req.body;
        next();
    },
    wrapAsync(handleWebhook)
);

module.exports = router;