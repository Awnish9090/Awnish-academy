const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mobile: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  
  walletBalance: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  activePlan: { type: String, default: 'No Active Plan' },
  perPageRate: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },

  lastSubmissionDate: { type: String }, // Per day 1 page submission check
  pendingSubmissions: [{
    pages: Number,
    amount: Number,
    creditTime: Date
  }],

  submissionsHistory: [{
    pages: Number,
    amount: Number,
    date: String,
    status: { type: String, default: 'APPROVED' }
  }],

  transactionsHistory: [{
    type: { type: String },
    amount: Number,
    date: String
  }],

  // Forgot Password OTP Fields
  otp: { type: String },
  otpExpires: { type: Date },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);