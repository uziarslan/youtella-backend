const mongoose = require('mongoose');

const AdSchema = new mongoose.Schema({
    imageUrl: {
        type: String
    },
    link: {
        type: String
    },
    active: {
        type: Boolean,
        default: true
    },
    shownCount: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

modeule.exports = mongoose.model('Ad', AdSchema);