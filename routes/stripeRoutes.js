const express = require('express');
const wrapAsync = require('../utils/wrapAsync');
const { protect } = require('../middlewares/authMiddleware');
const {
    createCheckout,
    handleCheckoutSuccess,
    getPaymentMethod,
    cancelSubscription,
    handleWebhook,
    updatePaymentMethod
} = require('../controllers/stripe');

const router = express.Router();

// Create checkout session for subscription
router.post('/create-checkout-session', protect, wrapAsync(createCheckout));

// Handle checkout success
router.post('/checkout-success', protect, wrapAsync(handleCheckoutSuccess));

// Get the payment card info from the strip
router.get("/payment-method", protect, wrapAsync(getPaymentMethod));

// Cancel subscription
router.post('/cancel-subscription', protect, wrapAsync(cancelSubscription));

// Update Card info
router.post("/update-payment-method", protect, wrapAsync(updatePaymentMethod));

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