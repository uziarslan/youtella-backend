// models/caption.js
const mongoose = require('mongoose');

const CaptionSchema = new mongoose.Schema({
    videoUrl: {
        type: String,
        required: true,
        index: true // Index for faster lookups
    },
    videoId: {
        type: String,
        required: true
    },
    videoTitle: {
        type: String,
        required: true
    },
    rawCaptions: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
    }
});

module.exports = mongoose.model('Caption', CaptionSchema);