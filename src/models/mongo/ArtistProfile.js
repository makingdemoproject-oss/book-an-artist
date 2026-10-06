'use strict';

const mongoose = require('mongoose');

// Flexible, read-heavy profile data. `userId` links to users.id (role = 'artist') in MySQL.
const artistProfileSchema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, index: true },
    bio: { type: String, default: '' },
    hourlyRate: { type: Number, min: 0 },
    currency: { type: String, default: 'INR' },
    genres: { type: [String], default: [] },
    city: { type: String },
  },
  { timestamps: true, collection: 'artist_profiles' },
);

module.exports = mongoose.model('ArtistProfile', artistProfileSchema);
