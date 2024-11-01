const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const dotenv = require('dotenv');
const multer = require('multer');
const path = require('path');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const twilio = require('twilio');
const WebSocket = require('ws');

dotenv.config();

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors({
    origin: '*'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let bucket;
try {
    const admin = require('firebase-admin');

    admin.initializeApp({
        credential: admin.credential.cert({
            type: process.env.FIREBASE_TYPE,
            project_id: process.env.FIREBASE_PROJECT_ID,
            private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
            private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Ensure proper formatting of the private key
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            client_id: process.env.FIREBASE_CLIENT_ID,
            auth_uri: process.env.FIREBASE_AUTH_URI,
            token_uri: process.env.FIREBASE_TOKEN_URI,
            auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
            client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    bucket = admin.storage().bucket();

    console.log('✅ Firebase Initialized');

} catch (err) {
    console.error('❌ Firebase Initialization Error:', err);
    process.exit(1);
}



mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => {
        console.error('❌ MongoDB Connection Error:', err);
        process.exit(1);
    });


const Worker = require('./models/Worker');


const otpStore = {};


const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only JPEG, JPG, and PNG images are allowed!'));
    }
});


const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);


function formatPhoneNumber(phone) {

    if (!phone.startsWith('+')) {
        return '+91' + phone;
    }
    return phone;
}


const workerLocations = {}; // Store worker locations by ID

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'updateLocation') {
            const { workerId, location } = data;
            workerLocations[workerId] = location; // Store the latest location

            // Schedule an hourly update to the database
            setTimeout(() => {
                updateWorkerLocationInDatabase(workerId, location);
            }, 3600000); // 1 hour in milliseconds
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });
});

// Function to update worker location in the database
async function updateWorkerLocationInDatabase(workerId, location) {
    try {
        await Worker.findByIdAndUpdate(workerId, { location }, { new: true });
        console.log(`✅ Updated location for worker ${workerId}:`, location);
    } catch (error) {
        console.error(`❌ Failed to update location for worker ${workerId}:`, error);
    }
}




app.post('/api/workers/signin', async (req, res) => {
    const { email, mobile } = req.body;

    try {
        let worker;
        if (email) {
            worker = await Worker.findOne({ email });
        } else if (mobile) {
            const formattedPhone = formatPhoneNumber(mobile);
            worker = await Worker.findOne({ phone: formattedPhone });
        }

        if (worker) {
            return res.status(200).json({ workerId: worker._id });
        } else {
            return res.status(404).json({ message: 'Worker not found.' });
        }
    } catch (error) {
        console.error('Error verifying worker:', error);
        res.status(500).json({ message: 'Server error during sign-in.' });
    }
});

// Endpoint to get worker details by ID
app.get('/api/workers/:workerId', async (req, res) => {
    try {
        const workerId = req.params.workerId;
        const worker = await Worker.findById(workerId); // Adjust based on your model
        if (!worker) {
            return res.status(404).json({ message: 'Worker not found' });
        }
        res.json(worker);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});



app.post('/api/workers/generate-otp', async (req, res) => {
    const { phone } = req.body;

    if (!phone) {
        console.log('❌ OTP Generation Failed: Phone number is missing.');
        return res.status(400).json({ message: 'Phone number is required.' });
    }

    const formattedPhone = formatPhoneNumber(phone);
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // Generate a 6-digit OTP


    otpStore[formattedPhone] = otp;
    console.log(`✅ Generated OTP for ${formattedPhone}: ${otp}`);


    try {
        await twilioClient.messages.create({
            to: formattedPhone,
            from: process.env.TWILIO_PHONE_NUMBER,
            body: `Your OTP for Rakesh Pvt LTD is: ${otp}`
        });
        console.log(`✅ OTP sent to ${formattedPhone}`);
        res.status(200).json({ message: 'OTP sent successfully.' });
    } catch (error) {
        console.error('❌ Twilio Error:', error);
        res.status(500).json({ message: 'Failed to send OTP.' });
    }
});


app.post('/api/workers/verify-otp', async (req, res) => {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
        console.log('❌ OTP Verification Failed: Phone number or OTP is missing.');
        return res.status(400).json({ message: 'Phone number and OTP are required.' });
    }

    const formattedPhone = formatPhoneNumber(phone);
    const storedOtp = otpStore[formattedPhone];
    console.log(`🔍 Verifying OTP for ${formattedPhone}. Stored OTP: ${storedOtp}, Provided OTP: ${otp}`);

    if (storedOtp && storedOtp === otp) {
        delete otpStore[formattedPhone];
        console.log(`✅ OTP verified successfully for ${formattedPhone}`);
        return res.status(200).json({ message: 'OTP verified successfully.' });
    } else {
        console.log(`❌ OTP Verification Failed for ${formattedPhone}: Invalid OTP.`);
        return res.status(400).json({ message: 'Invalid OTP.' });
    }
});

// API Route: Register a New Worker
app.post('/api/workers', upload.single('photo'), async (req, res) => {
    try {
        const { name, phone, email, profession, experience, location } = req.body;
        if (!name || !phone || !email || !profession || !experience || !location) {
            console.log('❌ Registration Failed: Missing required fields.');
            return res.status(400).json({ message: 'All fields are required.' });
        }

        const formattedPhone = formatPhoneNumber(phone);

        const existingWorker = await Worker.findOne({ email });
        if (existingWorker) {
            console.log('❌ Registration Failed: Email already registered.');
            return res.status(400).json({ message: 'Email is already registered.' });
        }

        let photoURL = '';
        if (req.file) {
            const uniqueFileName = `worker_photos/${uuidv4()}_${path.basename(req.file.originalname)}`;
            const file = bucket.file(uniqueFileName);

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
                try {
                    await file.makePublic();
                    photoURL = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
                    console.log(`✅ Image uploaded to Firebase Storage: ${photoURL}`);

                    const newWorker = new Worker({
                        name,
                        phone: formattedPhone,
                        email,
                        photoURL,
                        profession,
                        experience,
                        location,
                    });

                    await newWorker.save();
                    console.log(`✅ Worker registered successfully: ${email}`);
                    res.status(201).json({ message: 'Worker registered successfully.' });
                } catch (err) {
                    console.error('❌ Firebase Post-Upload Error:', err);
                    res.status(500).json({ message: 'Failed to finalize image upload.' });
                }
            });

            stream.end(req.file.buffer);
        } else {
            console.log('❌ Registration Failed: Worker photo is missing.');
            return res.status(400).json({ message: 'Worker photo is required.' });
        }

    } catch (error) {
        console.error('❌ Server Error during Registration:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});


// New route to fetch professions of workers
app.get('/api/workers/professions', async (req, res) => {
    try {
        // Fetch all workers and return only the profession field
        const workers = await Worker.find({}, 'profession');

        // Extract professions and flatten into a single array, splitting by commas
        const professions = workers
            .map(worker => worker.profession)
            .join(',')
            .split(',')
            .map(prof => prof.trim())
            .filter(prof => prof.length > 0);

        // Remove duplicates
        const uniqueProfessions = [...new Set(professions)];

        res.status(200).json({ professions: uniqueProfessions });
    } catch (error) {
        console.error('❌ Failed to fetch professions:', error);
        res.status(500).json({ message: 'Failed to retrieve professions.' });
    }
});



app.get('/api/workers/profession/:profession', async (req, res) => {
    const { profession } = req.params;

    try {
        const workers = await Worker.find({
            profession: { $regex: new RegExp(profession, 'i') }  // Case-insensitive regex match
        });
        res.status(200).json(workers);
    } catch (error) {
        console.error('❌ Error fetching workers by profession:', error);
        res.status(500).json({ message: 'Failed to fetch workers.' });
    }
});


// Get worker details by ID
app.get('/api/workers/:workerId', async (req, res) => {
    const { workerId } = req.params;

    try {
        // Find worker by ID
        const worker = await Worker.findById(workerId);

        if (!worker) {
            return res.status(404).json({ message: 'Worker not found' });
        }

        res.status(200).json(worker);
    } catch (error) {
        console.error('❌ Error fetching worker details:', error);
        res.status(500).json({ message: 'Failed to fetch worker details' });
    }
});



// Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
