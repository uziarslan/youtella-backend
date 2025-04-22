const mongoose = require('mongoose');

const ChatbotInteractionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    summaryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Summary'
    },
    question: {
        type: String
    },
    answer: {
        type: String
    }
}, { timestamps: true });

modeule.exports = mongoose.model('ChatbotInteraction', ChatbotInteractionSchema);