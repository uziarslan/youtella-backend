const Agenda = require('agenda');
const OpenAI = require('openai');
const mongoose = require('mongoose');
const Summary = mongoose.model('Summary');
const Caption = mongoose.model('Caption');
const User = mongoose.model("User");
const { transcriptPrompt } = require('../utils/prompts');
const { cloudinary } = require("../cloudinary/index");
const fetch = require('node-fetch');
const axios = require("axios");

const openai = new OpenAI({
  apiKey: process.env.GPT_SECRET_KEY
});

const agenda = new Agenda({
  db: { address: process.env.MONGODB_URI },
  processEvery: '10 seconds',
  maxConcurrency: 5
});

// Language mapping
const languageMap = {
  'english': 'en',
  'spanish': 'es',
  'french': 'fr',
  'german': 'de',
  'italian': 'it',
  'portuguese': 'pt',
  'russian': 'ru',
  'chinese': 'zh',
  'japanese': 'ja',
  'korean': 'ko',
};

// Tone and length mapping
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

// Utility functions
function stripQuotes(str) {
  return str.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

function getIsoLanguage(language) {
  const normalized = language.toLowerCase();
  return languageMap[normalized] || normalized;
}

async function convertToMp3(videoSource) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('Starting video to MP3 conversion via Cloudinary...');

      // Extract publicId from Cloudinary videoSource URL
      const urlParts = videoSource.match(/\/Youtella\/videos\/(.+)\.(?:mov|mp4)$/i);
      if (!urlParts) {
        throw new Error('Invalid Cloudinary video URL. Expected format: /Youtella/videos/...mov or ...mp4');
      }
      // Remove file extension from publicId
      const publicId = `Youtella/videos/${urlParts[1].replace(/\.(mov|mp4)$/i, '')}`;
      console.log('Extracted publicId:', publicId);

      // Verify the original video exists
      const videoCheck = await fetch(videoSource);
      if (!videoCheck.ok) {
        throw new Error(`Original video not found: ${videoCheck.statusText}`);
      }
      console.log('Original video is accessible');

      // Generate MP3 URL using Cloudinary transformation
      const audioUrl = cloudinary.url(`${publicId}`, {
        resource_type: 'video',
        format: 'mp3',
        audio_codec: 'mp3',
        audio_bitrate: '128k',
        secure: true,
      });
      console.log('Generated Cloudinary MP3 URL:', audioUrl);

      // Fetch the MP3 as a stream
      const response = await fetch(audioUrl);
      if (!response.ok) {
        console.error('Fetch response status:', response.status);
        console.error('Fetch response headers:', Object.fromEntries(response.headers));
        throw new Error(`Failed to fetch MP3 from Cloudinary: ${response.statusText}`);
      }
      const outputStream = response.body;

      console.log('MP3 stream generated via Cloudinary');
      resolve({ stream: outputStream });
    } catch (err) {
      console.error('Cloudinary MP3 conversion failed:', err.message);
      reject(new Error(`Cloudinary MP3 conversion failed: ${err.message}`));
    }
  });
}

async function validateAudioUrl(audioSource) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('Validating audio file...');

      // Expect audio files in /Youtella/audio/ with .mp3 or .wav extension
      const urlParts = audioSource.match(/\/Youtella\/audio\/(.+)\.(?:mp3|wav)$/i);
      if (!urlParts) {
        throw new Error('Invalid Cloudinary audio URL. Expected format: /Youtella/audio/...mp3 or ...wav');
      }
      console.log('Audio URL is valid:', audioSource);

      // Verify the audio file exists
      const audioCheck = await fetch(audioSource);
      if (!audioCheck.ok) {
        throw new Error(`Audio file not found: ${audioCheck.statusText}`);
      }
      console.log('Audio file is accessible');

      // Return the audio stream
      const response = await fetch(audioSource);
      if (!response.ok) {
        console.error('Fetch response status:', response.status);
        console.error('Fetch response headers:', Object.fromEntries(response.headers));
        throw new Error(`Failed to fetch audio: ${response.statusText}`);
      }
      const outputStream = response.body;

      console.log('Audio stream retrieved successfully');
      resolve({ stream: outputStream });
    } catch (err) {
      console.error('Audio validation failed:', err.message);
      reject(new Error(`Audio validation failed: ${err.message}`));
    }
  });
}

async function uploadToCloudinary(stream, publicId) {
  return new Promise((resolve, reject) => {
    console.log(`Starting Cloudinary upload for publicId: ${publicId}`);
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        public_id: publicId,
        folder: 'Youtella/audio',
        format: 'mp3',
        timeout: 300000,
        audio_codec: 'mp3',
        audio_bitrate: '128k'
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload failed:', error.message);
          return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        }
        console.log('Cloudinary upload successful:', result.secure_url);
        resolve(result.secure_url);
      }
    );
    stream.pipe(uploadStream).on('error', (err) => {
      console.error('Stream piping error:', err.message);
      reject(err);
    });
  });
}

async function transcribeAudio(audioUrl, language) {
  console.log(`Transcribing audio from: ${audioUrl}`);
  if (!audioUrl) {
    throw new Error('Audio URL is undefined');
  }
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }
    const audioBuffer = await response.buffer();
    const file = new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' });
    const isoLanguage = getIsoLanguage(language);
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: isoLanguage
    });
    console.log('Transcription completed');
    return transcription.text || '';
  } catch (error) {
    console.error('Audio transcription failed:', error.message);
    throw new Error(`Audio transcription failed: ${error.message}`);
  }
}

async function generateTitle(captions, language = 'english') {
  console.log('Generating video title with GPT...');
  if (!captions || captions.trim() === '') {
    console.warn('No captions provided for title generation');
    return 'Untitled Video';
  }
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `Generate concise video titles based on captions in ${language.toLowerCase()}.`
        },
        {
          role: 'user',
          content: `Generate a title for a video based on these captions:\n\n${captions.substring(0, 1000)}`
        }
      ],
      max_tokens: 50
    });
    const title = stripQuotes(completion.choices[0].message.content.trim());
    console.log(`Generated title: ${title}`);
    return title;
  } catch (error) {
    console.error('Title generation failed:', error.message);
    return 'Untitled Video';
  }
}

async function deleteFromCloudinary(publicId) {
  try {
    const baseId = publicId.replace(/^Youtella\//, '');
    await Promise.all([
      cloudinary.uploader.destroy(`Youtella/${baseId}`, { resource_type: 'video' }),
      cloudinary.uploader.destroy(`Youtella/audio/${baseId}_audio`, { resource_type: 'video' })
    ]);
    console.log(`Successfully deleted video and audio assets for publicId: ${publicId}`);
  } catch (error) {
    console.error('Failed to delete assets from Cloudinary:', error.message);
  }
}

async function fetchVideoCaptions(videoId, language = 'en') {
  console.log(`Fetching captions for videoId: ${videoId}, language: ${language}`);
  try {
    const options = {
      method: 'GET',
      url: `https://youtube-captions-transcript-subtitles-video-combiner.p.rapidapi.com/download-srt/${videoId}`,
      params: { language },
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': process.env.RAPIDAPI_HOST
      }
    };

    const response = await axios.request(options);
    if (response.status !== 200) {
      throw new Error(`Failed to fetch captions: ${response.statusText}`);
    }
    const captions = await response.data;
    return captions;
  } catch (error) {
    console.error('Error fetching captions:', error.message);
    throw new Error(`Failed to fetch captions: ${error.message}`);
  }
}

async function getVideoTitle(videoId) {
  console.log(`Fetching title for videoId: ${videoId}`);
  try {
    const options = {
      method: 'GET',
      url: `https://youtube-captions-transcript-subtitles-video-combiner.p.rapidapi.com/get-video-info/${videoId}`,
      params: { format: 'json' },
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': process.env.RAPIDAPI_HOST
      }
    };

    const response = await axios.request(options);
    if (response.status !== 200) {
      throw new Error("Failed to fetch title", response.statusText);
    }
    return response.data.title;
  } catch (error) {
    console.error('Error fetching video title:', error.message);
    return 'Untitled Video';
  }
}

agenda.define('transcribeVideo', async (job) => {
  const { videoId, userId, advancedFeatures } = job.attrs.data;
  const { language, length, tone } = advancedFeatures;
  console.log(`Starting video transcription job for videoId: ${videoId}`, { language, length, tone });

  try {
    job.attrs.data.status = 'pending';
    job.attrs.data.progress = 0;
    job.attrs.data.estimatedTimeRemaining = 120;
    await job.save();

    console.log('Step 1: Checking for cached captions...');
    job.attrs.data.progress = 10;
    await job.save();

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let captions;
    let videoTitle;

    const existingCaption = await Caption.findOne({ videoId });
    if (existingCaption) {
      console.log('Using cached captions');
      captions = existingCaption.rawCaptions;
      videoTitle = existingCaption.videoTitle;
    } else {
      console.log('No cached captions found, fetching from API...');
      job.attrs.data.progress = 20;
      job.attrs.data.estimatedTimeRemaining = 100;
      await job.save();

      captions = await fetchVideoCaptions(videoId, getIsoLanguage(language));
      videoTitle = await getVideoTitle(videoId);

      const newCaption = new Caption({
        videoUrl,
        videoId,
        videoTitle,
        rawCaptions: captions
      });
      await newCaption.save();
      console.log('Captions saved to database');
    }

    console.log('Step 2: Generating title...');
    job.attrs.data.progress = 80;
    job.attrs.data.estimatedTimeRemaining = 40;
    await job.save();

    const summaryTitle = videoTitle || await getVideoTitle(videoId);

    console.log('Step 3: Generating summary...');
    job.attrs.data.progress = 90;
    job.attrs.data.estimatedTimeRemaining = 20;
    await job.save();

    const prompt = transcriptPrompt(language, length, tone);
    const summary = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: captions }
      ],
      max_tokens: 14000
    });

    let summaryText, keypoints, timestamps;
    try {
      console.log(summary.choices[0].message.content);
      const parsedSummary = JSON.parse(summary.choices[0].message.content);
      console.log(parsedSummary);
      summaryText = parsedSummary.summary || summary.choices[0].message.content.trim();
      keypoints = parsedSummary.keypoints || [];
      timestamps = parsedSummary.timestamps || [];
    } catch (error) {
      if (userId !== null) {
        await User.findByIdAndUpdate(userId, { $inc: { summariesUsedToday: -1 } });
      }
      throw new Error(error);
    }

    console.log('Summary generated:', { summaryText, keypoints, timestamps });

    const summaryObj = {
      keypoints,
      summary: summaryText,
      timestamps,
      language,
      summaryLength: lengthMap[length] || 'medium',
      summaryTone: toneMap[tone] || 'formal'
    };

    job.attrs.data.progress = 100;
    job.attrs.data.estimatedTimeRemaining = 0;
    job.attrs.data.status = 'completed';
    job.attrs.data.result = {
      status: 'completed',
      summary: JSON.stringify(summaryObj)
    };
    await job.save();

    if (userId) {
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
        summaryLength: lengthMap[length] || 'medium'
      });
      console.log('Saving Summary document:', {
        userId,
        videoUrl,
        platform: 'youtube',
        summaryTitle,
        summaryText: summaryText.substring(0, 100),
        keypoints,
        timestamps,
        language: language.toLowerCase(),
        summaryTone: toneMap[tone] || 'formal',
        summaryLength: lengthMap[length] || 'medium'
      });
      await newSummary.save();
    }

    console.log(`Transcription job completed for videoId: ${videoId}`);
  } catch (error) {
    if (userId !== null) {
      await User.findByIdAndUpdate(userId, { $inc: { summariesUsedToday: -1 } });
    }
    console.error('Transcription job failed:', error.message);
    job.attrs.data.status = 'failed';
    job.attrs.data.error = error.message;
    await job.save();
    throw error;
  }
});

agenda.define('transcribeUploadedVideo', { lockLifetime: 300000 }, async (job) => {
  const { videoUrl, publicId, taskId, userId, advancedFeatures } = job.attrs.data;
  const { language, length, tone } = advancedFeatures;
  console.log(`Starting uploaded video transcription job for taskId: ${taskId}`, { advancedFeatures });

  try {
    job.attrs.data.status = 'pending';
    job.attrs.data.progress = 0;
    job.attrs.data.estimatedTimeRemaining = 300;
    await job.save();

    console.log('Step 1: Processing media file...');
    job.attrs.data.progress = 20;
    job.attrs.data.estimatedTimeRemaining = 250;
    await job.save();

    let mp3Stream;
    // Check if the input is a video or audio file
    if (videoUrl.match(/\.(mov|mp4)$/i)) {
      console.log('Detected video file, converting to MP3...');
      const { stream } = await convertToMp3(videoUrl);
      mp3Stream = stream;
      console.log('MP3 stream generated from video');
    } else if (videoUrl.match(/\.(mp3|wav)$/i)) {
      console.log('Detected audio file, validating...');
      const { stream } = await validateAudioUrl(videoUrl);
      mp3Stream = stream;
      console.log('Audio stream validated');
    } else {
      throw new Error('Unsupported file format. Expected .mov, .mp4, .mp3, or .wav');
    }

    console.log('Step 2: Uploading MP3 to Cloudinary...');
    job.attrs.data.progress = 40;
    job.attrs.data.estimatedTimeRemaining = 200;
    await job.save();

    const sanitizedPublicId = publicId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const audioUrl = await uploadToCloudinary(mp3Stream, `${sanitizedPublicId}_audio`);
    console.log(`Audio uploaded to: ${audioUrl}`);

    console.log('Step 3: Transcribing audio...');
    job.attrs.data.progress = 60;
    job.attrs.data.estimatedTimeRemaining = 150;
    await job.save();

    const rawCaptions = await transcribeAudio(audioUrl, language);
    console.log(`Raw captions: ${rawCaptions ? rawCaptions.substring(0, 100) : 'Empty transcription'}`);

    if (!rawCaptions || rawCaptions.trim() === '') {
      throw new Error('Transcription failed: No captions generated.');
    }

    console.log('Step 4: Generating title...');
    job.attrs.data.progress = 80;
    job.attrs.data.estimatedTimeRemaining = 100;
    await job.save();

    const summaryTitle = await generateTitle(rawCaptions, language);

    console.log('Step 5: Generating summary...');
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
      console.log(summary.choices[0].message.content);
      const parsedSummary = JSON.parse(summary.choices[0].message.content);
      console.log(parsedSummary);
      summaryText = parsedSummary.summary || summary.choices[0].message.content.trim();
      keypoints = parsedSummary.keypoints || [];
      timestamps = parsedSummary.timestamps || [];
    } catch (error) {
      throw new Error(error);
    }

    console.log('Summary generated:', { summaryText, keypoints, timestamps });

    const summaryObj = {
      keypoints,
      summary: summaryText,
      timestamps,
      language,
      summaryLength: lengthMap[length] || 'medium',
      summaryTone: toneMap[tone] || 'formal'
    };

    job.attrs.data.progress = 100;
    job.attrs.data.estimatedTimeRemaining = 0;
    job.attrs.data.status = 'completed';
    job.attrs.data.result = {
      status: 'completed',
      summary: JSON.stringify(summaryObj)
    };
    await job.save();

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
        summaryLength: lengthMap[length] || 'medium'
      });
      console.log('Saving Summary document:', {
        userId,
        videoUrl,
        platform: 'other',
        summaryTitle,
        summaryText: summaryText.substring(0, 100),
        keypoints,
        timestamps,
        language: language.toLowerCase(),
        summaryTone: toneMap[tone] || 'formal',
        summaryLength: lengthMap[length] || 'medium'
      });
      await newSummary.save();
    }

    await deleteFromCloudinary(`Youtella/${sanitizedPublicId}`);
    console.log(`Uploaded video transcription job completed for taskId: ${taskId}`);
  } catch (error) {
    console.error('Uploaded video transcription job failed:', error.message);
    job.attrs.data.status = 'failed';
    job.attrs.data.error = error.message;
    await job.save();
    throw error;
  }
});

module.exports = agenda;