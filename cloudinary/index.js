const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET,
  timeout: 7200000,
  debug: true // Enable debug logging
});

// Configure Cloudinary Storage for Images
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "Youtella",
    allowedFormats: ["jpeg", "png", "jpg"],
    public_id: (req, file) => `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9-_]/g, '_')}`,
    transformation: [
      {
        quality: "auto:low",
      },
    ],
  },
});

// Configure Cloudinary Storage for Videos
const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "Youtella/videos",
    allowedFormats: ["mp4", "mov", "avi", "mkv"],
    resource_type: "video",
    public_id: (req, file) => `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9-_]/g, '_')}`,
    chunk_size: 6000000
  },
});

// Configure Cloudinary Storage for Audio
const audioStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "Youtella/audio",
    allowedFormats: ["mp3", "wav"],
    resource_type: "video",
    public_id: (req, file) => `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9-_]/g, '_')}`,
    chunk_size: 6000000
  },
});

module.exports = {
  cloudinary,
  imageStorage,
  videoStorage,
  audioStorage,
};