const mongoose = require('mongoose');

const SummarySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    videoUrl: {
        type: String,
        required: true
    },
    platform: {
        type: String,
        enum: ['youtube', 'zoom', 'other'],
        default: 'youtube'
    },
    summaryTitle: {
        type: String,
        required: true
    },
    summaryText: {
        type: String,
        required: true
    },
    keypoints: {
        type: [String],
        default: []
    },
    timestamps: {
        type: [String],
        default: []
    },
    summaryTone: {
        type: String,
        enum: ['formal', 'casual', 'technical'],
        default: 'formal'
    },
    summaryLength: {
        type: String,
        enum: ['short', 'medium', 'long'],
        default: 'medium'
    },
    language: {
        type: String,
        default: 'english'
    },
    shareableLink: {
        type: String
    },
    thumbnailUrl: {
        type: String
    },
    videoTimestamp: {
        type: String
    },
    chats: [
        {
            sender: {
                type: String,
                enum: ['user', 'bot'],
                required: true
            },
            text: {
                type: String,
                required: true
            },
            timestamp: {
                type: Date,
                default: Date.now
            }
        }
    ]
}, { timestamps: true });

SummarySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Summary', SummarySchema);