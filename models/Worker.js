// backend/models/Worker.js

const mongoose = require('mongoose');

const workerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    photoURL: { type: String, required: true }, // URL of the uploaded photo in Firebase Storage
    profession: { type: String, required: true },
    experience: { type: Number, required: true },
    location: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Worker', workerSchema);
