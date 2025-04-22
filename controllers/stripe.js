const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');
const User = mongoose.model("User");
const Subscription = mongoose.model("Subscription");

// Create a checkout session for the $5.99/month subscription
const createCheckout = async (req, res) => {
    const { id } = req.user;

    try {
        // Find or create a Stripe customer
        let user = await User.findById(id);
        let stripeCustomerId = user.stripeCustomerId;

        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: user.username,
                metadata: { userId: id.toString() }
            });
            stripeCustomerId = customer.id;
            user.stripeCustomerId = stripeCustomerId;
            await user.save();
        } else {
            // Check if the customer has the correct metadata
            const customer = await stripe.customers.retrieve(stripeCustomerId);
            if (!customer.metadata.userId || customer.metadata.userId !== id.toString()) {
                // Update the customer metadata
                await stripe.customers.update(stripeCustomerId, {
                    metadata: { userId: id.toString() }
                });
            }
        }

        // Create a checkout session for subscription
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'Monthly Subscription',
                            description: 'Access to premium features for $5.99/month'
                        },
                        unit_amount: 599, // $5.99 in cents
                        recurring: {
                            interval: 'month'
                        }
                    },
                    quantity: 1
                }
            ],
            mode: 'subscription',
            success_url: `${process.env.DOMAIN_FRONTEND}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.DOMAIN_FRONTEND}/payment-cancel`,
            metadata: { userId: id.toString() }
        });

        res.status(200).json({ url: session.url });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
};

// Handle successful checkout (optional, as webhooks handle most updates)
const handleCheckoutSuccess = async (req, res) => {
    const sessionId = req.body.sessionId; // Read from body instead of query

    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        // Retrieve the userId from the session metadata
        const userId = session.metadata?.userId;
        if (!userId) {
            throw new Error('User ID not found in session metadata');
        }

        // Optionally, update user status or subscription here
        const user = await User.findById(userId);
        if (user) {
            user.subscriptionStatus = 'active'; // Update based on your logic
            await user.save();
        }

        res.status(200).json({ message: 'Payment successful', userId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process checkout success' });
    }
};

const getPaymentMethod = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || !user.stripeCustomerId) {
            return res.status(404).json({ error: "No Stripe customer found" });
        }

        const paymentMethods = await stripe.paymentMethods.list({
            customer: user.stripeCustomerId,
            type: "card",
        });

        const subscription = await Subscription.findOne({
            userId: req.user.id,
            status: "active",
        });

        if (!subscription) {
            return res.status(404).json({ error: "No active subscription found" });
        }

        const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
        const defaultPaymentMethodId = stripeSubscription.default_payment_method;

        const defaultPaymentMethod = paymentMethods.data.find(
            (pm) => pm.id === defaultPaymentMethodId
        );

        if (!defaultPaymentMethod) {
            return res.status(404).json({ error: "No default payment method found" });
        }

        res.status(200).json({
            card: {
                brand: defaultPaymentMethod.card.brand,
                last4: defaultPaymentMethod.card.last4,
                expMonth: defaultPaymentMethod.card.exp_month,
                expYear: defaultPaymentMethod.card.exp_year,
                currentPeriodEnd: subscription.currentPeriodEnd,
            },
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch payment method" });
    }
};

const updatePaymentMethod = async (req, res) => {
    try {
        const { paymentMethodId } = req.body;
        const userId = req.user.id;

        // Validate inputs
        if (!paymentMethodId) {
            return res.status(400).json({ error: "Payment method ID is required" });
        }

        // Fetch user and validate customer ID
        const user = await User.findById(userId);
        if (!user || !user.stripeCustomerId) {
            return res.status(404).json({ error: "No Stripe customer found for this user" });
        }

        // Fetch active subscription
        const subscription = await Subscription.findOne({
            userId,
            status: "active",
        });
        if (!subscription) {
            return res.status(404).json({ error: "No active subscription found" });
        }

        // Attach the new payment method to the customer
        await stripe.paymentMethods.attach(paymentMethodId, {
            customer: user.stripeCustomerId,
        });

        // Update the customer's default payment method for future invoices
        await stripe.customers.update(user.stripeCustomerId, {
            invoice_settings: {
                default_payment_method: paymentMethodId,
            },
        });

        // Update the subscription's default payment method
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            default_payment_method: paymentMethodId,
        });

        // Verify the update by retrieving the subscription
        const updatedSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
        if (updatedSubscription.default_payment_method !== paymentMethodId) {
            throw new Error("Failed to set the new payment method as default for the subscription");
        }

        res.status(200).json({ message: "Payment method updated successfully" });
    } catch (err) {
        res.status(400).json({ error: err.message || "Failed to update payment method" });
    }
};

// Cancel subscription
const cancelSubscription = async (req, res) => {
    const { id } = req.user;

    try {
        // Fetch user
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Fetch active subscription
        const subscription = await Subscription.findOne({ userId: id, status: 'active' });
        if (!subscription) {
            return res.status(404).json({ error: 'No active subscription found' });
        }

        // Verify subscription exists in Stripe
        let stripeSubscription;
        try {
            stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
        } catch (err) {
            if (err.code === 'resource_missing') {
                // Subscription not found in Stripe, clean up local record
                subscription.status = 'canceled';
                await subscription.save();
                user.subscriptionStatus = 'canceled';
                user.subscriptionEndsAt = null;
                await user.save();
                return res.status(404).json({ error: 'Subscription not found in Stripe' });
            }
            throw err;
        }

        // Check if already scheduled for cancellation
        if (stripeSubscription.cancel_at_period_end) {
            return res.status(400).json({ error: 'Subscription is already scheduled to cancel at period end' });
        }

        // Cancel subscription in Stripe (set to cancel at period end)
        const updatedStripeSubscription = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            cancel_at_period_end: true,
        });

        // Verify cancellation
        if (!updatedStripeSubscription.cancel_at_period_end) {
            throw new Error('Failed to schedule subscription cancellation');
        }

        // Validate current_period_end
        const periodEndTimestamp = updatedStripeSubscription.current_period_end;
        let periodEndDate;
        if (typeof periodEndTimestamp !== 'number' || isNaN(periodEndTimestamp)) {
            // Fallback: Use existing subscription.currentPeriodEnd or calculate
            periodEndDate = subscription.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days fallback
        } else {
            periodEndDate = new Date(periodEndTimestamp * 1000);
        }

        // Update local subscription record
        subscription.status = 'active'; // Keep active until period ends
        subscription.currentPeriodEnd = periodEndDate;
        await subscription.save();

        // Update user
        user.subscriptionStatus = 'active';
        user.subscriptionEndsAt = periodEndDate;
        await user.save();

        res.status(200).json({
            message: 'Subscription scheduled to cancel at the end of the current period.',
            currentPeriodEnd: periodEndDate,
        });
    } catch (error) {
        if (error.type === 'StripeInvalidRequestError') {
            return res.status(400).json({ error: `Stripe error: ${error.message}` });
        }
        res.status(500).json({ error: 'Failed to cancel subscription' });
    }
};

module.exports = {
    createCheckout,
    handleCheckoutSuccess,
    getPaymentMethod,
    cancelSubscription,
    updatePaymentMethod
};