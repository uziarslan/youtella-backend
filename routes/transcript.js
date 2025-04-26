const express = require('express');
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync");
const { protect } = require("../middlewares/authMiddleware");
const { getVideoTranscript, getFreeVideoTranscript, getTranscriptStatus, uploadVideo, getSharedSummary } = require('../controllers/transcript');
const multer = require('multer');
const { videoStorage } = require('../cloudinary/index');

// Configure Multer for video uploads
const upload = multer({ storage: videoStorage });

// Define routes
router.post('/transcript', protect, wrapAsync(getVideoTranscript));

router.post('/transcript/free', wrapAsync(getFreeVideoTranscript));

router.post('/upload', protect, upload.single('video'), wrapAsync(uploadVideo));

router.get('/transcript/status', wrapAsync(getTranscriptStatus));

router.post("/shared/summary", wrapAsync(getSharedSummary));


module.exports = router;