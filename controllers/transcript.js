const { json } = require('body-parser');
const agenda = require('../middlewares/agenda');
const mongoose = require('mongoose');
const User = mongoose.model('User');
const Summary = mongoose.model('Summary');

// Extract video ID from URL
const getVideoId = (url) => {
    const regex = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
};

// Main function to get video transcript and summary for authenticated users
const getVideoTranscript = async (req, res) => {
    const { videoUrl, language, length, tone } = req.body;
    const { id } = req.user;

    const user = await User.findById(id);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    const today = new Date().toDateString();
    const lastSummaryDate = user.lastSummaryDate ? new Date(user.lastSummaryDate).toDateString() : null;

    if (user.subscriptionStatus === "free") {
        if (lastSummaryDate !== today) {
            // Reset if it's a new day
            user.summariesUsedToday = 0;
            user.lastSummaryDate = new Date();
            await user.save();
        } else if (user.summariesUsedToday >= 3) {
            return res.status(403).json({
                error: "You’ve used all 3 free summaries for today. You can either: ✅ Wait 24 hours 🚀 Unlock unlimited access for $5.99/month"
            });
        }
    }

    // Input validation
    if (!videoUrl) {
        return res.status(422).json({ error: 'Video URL is required' });
    }

    const videoId = getVideoId(videoUrl);
    if (!videoId) {
        return res.status(422).json({ error: 'Invalid YouTube URL' });
    }

    // Advanced features (based on subscription)
    let advancedFeatures = {
        language: 'English',
        length: 'Medium',
        tone: 'Formal'
    };

    if (user.subscriptionStatus === 'active') {
        if (language && !['English', 'Spanish', 'French', 'German'].includes(language)) {
            return res.status(422).json({ error: 'Invalid language' });
        }
        if (length && !['Short', 'Medium', 'Long'].includes(length)) {
            return res.status(422).json({ error: 'Invalid summary length' });
        }
        if (tone && !['Formal', 'Casual', 'Professional', 'Friendly'].includes(tone)) {
            return res.status(422).json({ error: 'Invalid tone' });
        }
        advancedFeatures = {
            language: language || 'English',
            length: length || 'Medium',
            tone: tone || 'Formal'
        };
    }

    try {
        const taskId = Date.now().toString();
        await agenda.now('transcribeVideo', {
            videoUrl,
            videoId,
            taskId,
            userId: user._id,
            advancedFeatures,
            result: { status: 'pending' }
        });

        await User.findOneAndUpdate(
            { _id: id },
            {
                $inc: { summariesUsedToday: 1 },
                $set: { lastSummaryDate: Date.now() }
            },
            { new: true }
        );

        return res.status(202).json({ taskId });
    } catch (error) {
        console.error('Failed to queue transcription job:', error);
        return res.status(500).json({
            error: 'Failed to queue transcription job',
            details: error.message
        });
    }
};

// Function to get video transcript and summary for unauthenticated (free/test) users
const getFreeVideoTranscript = async (req, res) => {
    const { videoUrl, language, length, tone } = req.body;

    // Input validation
    if (!videoUrl) {
        return res.status(422).json({ error: 'Video URL is required' });
    }

    const videoId = getVideoId(videoUrl);
    if (!videoId) {
        return res.status(422).json({ error: 'Invalid YouTube URL' });
    }

    // Define default advanced features for free users
    const advancedFeatures = {
        language: 'English',
        length: 'Medium',
        tone: 'Formal'
    };

    // Validate and apply advanced features
    if (language && !['English', 'Spanish', 'French', 'German'].includes(language)) {
        return res.status(422).json({ error: 'Invalid language' });
    }
    if (length && !['Short', 'Medium', 'Long'].includes(length)) {
        return res.status(422).json({ error: 'Invalid summary length' });
    }
    if (tone && !['Formal', 'Casual', 'Professional', 'Friendly'].includes(tone)) {
        return res.status(422).json({ error: 'Invalid tone' });
    }

    advancedFeatures.language = language || 'English';
    advancedFeatures.length = length || 'Medium';
    advancedFeatures.tone = tone || 'Formal';

    try {
        const taskId = Date.now().toString();
        await agenda.now('transcribeVideo', {
            videoUrl,
            videoId,
            taskId,
            userId: null,
            advancedFeatures,
            result: { status: 'pending' }
        });
        return res.status(202).json({ taskId });
    } catch (error) {
        console.error('Failed to queue free transcription job:', error);
        return res.status(500).json({
            error: 'Failed to queue free transcription job',
            details: error.message
        });
    }
};

// Function to handle video uploads and queue transcription
const uploadVideo = async (req, res) => {
    const { language, length, tone } = req.body;
    const { id } = req.user;

    const user = await User.findById(id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (!req.file) {
        return res.status(422).json({ error: 'Video file is required' });
    }

    // Define advanced features based on subscription status
    let advancedFeatures = {
        language: 'English',
        length: 'Medium',
        tone: 'Formal'
    };

    // Validate and apply advanced features for subscribed users
    if (user.subscriptionStatus === 'active') {
        if (language && !['English', 'Spanish', 'French', 'German'].includes(language)) {
            return res.status(422).json({ error: 'Invalid language' });
        }
        if (length && !['Short', 'Medium', 'Long'].includes(length)) {
            return res.status(422).json({ error: 'Invalid summary length' });
        }
        if (tone && !['Formal', 'Casual', 'Professional', 'Friendly'].includes(tone)) {
            return res.status(422).json({ error: 'Invalid tone' });
        }
        advancedFeatures = {
            language: language || 'English',
            length: length || 'Medium',
            tone: tone || 'Formal'
        };
    }

    try {
        const taskId = Date.now().toString();
        await agenda.now('transcribeUploadedVideo', {
            videoUrl: req.file.path,
            publicId: req.file.filename,
            taskId,
            userId: user._id,
            advancedFeatures,
            result: { status: 'pending' }
        });
        return res.status(202).json({ taskId });
    } catch (error) {
        console.error('Failed to queue video transcription job:', error);
        return res.status(500).json({
            error: 'Failed to queue video transcription job',
            details: error.message
        });
    }
};

// Get transcript status
const getTranscriptStatus = async (req, res) => {
    const { taskId } = req.query;

    if (!taskId) {
        return res.status(400).json({ error: 'Task ID is required' });
    }

    try {
        const jobs = await agenda.jobs({ 'data.taskId': taskId });
        if (!jobs || jobs.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const job = jobs[0];
        const taskData = job.attrs.data;

        let summaryData = {};
        if (taskData.result?.summary) {
            try {
                summaryData = JSON.parse(taskData.result.summary);
            } catch (parseError) {
                console.error('Failed to parse summary JSON:', parseError);
                summaryData = { keypoints: [], summary: taskData.result.summary, timestamps: [] };
            }
        }

        res.status(200).json({
            status: taskData.status || 'pending',
            progress: taskData.progress || 0,
            estimatedTimeRemaining: taskData.estimatedTimeRemaining || 0,
            summary: summaryData,
            error: taskData.result?.error
        });
    } catch (err) {
        console.error('Error fetching task status:', err);
        res.status(500).json({ error: 'Failed to fetch task status' });
    }
};

const getSharedSummary = async (req, res) => {
    const { sharename } = req.body;

    if (!sharename) {
        return res.status(400).json({ error: "Invalid request." })
    }

    const shareableLink = `${process.env.DOMAIN_FRONTEND}/share/${sharename}`

    const summary = await Summary.findOne({
        shareableLink
    });

    if (!summary) {
        return res.status(404).json({ error: "Unable to fetch summary." });
    }

    console.log(summary)

    res.status(200).json({
        ...summary._doc
    })
}

module.exports = { getVideoTranscript, getFreeVideoTranscript, uploadVideo, getTranscriptStatus, getSharedSummary };