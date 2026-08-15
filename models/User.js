const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mobile: { type: String, required: true, unique: true, maxlength: 10 },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  
  walletBalance: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  activePlan: { type: String, default: 'No Active Plan' },
  perPageRate: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },

  // --- REFERRAL SYSTEM FIELDS ---
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  referredCodeUsed: { type: String, default: null },
  referralBonusEarned: { type: Number, default: 0 },
  directReferralsCount: { type: Number, default: 0 },
  // -----------------------------

  lastSubmissionDate: { type: String },
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

  // --- WITHDRAWALS & DEPOSITS TRACKING ---
  withdrawals: [{
    amount: Number,
    upi: String,
    bank: String,
    accountNo: String,
    ifsc: String,
    name: String,
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    date: { type: String },
    createdAt: { type: Date, default: Date.now }
  }],

  deposits: [{
    planName: String,
    amount: Number,
    perPageRate: Number,
    utr: String,
    screenshotBase64: String,
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    date: { type: String },
    createdAt: { type: Date, default: Date.now }
  }],

  otp: { type: String },
  otpExpires: { type: Date },
  
  createdAt: { type: Date, default: Date.now }
});

// Daily Global Task Schema (Admin to all users)
const TaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  sampleText: { type: String },
  createdAt: { type: Date, default: Date.now, expires: 86400 } // 24 Hours Auto Delete
});

const User = mongoose.model('User', UserSchema);
const Task = mongoose.model('Task', TaskSchema);

module.exports = { User, Task };