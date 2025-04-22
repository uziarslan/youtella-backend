const mongoose = require('mongoose');

const UsageLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    action: {
        type: String
    },
    metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

modeule.exports = mongoose.model('UsageLog', UsageLogSchema);