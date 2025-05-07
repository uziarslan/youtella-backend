const Agenda = require('agenda');
const OpenAI = require('openai');
const mongoose = require('mongoose');
const Summary = mongoose.model('Summary');
const Caption = mongoose.model('Caption');
const User = mongoose.model("User");
const { transcriptPrompt, combineSummariesPrompt } = require('../utils/prompts');
const {
  formatSecondsToMinutes,
  convertToMp3,
  validateAudioUrl,
  transcribeAudio,
  generateTitle,
  deleteFromCloudinary,
  fetchVideoCaptions,
  getVideoTitle,
  generateShareableLinkName,
  incrementShareableName,
  getIsoLanguage
} = require('../utils/helper')

const openai = new OpenAI({
  apiKey: process.env.GPT_SECRET_KEY
});

const agenda = new Agenda({
  db: { address: process.env.MONGODB_URI },
  processEvery: '10 seconds',
  maxConcurrency: 5
});

const toneMap = {
  'Formal': 'formal',
  'Casual': 'casual',
  'Professional': 'formal',
  'Friendly': 'casual',
  'Technical': 'technical',
  'Neutral': 'casual'
};

const lengthMap = {
  'Short': 'short',
  'Medium': 'medium',
  'Long': 'long'
};

// Simple token estimation function (approximate: 1 token ≈ 4 characters)
const estimateTokens = (text) => {
  return Math.ceil(text.length / 4);
};

// Delay function to wait for a specified time (in milliseconds)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Parse x-ratelimit-reset-tokens (e.g., "1m6.92s") to milliseconds
const parseResetTokens = (resetTokens) => {
  if (!resetTokens) return 10000; // Default 10s
  const match = resetTokens.match(/(?:(\d+)m)?(?:(\d+\.?\d*)s)?/);
  let milliseconds = 0;
  if (match[1]) milliseconds += parseInt(match[1]) * 60 * 1000; // Minutes
  if (match[2]) milliseconds += parseFloat(match[2]) * 1000; // Seconds
  return Math.max(milliseconds, 1000); // Minimum 1s
};

// Process large captions with rate limit handling
const processLargeCaptions = async (captions, language, length, tone, progressCallback) => {
  const maxTokensPerPart = 15000; // Smaller parts to stay under TPM limit
  const maxRetries = 3;
  const tpmLimit = 30000; // TPM limit for gpt-4-turbo-preview
  let remainingTokens = tpmLimit; // Track remaining tokens (initial estimate)

  // Split captions into parts
  const splitCaptions = (captions, maxTokens) => {
    const parts = [];
    const lines = captions.split('\n');
    let currentPart = '';
    let currentTokenCount = 0;

    for (const line of lines) {
      const lineTokens = estimateTokens(line);
      if (currentTokenCount + lineTokens > maxTokens && currentPart.trim()) {
        parts.push(currentPart);
        currentPart = '';
        currentTokenCount = 0;
      }
      currentPart += line + '\n';
      currentTokenCount += lineTokens;
    }

    if (currentPart.trim()) {
      parts.push(currentPart);
    }

    return parts;
  };

  let captionParts = splitCaptions(captions, maxTokensPerPart);
  const partialSummaries = [];

  for (let i = 0; i < captionParts.length; i++) {
    let partCaptions = captionParts[i];
    const prompt = transcriptPrompt(language, length, tone);
    let attempt = 0;
    let success = false;
    let currentMaxTokens = maxTokensPerPart;

    while (attempt < maxRetries && !success) {
      try {
        // Estimate tokens for this request
        const requestTokens = estimateTokens(prompt) + estimateTokens(partCaptions) + 4096; // Include max_tokens

        // Proactively delay if remaining tokens are low
        if (remainingTokens < requestTokens * 1.5) {
          await delay(10000); // Increased to 10s for better TPM reset
          if (progressCallback) {
            const progress = 60 + (i / captionParts.length) * 20 + (attempt * 0.5); // Small progress increment
            await progressCallback(progress);
          }
          remainingTokens = tpmLimit; // Assume reset
        }

        const summaryResponse = await openai.chat.completions.create({
          model: 'gpt-4-turbo',
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: partCaptions }
          ],
          max_tokens: 4096
        });

        let partialSummary;
        try {
          partialSummary = JSON.parse(summaryResponse.choices[0].message.content);
        } catch (error) {
          throw new Error(`Failed to parse partial summary for part ${i + 1}: ${error.message}`);
        }

        partialSummaries.push(partialSummary);
        success = true;

        // Update remaining tokens (approximate)
        remainingTokens = Math.max(0, remainingTokens - requestTokens);

        // Update progress (60% to 80% over the parts)
        if (progressCallback) {
          const progress = 60 + ((i + 1) / captionParts.length) * 20;
          await progressCallback(progress);
        }
      } catch (error) {
        if (error.code === 'rate_limit_exceeded' && attempt < maxRetries - 1) {
          const retryAfterMs = parseResetTokens(error.headers?.['x-ratelimit-reset-tokens']) || parseInt(error.headers?.['retry-after-ms']) || 10000;
          await delay(retryAfterMs);
          if (progressCallback) {
            const progress = 60 + (i / captionParts.length) * 20 + (attempt * 0.5);
            await progressCallback(progress);
          }
          attempt++;
          remainingTokens = parseInt(error.headers?.['x-ratelimit-remaining-tokens']) || tpmLimit;

          // Check if the error indicates the request is too large
          if (error.message.includes('Request too large') && currentMaxTokens > 5000) {
            currentMaxTokens = Math.floor(currentMaxTokens / 2);
            const newParts = splitCaptions(partCaptions, currentMaxTokens);
            captionParts.splice(i, 1, ...newParts); // Replace current part with smaller parts
            partCaptions = captionParts[i]; // Update to the first of the new parts
          }
        } else {
          throw error;
        }
      }
    }

    if (!success) {
      throw new Error(`Failed to process part ${i + 1} after ${maxRetries} attempts`);
    }
  }

  // Combine partial summaries
  const combinedPrompt = combineSummariesPrompt(language, length, tone);
  const combinedSummariesText = partialSummaries.map((s, i) => `Part ${i + 1}: ${s.summary}`).join('\n\n');
  const combinedKeypoints = partialSummaries.flatMap(s => s.keypoints);
  const combinedTimestamps = partialSummaries.flatMap(s => s.timestamps);
  let combinedInputParts = [JSON.stringify({
    summaries: combinedSummariesText,
    keypoints: combinedKeypoints,
    timestamps: combinedTimestamps
  })];

  let attempt = 0;
  let success = false;
  let currentMaxTokens = 2048; // Lowered initial max_tokens for combination
  let inputIndex = 0;

  while (attempt < maxRetries && !success && inputIndex < combinedInputParts.length) {
    const combinedInput = combinedInputParts[inputIndex];
    let requestTokens; // Declare outside try block
    try {
      // Estimate tokens for combination request
      requestTokens = Math.min(estimateTokens(combinedPrompt) + estimateTokens(combinedInput) + currentMaxTokens, 5000); // Cap at 5,000

      // Proactively delay if remaining tokens are low
      if (remainingTokens < requestTokens * 1.5) {
        await delay(10000);
        if (progressCallback) {
          const progress = 80 + (attempt * 0.5) + (inputIndex * 0.5); // Small increment for combination
          await progressCallback(progress);
        }
        remainingTokens = tpmLimit;
      }

      const finalSummaryResponse = await openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          { role: 'system', content: combinedPrompt },
          { role: 'user', content: combinedInput }
        ],
        max_tokens: currentMaxTokens
      });

      let finalSummary;
      try {
        finalSummary = JSON.parse(finalSummaryResponse.choices[0].message.content);
      } catch (error) {
        throw new Error(`Failed to parse combined summary: ${error.message}`);
      }

      success = true;
      remainingTokens = Math.max(0, remainingTokens - requestTokens);

      return {
        summaryText: finalSummary.summary,
        keypoints: finalSummary.keypoints,
        timestamps: finalSummary.timestamps
      };
    } catch (error) {
      if (error.code === 'rate_limit_exceeded' && attempt < maxRetries - 1) {
        const retryAfterMs = parseResetTokens(error.headers?.['x-ratelimit-reset-tokens']) || parseInt(error.headers?.['retry-after-ms']) || 10000;
        // Update progress incrementally during long delays
        const delayStart = Date.now();
        const delayDuration = retryAfterMs;
        while (Date.now() - delayStart < delayDuration) {
          const elapsed = Date.now() - delayStart;
          const progressIncrement = (elapsed / delayDuration) * 0.1; // 0.1% per second
          if (progressCallback) {
            const progress = 80 + (attempt * 0.5) + (inputIndex * 0.5) + progressIncrement;
            await progressCallback(progress);
          }
          await delay(Math.min(1000, delayDuration - elapsed)); // Update every 1s
        }
        attempt++;
        remainingTokens = parseInt(error.headers?.['x-ratelimit-remaining-tokens']) || tpmLimit;

        // Split input or reduce max_tokens
        if (requestTokens > 3000 && inputIndex === 0 && combinedInputParts.length === 1) {
          const maxInputTokens = 3000; // Target ~3,000 tokens per part
          combinedInputParts = splitCaptions(combinedInput, maxInputTokens); // Reuse splitCaptions
          inputIndex = 0; // Reset to process new parts
          attempt = 0; // Reset attempts for new parts
        } else if (currentMaxTokens > 1024) {
          currentMaxTokens = Math.floor(currentMaxTokens / 2);
        }
      } else {
        if (inputIndex < combinedInputParts.length - 1) {
          inputIndex++; // Try next input part
          attempt = 0; // Reset attempts for new part
          currentMaxTokens = 2048; // Reset max_tokens
        } else {
          throw error;
        }
      }
    }
  }

  throw new Error(`Failed to combine summaries after ${maxRetries} attempts for all input parts`);
};

agenda.define('transcribeVideo', async (job) => {
  const { videoId, userId, advancedFeatures } = job.attrs.data;
  const { language, length, tone } = advancedFeatures;
  try {
    job.attrs.data.status = 'pending';
    job.attrs.data.progress = 0;
    job.attrs.data.estimatedTimeRemaining = 180; // Increased initial estimate
    await job.save();

    job.attrs.data.progress = 10;
    job.attrs.data.estimatedTimeRemaining = 150; // Adjusted for smoother transition
    await job.save();

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let captions, videoTitle, shareableName, thumbnailUrl, videoTimestamp;

    const existingCaption = await Caption.findOne({ videoId });
    if (existingCaption) {
      captions = existingCaption.rawCaptions;
      videoTitle = existingCaption.videoTitle;
      thumbnailUrl = existingCaption.thumbnailUrl;
      videoTimestamp = existingCaption.videoTimestamp;
      shareableName = await incrementShareableName(videoId, existingCaption.shareableName);
    } else {
      job.attrs.data.progress = 20;
      job.attrs.data.estimatedTimeRemaining = 120;
      await job.save();

      captions = await fetchVideoCaptions(videoId, getIsoLanguage(language));
      const { title, thumbnail, lengthSeconds } = await getVideoTitle(videoId);
      videoTitle = title || 'Untitled Video';
      thumbnailUrl = thumbnail || '';
      videoTimestamp = formatSecondsToMinutes(lengthSeconds) || null;
      shareableName = await generateShareableLinkName(videoTitle, getIsoLanguage(language));
      const newCaption = new Caption({
        videoUrl,
        videoId,
        videoTitle,
        rawCaptions: captions,
        shareableName,
        videoTimestamp,
        thumbnailUrl,
      });
      await newCaption.save();
    }

    job.attrs.data.progress = 40; // Earlier update for smoother progress
    job.attrs.data.estimatedTimeRemaining = 90;
    await job.save();

    const summaryTitle = videoTitle || await getVideoTitle(videoId);

    let summaryText, keypoints, timestamps;
    const tokenCount = estimateTokens(captions);
    const tokenThreshold = 25000; // Safe limit to avoid 30,000 TPM cap

    if (tokenCount > tokenThreshold) {
      // Process large captions by splitting and combining
      const progressCallback = async (progress) => {
        job.attrs.data.progress = progress;
        job.attrs.data.estimatedTimeRemaining = Math.max(30, 90 - (progress - 60) * 1.5); // More dynamic
        await job.save();
      };
      const result = await processLargeCaptions(captions, language, length, tone, progressCallback);
      summaryText = result.summaryText;
      keypoints = result.keypoints;
      timestamps = result.timestamps;
    } else {
      // Process normally for smaller captions
      job.attrs.data.progress = 60;
      job.attrs.data.estimatedTimeRemaining = 60;
      await job.save();

      const prompt = transcriptPrompt(language, length, tone);
      const summary = await openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: captions }
        ],
        max_tokens: 4096
      });

      try {
        const parsedSummary = JSON.parse(summary.choices[0].message.content);
        summaryText = parsedSummary.summary || summary.choices[0].message.content.trim();
        keypoints = parsedSummary.keypoints || [];
        timestamps = parsedSummary.timestamps || [];
      } catch (error) {
        if (userId !== null) {
          await User.findByIdAndUpdate(userId, { $inc: { summariesUsedToday: -1 } });
        }
        throw error;
      }
    }

    job.attrs.data.progress = 90;
    job.attrs.data.estimatedTimeRemaining = 30;
    await job.save();

    const shareableLink = `${process.env.DOMAIN_FRONTEND}/share/${shareableName}`;

    const newSummary = new Summary({
      userId,
      videoUrl,
      platform: 'youtube',
      summaryTitle,
      summaryText,
      keypoints,
      timestamps,
      language: language.toLowerCase(),
      summaryTone: toneMap[tone] || 'formal',
      summaryLength: lengthMap[length] || 'medium',
      shareableLink,
      thumbnailUrl,
      videoTimestamp
    });
    await newSummary.save();

    const summaryObj = {
      keypoints,
      summaryText,
      timestamps,
      language,
      summaryLength: lengthMap[length] || 'medium',
      summaryTone: toneMap[tone] || 'formal',
      shareableLink,
      thumbnailUrl,
      videoTimestamp,
      summaryTitle,
      _id: newSummary._id,
      userId
    };

    job.attrs.data.progress = 100;
    job.attrs.data.estimatedTimeRemaining = 0;
    job.attrs.data.status = 'completed';
    job.attrs.data.result = {
      status: 'completed',
      summary: JSON.stringify(summaryObj)
    };
    await job.save();
  } catch (error) {
    if (userId !== null) {
      await User.findByIdAndUpdate(userId, { $inc: { summariesUsedToday: -1 } });
    }
    job.attrs.data.status = 'failed';
    job.attrs.data.error = error.message;
    job.attrs.data.result = { status: 'failed', error: error.message };
    await job.save();
    throw error;
  }
});

agenda.define('transcribeUploadedVideo', { lockLifetime: 300000 }, async (job) => {
  const { videoUrl, publicId, taskId, userId, advancedFeatures } = job.attrs.data;
  const { language, length, tone } = advancedFeatures;
  try {
    job.attrs.data.status = 'pending';
    job.attrs.data.progress = 0;
    job.attrs.data.estimatedTimeRemaining = 300;
    await job.save();

    job.attrs.data.progress = 20;
    job.attrs.data.estimatedTimeRemaining = 250;
    await job.save();

    let mp3Stream;
    if (videoUrl.match(/\.(mov|mp4)$/i)) {
      const { stream } = await convertToMp3(videoUrl);
      mp3Stream = stream;
    } else if (videoUrl.match(/\.(mp3|wav|m4a)$/i)) {
      const { stream } = await validateAudioUrl(videoUrl);
      mp3Stream = stream;
    } else {
      await deleteFromCloudinary(publicId);
      throw new Error('Unsupported file format. Expected .mov, .mp4, .mp3, .wav, or .m4a');
    }

    job.attrs.data.progress = 60;
    job.attrs.data.estimatedTimeRemaining = 150;
    await job.save();

    const rawCaptions = await transcribeAudio(mp3Stream, language);
    if (!rawCaptions || rawCaptions.trim() === '') {
      await deleteFromCloudinary(publicId);
      throw new Error('Transcription failed: No captions generated.');
    }

    job.attrs.data.progress = 80;
    job.attrs.data.estimatedTimeRemaining = 100;
    await job.save();

    const summaryTitle = await generateTitle(rawCaptions, language);

    let shareableName = await generateShareableLinkName(summaryTitle, language);
    let founded = true;
    let maxRetries = 10;
    let retries = 0;
    while (founded && retries < maxRetries) {
      const link = `${process.env.DOMAIN_FRONTEND}/share/${shareableName}`;
      const summaries = await Summary.find({ shareableLink: link });
      if (!summaries.length) {
        founded = false;
        break;
      }
      shareableName += `-${retries + 1}`;
      retries++;
      if (retries >= maxRetries) {
        await deleteFromCloudinary(publicId);
        throw new Error('Unable to generate a unique shareable link after maximum retries');
      }
    }

    job.attrs.data.progress = 90;
    job.attrs.data.estimatedTimeRemaining = 50;
    await job.save();

    const prompt = transcriptPrompt(language, length, tone);
    const summary = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: rawCaptions }
      ],
      max_tokens: 14000
    });

    let summaryText, keypoints, timestamps;
    try {
      const parsedSummary = JSON.parse(summary.choices[0].message.content);
      summaryText = parsedSummary.summary || summary.choices[0].message.content.trim();
      keypoints = parsedSummary.keypoints || [];
      timestamps = parsedSummary.timestamps || [];
    } catch (error) {
      await deleteFromCloudinary(publicId);
      throw error;
    }

    const shareableLink = `${process.env.DOMAIN_FRONTEND}/share/${shareableName}`;

    if (userId) {
      const newSummary = new Summary({
        userId,
        videoUrl,
        platform: 'other',
        summaryTitle,
        summaryText,
        keypoints,
        timestamps,
        language: language.toLowerCase(),
        summaryTone: toneMap[tone] || 'formal',
        summaryLength: lengthMap[length] || 'medium',
        shareableLink
      });
      await newSummary.save();

      const summaryObj = {
        keypoints,
        summaryTitle,
        summaryText,
        keypoints,
        timestamps,
        language,
        summaryLength: lengthMap[length] || 'medium',
        summaryTone: toneMap[tone] || 'formal',
        shareableLink,
        _id: newSummary._id,
      };

      job.attrs.data.progress = 100;
      job.attrs.data.estimatedTimeRemaining = 0;
      job.attrs.data.status = 'completed';
      job.attrs.data.result = {
        status: 'completed',
        summary: JSON.stringify(summaryObj)
      };
      await job.save();
    }

    await deleteFromCloudinary(publicId);
  } catch (error) {
    await deleteFromCloudinary(publicId);
    job.attrs.data.status = 'failed';
    job.attrs.data.error = error.message;
    await job.save();
    throw error;
  }
});

module.exports = agenda;