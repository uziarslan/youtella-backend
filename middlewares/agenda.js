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

function formatSecondsToMinutes(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const formattedSeconds = String(remainingSeconds).padStart(2, '0');
  return `${minutes}:${formattedSeconds}`;
}

function stripQuotes(str) {
  return str.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

function getIsoLanguage(language) {
  const normalized = language.toLowerCase();
  return languageMap[normalized] || normalized;
}

async function convertToMp3(videoSource) {
  const urlParts = videoSource.match(/\/Youtella\/videos\/(.+)\.(?:mov|mp4)$/i);
  if (!urlParts) {
    throw new Error('Invalid Cloudinary video URL. Expected format: /Youtella/videos/...mov or ...mp4');
  }
  const publicId = `Youtella/videos/${urlParts[1].replace(/\.(mov|mp4)$/i, '')}`;
  const audioUrl = cloudinary.url(`${publicId}`, {
    resource_type: 'video',
    format: 'mp3',
    audio_codec: 'mp3',
    audio_bitrate: '128k',
    secure: true,
  });
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch MP3 from Cloudinary: ${response.statusText}`);
  }
  return { stream: response.body };
}

async function validateAudioUrl(audioSource) {
  const urlParts = audioSource.match(/\/Youtella\/(?:videos|audio)\/(.+)\.(?:mp3|wav|m4a)$/i);
  if (!urlParts) {
    throw new Error('Invalid Cloudinary audio URL. Expected format: /Youtella/(videos|audio)/...mp3, ...wav, or ...m4a');
  }
  const response = await fetch(audioSource);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.statusText}`);
  }
  return { stream: response.body };
}

async function uploadToCloudinary(stream, publicId) {
  return new Promise((resolve, reject) => {
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
          return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        }
        resolve(result.secure_url);
      }
    );
    stream.pipe(uploadStream).on('error', (err) => {
      reject(err);
    });
  });
}

async function transcribeAudio(audioStream, language) {
  const audioBuffer = await new Promise((resolve, reject) => {
    const chunks = [];
    audioStream.on('data', chunk => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
  const file = new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' });
  const isoLanguage = getIsoLanguage(language);
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: isoLanguage
  });
  return transcription.text || '';
}

async function generateTitle(captions, language = 'english') {
  if (!captions || captions.trim() === '') {
    return 'Untitled Video';
  }
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
  return stripQuotes(completion.choices[0].message.content.trim());
}

async function deleteFromCloudinary(publicId) {
  const baseId = publicId.replace(/^Youtella\//, '');
  await Promise.all([
    cloudinary.uploader.destroy(`Youtella/${baseId}`, { resource_type: 'video' }),
    cloudinary.uploader.destroy(`Youtella/audio/${baseId}_audio`, { resource_type: 'video' })
  ]);
}

async function fetchVideoCaptions(videoId, language = 'en') {
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
  return response.data;
}

async function getVideoTitle(videoId) {
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
    return 'Untitled Video';
  }
  return {
    title: response.data.title,
    thumbnail: response.data.thumbnail[0].url,
    lengthSeconds: response.data.lengthSeconds,
  };
}

async function generateShareableLinkName(videoTitle, language = "english") {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `Generate 2 word name for the shareable link based on the provided video title in ${language.toLowerCase()}.`
      },
      {
        role: 'user',
        content: `Generate a 2 word name for a shareable link based on this title, make sure to add a separator in between those words "-", also make sure the name is unique:\n\n${videoTitle}`
      }
    ],
    max_tokens: 50
  });
  return stripQuotes(completion.choices[0].message.content.trim());
}

async function incrementShareableName(videoId, shareableName) {
  const captions = await Caption.findOneAndUpdate(
    { videoId },
    { $inc: { generated: 1 } },
    { new: true }
  );
  return `${shareableName}-${captions.generated}`;
}

agenda.define('transcribeVideo', async (job) => {
  const { videoId, userId, advancedFeatures } = job.attrs.data;
  const { language, length, tone } = advancedFeatures;
  try {
    job.attrs.data.status = 'pending';
    job.attrs.data.progress = 0;
    job.attrs.data.estimatedTimeRemaining = 120;
    await job.save();

    job.attrs.data.progress = 10;
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
      job.attrs.data.estimatedTimeRemaining = 100;
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

    job.attrs.data.progress = 80;
    job.attrs.data.estimatedTimeRemaining = 40;
    await job.save();

    const summaryTitle = videoTitle || await getVideoTitle(videoId);

    job.attrs.data.progress = 90;
    job.attrs.data.estimatedTimeRemaining = 20;
    await job.save();

    const prompt = transcriptPrompt(language, length, tone);
    const summary = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: captions.substring(0, 65000) }
      ],
      max_tokens: 4096
    });

    let summaryText, keypoints, timestamps;
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