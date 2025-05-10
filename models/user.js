const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    username: {
        type: String,
        unique: true,
        sparse: true
    },
    password: {
        type: String,
        required: true
    },
    profileImage: {
        path: String,
        filename: String
    },
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    summariesUsedToday: {
        type: Number,
        default: 0
    },
    lastSummaryDate: {
        type: Date
    },
    role: {
        type: String,
        enum: ['user', 'admin'], default: 'user'
    },
    stripeCustomerId: {
        type: String
    },
    subscriptionStatus: {
        type: String,
        enum: ['free', 'active', 'canceled'],
        default: 'free'
    },
    subscriptionEndsAt: {
        type: Date
    },
    resetPasswordOTP: {
        type: String
    },
    resetPasswordExpires: {
        type: Date
    },
    processedSessions: [String]
}, { timestamps: true });

UserSchema.pre("save", async function (next) {
    if (!this.isModified("password")) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

UserSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);