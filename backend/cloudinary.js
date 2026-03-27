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

// Storage для видео
const videoStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'eduspace/videos',
        resource_type: 'video',
        allowed_formats: ['mp4', 'mov', 'avi', 'webm'],
        transformation: [{ quality: 'auto' }],
    },
});

const uploadVideo = multer({ storage: videoStorage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB

// Storage для материалов курса
// Cloudinary не поддерживает docx/pptx/xlsx напрямую — используем resource_type: 'raw'
const materialStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
        const ext = file.originalname.split('.').pop().toLowerCase();
        const imageTypes = ['jpg','jpeg','png','gif','webp','bmp'];
        const videoTypes = ['mp4','mov','avi','webm','mkv'];
        const audioTypes = ['mp3','wav','ogg','aac'];

        let resourceType = 'raw'; // default for docs, pdf, zip, etc.
        if (imageTypes.includes(ext)) resourceType = 'image';
        if (videoTypes.includes(ext)) resourceType = 'video';
        if (audioTypes.includes(ext)) resourceType = 'video'; // Cloudinary treats audio as video

        return {
            folder: 'eduspace/materials',
            resource_type: resourceType,
            // No allowed_formats restriction - let all files through
        };
    },
});
const uploadMaterial = multer({
    storage: materialStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        // Allow all common file types
        const allowed = ['jpg','jpeg','png','gif','webp','pdf',
                         'doc','docx','ppt','pptx','xls','xlsx',
                         'mp4','mov','mp3','wav','zip','rar','txt','csv',
                         'js','ts','py','java','cpp','c','html','css','json',
                         'sql','sh','md','xml','yaml','yml'];
        const ext = file.originalname.split('.').pop().toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Формат файла не поддерживается: .' + ext));
        }
    }
}); // 50MB

module.exports = { cloudinary, uploadPhoto, uploadDoc, uploadVideo, uploadMaterial };
