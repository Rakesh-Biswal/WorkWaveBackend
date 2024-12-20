// backend/models/Worker.js

const mongoose = require('mongoose');

const workerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    photoURL: { type: String, required: true }, // URL of the uploaded photo in Firebase Storage
    profession: { type: String, required: true },
    experience: { type: Number, required: true },
    location: { type: String,},
    latitude: { type: Number }, // New field for latitude
    longitude: { type: Number }, // New field for longitude
    status: { type: String, enum: ['Active', 'Busy'], default: 'Active' }, // New status field
    clicked: {type: Number,default: 0 },
    planType: { type: String},
    planLimit:{ type: Number},
}, { timestamps: true });

workerSchema.index({ profession: 1 });
workerSchema.index({ email: 1 });
workerSchema.index({ location: "2dsphere" });


module.exports = mongoose.model('Worker', workerSchema);
