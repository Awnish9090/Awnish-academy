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
  referredBy: { type: String, default: null },

  lastSubmissionDate: { type: String },
  pendingSubmissions: [{
    pages: Number,
    amount: Number,
    creditTime: Date
  }],

  // Admin approval ke liye yeh arrays hona zaroori hai
  depositRequests: [{
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    planName: String,
    amount: Number,
    perPageRate: Number,
    utr: String,
    screenshotBase64: String,
    status: { type: String, default: 'PENDING' },
    date: { type: Date, default: Date.now }
  }],

  withdrawalRequests: [{
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    amount: Number,
    upi: String,
    name: String,
    bank: String,
    accountNo: String,
    ifsc: String,
    status: { type: String, default: 'PENDING' },
    date: { type: Date, default: Date.now }
  }],

  claimedRewards: [{ type: String }],

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

  otp: { type: String },
  otpExpires: { type: Date },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);