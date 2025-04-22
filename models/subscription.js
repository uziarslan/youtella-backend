const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    stripeSubscriptionId: {
        type: String,
        required: true
    },
    plan: {
        type: String,
        enum: ['free', 'monthly'],
        default: 'monthly'
    },
    status: {
        type: String,
        enum: ['active', 'canceled', 'incomplete', 'trialing', 'past_due', 'unpaid'],
        default: 'active'
    },
    currentPeriodEnd: {
        type: Date,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Subscription', SubscriptionSchema);