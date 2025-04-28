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
            ...summary._doc,
        });
    } catch (error) {
        console.error('Error fetching summary:', error);
        res.status(500).json({ error: 'Failed to fetch summary' });
    }
};

module.exports = { getUserSummaries, getSummaryById };