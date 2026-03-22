const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Storage для фотографий профиля
const photoStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'eduspace/photos',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }],
    },
});

// Storage для документов
const docStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'eduspace/documents',
        allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
        resource_type: 'auto',
    },
});

const uploadPhoto = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadDoc   = multer({ storage: docStorage,   limits: { fileSize: 10 * 1024 * 1024 } });

module.exports = { cloudinary, uploadPhoto, uploadDoc };
