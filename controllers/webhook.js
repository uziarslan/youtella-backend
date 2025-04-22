const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');
const User = mongoose.model("User");
const Subscription = mongoose.model("Subscription");

const handleWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log('Webhook received:', {
            headers: req.headers,
            rawBody: req.rawBody.toString(),
            body: req.body
        });
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log('Processing event:', event.type);

    switch (event.type) {
        case 'checkout.session.completed':
            try {
                const session = event.data.object;
                console.log('Checkout session completed:', session);

                const subscriptionId = session.subscription;
                const userId = session.metadata?.userId;

                if (!userId) {
                    console.error('UserId not found in session metadata:', session.metadata);
                    break;
                }

                if (subscriptionId) {
                    await stripe.subscriptions.update(subscriptionId, {
                        metadata: { userId }
                    });
                    console.log(`Successfully set userId metadata on subscription ${subscriptionId} for session ${session.id}`);
                }
            } catch (error) {
                console.error('Error processing checkout.session.completed event:', error.message, error.stack);
            }
            break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            try {
                const subscriptionData = event.data.object;
                console.log('Subscription data:', subscriptionData);
                console.log('Subscription metadata:', subscriptionData.metadata);

                let userId;
                try {
                    const subscriptionMetadata = subscriptionData.metadata || {};
                    userId = subscriptionMetadata.userId || subscriptionMetadata.userid || subscriptionMetadata.UserId || subscriptionMetadata.UserID;

                    if (!userId) {
                        const customer = await stripe.customers.retrieve(subscriptionData.customer);
                        console.log('Customer data:', customer);
                        console.log('Customer metadata:', customer.metadata);

                        const customerMetadata = customer.metadata || {};
                        userId = customerMetadata.userId || customerMetadata.userid || customerMetadata.UserId || customerMetadata.UserID;

                        if (!userId) {
                            console.error(`UserId not found in subscription metadata or customer for subscription ${subscriptionData.id}. Subscription:`, subscriptionData, 'Customer:', customer);
                            break;
                        }
                    }
                } catch (error) {
                    console.error(`Failed to retrieve userId for subscription ${subscriptionData.id}:`, error.message, error.stack);
                    break;
                }

                const user = await User.findById(userId);
                if (!user) {
                    console.error('User not found for subscription:', subscriptionData.id, 'with userId:', userId);
                    break;
                }

                // Extract current_period_end from items.data[0]
                let periodEndDate;
                const periodEndTimestamp = subscriptionData.items?.data?.[0]?.current_period_end;
                if (typeof periodEndTimestamp !== 'number' || isNaN(periodEndTimestamp)) {
                    console.warn(`Invalid current_period_end for subscription ${subscriptionData.id}:`, periodEndTimestamp);
                    periodEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days fallback
                } else {
                    periodEndDate = new Date(periodEndTimestamp * 1000);
                    console.log(`Extracted current_period_end for subscription ${subscriptionData.id}:`, periodEndDate);
                }

                // Update or create subscription
                await Subscription.findOneAndUpdate(
                    { stripeSubscriptionId: subscriptionData.id },
                    {
                        userId,
                        stripeSubscriptionId: subscriptionData.id,
                        plan: 'monthly',
                        status: subscriptionData.status,
                        currentPeriodEnd: periodEndDate
                    },
                    { upsert: true, new: true }
                );

                // Update user
                user.subscriptionStatus = subscriptionData.status === 'active' ? 'active' : subscriptionData.status;
                user.subscriptionEndsAt = periodEndDate;
                await user.save();

                console.log(`Successfully processed ${event.type} for subscription ${subscriptionData.id}`);
            } catch (error) {
                console.error(`Error processing ${event.type} event:`, error.message, error.stack);
            }
            break;

        case 'invoice.paid':
        case 'invoice.payment_succeeded':
            try {
                const invoiceData = event.data.object;
                console.log('Invoice data:', invoiceData);

                const subscriptionId = invoiceData.parent?.subscription_details?.subscription || invoiceData.subscription;
                if (!subscriptionId) {
                    console.error('Subscription ID not found in invoice data:', invoiceData);
                    break;
                }

                // Check if subscription exists; if not, fetch it from Stripe and create it
                let subscription = await Subscription.findOne({ stripeSubscriptionId: subscriptionId });
                if (!subscription) {
                    console.log(`Subscription ${subscriptionId} not found in database. Fetching from Stripe...`);
                    const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);

                    let userId;
                    const subscriptionMetadata = stripeSubscription.metadata || {};
                    userId = subscriptionMetadata.userId || subscriptionMetadata.userid || subscriptionMetadata.UserId || subscriptionMetadata.UserID;

                    if (!userId) {
                        const customer = await stripe.customers.retrieve(stripeSubscription.customer);
                        const customerMetadata = customer.metadata || {};
                        userId = customerMetadata.userId || customerMetadata.userid || customerMetadata.UserId || customerMetadata.UserID;

                        if (!userId) {
                            console.error(`UserId not found for subscription ${subscriptionId}. Subscription:`, stripeSubscription, 'Customer:', customer);
                            break;
                        }
                    }

                    const user = await User.findById(userId);
                    if (!user) {
                        console.error('User not found for subscription:', subscriptionId, 'with userId:', userId);
                        break;
                    }

                    // Extract current_period_end
                    let periodEndDate;
                    const periodEndTimestamp = stripeSubscription.items?.data?.[0]?.current_period_end;
                    if (typeof periodEndTimestamp !== 'number' || isNaN(periodEndTimestamp)) {
                        console.warn(`Invalid current_period_end for subscription ${subscriptionId}:`, periodEndTimestamp);
                        periodEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days fallback
                    } else {
                        periodEndDate = new Date(periodEndTimestamp * 1000);
                        console.log(`Extracted current_period_end for subscription ${subscriptionId}:`, periodEndDate);
                    }

                    // Create the subscription
                    subscription = await Subscription.create({
                        userId,
                        stripeSubscriptionId: subscriptionId,
                        plan: 'monthly',
                        status: stripeSubscription.status,
                        currentPeriodEnd: periodEndDate
                    });

                    user.subscriptionStatus = stripeSubscription.status === 'active' ? 'active' : stripeSubscription.status;
                    user.subscriptionEndsAt = periodEndDate;
                    await user.save();

                    console.log(`Created subscription ${subscriptionId} in database.`);
                }

                console.log(`Successfully processed ${event.type} for invoice ${invoiceData.id}`);
            } catch (error) {
                console.error(`Error processing ${event.type} event:`, error.message, error.stack);
            }
            break;

        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
};

module.exports = { handleWebhook };