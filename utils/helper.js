const OpenAI = require('openai');
const mongoose = require('mongoose');
const Caption = mongoose.model('Caption');
const { cloudinary } = require("../cloudinary/index");
const fetch = require('node-fetch');
const axios = require("axios");

const openai = new OpenAI({
    apiKey: process.env.GPT_SECRET_KEY
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


module.exports = {
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
}