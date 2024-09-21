
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const path = require('path');

// Firebase Admin SDK
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

// Load environment variables from .env file
dotenv.config();

// Initialize Express app
const app = express();

const corsOptions = {
    origin: [
      'http://127.0.0.1:5500/WorkerReg.html',
      'https://work-wave-backend.onrender.com',
    ],
    optionsSuccessStatus: 200,
    credentials: true,
  };

// Middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.urlencoded({ extended: true }));

// Initialize Firebase Admin SDK
const serviceAccount = require('./firebaseServiceAccount.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET, // e.g., your-project-id.appspot.com
});

// Get a reference to Firebase Storage
const bucket = admin.storage().bucket();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
});

// Import Worker Model
const Worker = require('./models/Worker');

// Configure Multer for handling multipart/form-data (for file uploads)
const storage = multer.memoryStorage(); // Store files in memory buffer
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function(req, file, cb) {
        const filetypes = /jpeg|jpg|png/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if(mimetype && extname){
            return cb(null, true);
        }
        cb(new Error('Only JPEG, JPG, and PNG images are allowed!'));
    }
});

// API Route: Register a New Worker
app.post('/api/workers', upload.single('photo'), async (req, res) => {
    try {
        // Validate required fields
        const { name, phone, email, profession, experience, location } = req.body;
        if (!name || !phone || !email || !profession || !experience || !location) {
            return res.status(400).json({ message: 'All fields are required.' });
        }

        // Check if email already exists
        const existingWorker = await Worker.findOne({ email });
        if (existingWorker) {
            return res.status(400).json({ message: 'Email is already registered.' });
        }

        // Handle Image Upload to Firebase Storage
        let photoURL = '';
        if (req.file) {
            const fileName = `worker_photos/${uuidv4()}_${req.file.originalname}`;
            const file = bucket.file(fileName);

            const stream = file.createWriteStream({
                metadata: {
                    contentType: req.file.mimetype,
                },
            });

            stream.on('error', (err) => {
                console.error('❌ Firebase Upload Error:', err);
                return res.status(500).json({ message: 'Failed to upload image.' });
            });

            stream.on('finish', async () => {
                // Make the file public (optional, depending on your use case)
                await file.makePublic();
                photoURL = `https://storage.googleapis.com/${bucket.name}/${file.name}`;

                // Create and save the worker
                const newWorker = new Worker({
                    name,
                    phone,
                    email,
                    photoURL,
                    profession,
                    experience,
                    location,
                });

                await newWorker.save();
                res.status(201).json({ message: 'Worker registered successfully.' });
            });

            stream.end(req.file.buffer);
        } else {
            return res.status(400).json({ message: 'Worker photo is required.' });
        }

    } catch (error) {
        console.error('❌ Server Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});


// Start the Server
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
