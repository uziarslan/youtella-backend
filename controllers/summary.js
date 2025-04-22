const mongoose = require('mongoose');
const Summary = mongoose.model('Summary');

const getUserSummaries = async (req, res) => {
    try {
        const userId = req.user.id;
        const summaries = await Summary.find({ userId })
            .select('summaryTitle _id createdAt')
            .sort({ createdAt: -1 });
        res.status(200).json(summaries);
    } catch (error) {
        console.error('Error fetching summaries:', error);
        res.status(500).json({ error: 'Failed to fetch summaries' });
    }
};

const getSummaryById = async (req, res) => {
    const { summaryId } = req.params;
    try {
        const summary = await Summary.findById(summaryId);
        if (!summary) {
            return res.status(404).json({ error: 'Summary not found' });
        }
        res.status(200).json({
            keypoints: summary.keypoints,
            summary: summary.summaryText,
            timestamps: summary.timestamps,
            language: summary.language, // Add language
            summaryLength: summary.summaryLength, // Add summaryLength
            summaryTone: summary.summaryTone // Add summaryTone
        });
    } catch (error) {
        console.error('Error fetching summary:', error);
        res.status(500).json({ error: 'Failed to fetch summary' });
    }
};

module.exports = { getUserSummaries, getSummaryById };