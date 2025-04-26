// models/summary.js
const mongoose = require('mongoose');

const SummarySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
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
}, { timestamps: true });

SummarySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Summary', SummarySchema);