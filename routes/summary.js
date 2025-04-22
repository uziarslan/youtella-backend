const express = require('express');
const router = express.Router();
const { getUserSummaries, getSummaryById } = require('../controllers/summary');
const { protect } = require('../middlewares/authMiddleware');
const wrapAsync = require('../utils/wrapAsync');

// Define a route to get all summaries for the current user
router.get('/summaries', protect, wrapAsync(getUserSummaries));

// Define a route to get a single summary by ID
router.get('/summary/:summaryId', protect, wrapAsync(getSummaryById));

module.exports = router;