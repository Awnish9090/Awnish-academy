require('dotenv').config(); // 👈 Is line ko sabse top par hona chahiye!

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const cors = require('cors');
const path = require('path');

const User = require('./models/User');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Fallback API Key agar .env se load na ho
const resend = new Resend(process.env.RESEND_API_KEY || 're_deqFnURY_BczLDjcexJgY4Kpz9iF6aeHe');
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@awnishacademy.online';

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB Connected Successfully!');
    // Auto-Create Default Admin Account
    const adminEmail = process.env.ADMIN_EMAIL || 'awnishac@gmail.com';
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      const hashedPassword = await bcrypt.hash('Admin@9090', 10);
      admin = new User({
        name: 'System Admin',
        email: adminEmail,
        mobile: '0000000000',
        password: hashedPassword,
        role: 'admin',
        referralCode: 'ADMIN1'
      });
      await admin.save();
      console.log('✅ Default Admin Created: awnishac@gmail.com / Admin@9090');
    }
  })
  .catch(err => console.log('DB Connection Error: ', err));

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access Denied' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid Token' });
    req.user = user;
    next();
  });
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// 1. REGISTRATION (WITH REFERRAL CODE SUPPORT)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, mobile, password, refCodeInput } = req.body;
    if (!name || !email || !mobile || !password) return res.status(400).json({ message: 'All fields are required.' });
    if (await User.findOne({ email })) return res.status(400).json({ message: 'This email is already registered.' });
    if (await User.findOne({ mobile })) return res.status(400).json({ message: 'This mobile number is already registered.' });

    let referredBy = null;
    if (refCodeInput && refCodeInput.trim() !== '') {
      const parentUser = await User.findOne({ referralCode: refCodeInput.trim().toUpperCase() });
      if (parentUser) referredBy = parentUser.referralCode;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const refCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const user = new User({ name, email, mobile, password: hashedPassword, referralCode: refCode, referredBy });
    await user.save();

    res.status(201).json({ message: 'Registration Successful!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: 'Galat Email ya Password!' });
    }
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. FORGOT PASSWORD (OTP Request)
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'Email not registered.' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + 5 * 60 * 1000;
    await user.save();

    resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: '🔑 Password Reset OTP',
      text: `Aapka Password Reset OTP hai: ${otp} (5 minutes tak valid hai)`
    }).catch(e => console.log('Resend Mail error:', e));

    res.json({ message: 'OTP aapke Email par bhej diya gaya hai!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. RESET PASSWORD WITH OTP
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email, otp });

    if (!user || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: 'Wrong or Expired OTP!' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ message: 'Password Reset Successful.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. DASHBOARD & AUTO REWARDS & DOWNLINE CALCULATION
app.get('/api/user/dashboard', authenticateToken, async (req, res) => {
  try {
    let user = await User.findById(req.user.id).select('-password');
    const now = new Date();

    let updated = false;
    user.pendingSubmissions = user.pendingSubmissions.filter(sub => {
      if (now >= new Date(sub.creditTime)) {
        user.walletBalance += sub.amount;
        user.totalEarned += sub.amount;
        user.submissionsHistory.unshift({
          pages: sub.pages,
          amount: sub.amount,
          date: new Date().toLocaleString()
        });
        user.transactionsHistory.unshift({
          type: `Approved ${sub.pages} pages`,
          amount: sub.amount,
          date: new Date().toLocaleString()
        });
        updated = true;
        return false;
      }
      return true;
    });

    const downline = await User.find({ referredBy: user.referralCode }).select('name email activePlan createdAt');
    const directActiveCount = downline.filter(u => u.activePlan !== 'No Active Plan').length;

    const rewardsList = [
      { id: 'starter', name: 'Starter Reward', directNeed: 3, bonus: 500 },
      { id: 'builder', name: 'Team Builder', directNeed: 5, bonus: 1000 },
      { id: 'leader', name: 'Team Leader', directNeed: 8, bonus: 2000 },
      { id: 'elite', name: 'Elite Achiever', directNeed: 20, bonus: 7000 }
    ];

    for (let r of rewardsList) {
      if (directActiveCount >= r.directNeed && !user.claimedRewards.includes(r.id)) {
        user.walletBalance += r.bonus;
        user.totalEarned += r.bonus;
        user.claimedRewards.push(r.id);
        user.transactionsHistory.unshift({
          type: `🎁 Target Bonus: ${r.name}`,
          amount: r.bonus,
          date: new Date().toLocaleString()
        });
        updated = true;
      }
    }

    if (updated) await user.save();

    res.json({
      ...user.toObject(),
      downline,
      directActiveCount
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. SUBMIT PAGE
app.post('/api/user/submit-page', authenticateToken, async (req, res) => {
  try {
    const { imageBase64, pageCount } = req.body;
    const user = await User.findById(req.user.id);

    if (user.activePlan === 'No Active Plan') {
      return res.status(400).json({ message: 'Pehle koi Plan Deposit karke Activate karein!' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (user.lastSubmissionDate === todayStr) {
      return res.status(400).json({ message: 'Per day sirf 1 page submission allowed hai!' });
    }

    const earnedAmount = (user.perPageRate || 210) * Number(pageCount);
    const creditTime = new Date(Date.now() + 10 * 60 * 1000);

    user.lastSubmissionDate = todayStr;
    user.pendingSubmissions.push({ pages: pageCount, amount: earnedAmount, creditTime });
    await user.save();

    let attachments = [];
    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      attachments.push({
        filename: 'submission.jpg',
        content: Buffer.from(base64Data, 'base64')
      });
    }

    resend.emails.send({
      from: FROM_EMAIL,
      to: [process.env.ADMIN_EMAIL || 'awnishac@gmail.com'],
      subject: `📄 New Page Submission: ${user.name}`,
      text: `User: ${user.name} (${user.email})\nPages: ${pageCount}\nPlan: ${user.activePlan}`,
      attachments
    }).catch(e => console.log('Resend Mail error:', e));

    res.json({ message: 'Page Submitted! 10 Minutes me balance wallet me credit ho jayega.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. DEPOSIT REQUEST
app.post('/api/user/deposit', authenticateToken, async (req, res) => {
  try {
    const { planName, amount, perPageRate, utr, screenshotBase64 } = req.body;
    const user = await User.findById(req.user.id);

    user.depositRequests.unshift({
      planName,
      amount: Number(amount),
      perPageRate: Number(perPageRate),
      utr,
      screenshotBase64,
      status: 'PENDING'
    });
    await user.save();

    let attachments = [];
    if (screenshotBase64) {
      const base64Data = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
      attachments.push({
        filename: 'screenshot.jpg',
        content: Buffer.from(base64Data, 'base64')
      });
    }

    resend.emails.send({
      from: FROM_EMAIL,
      to: [process.env.ADMIN_EMAIL || 'awnishac@gmail.com'],
      subject: `💵 Deposit Request: ₹${amount} (${planName})`,
      text: `User Details:\nName: ${user.name}\nEmail: ${user.email}\nMobile: ${user.mobile}\nPlan: ${planName} (₹${amount})\nRate Per Page: ₹${perPageRate}\nUTR Ref: ${utr}`,
      attachments
    }).catch(e => console.log('Resend Mail error:', e));

    res.json({ message: 'Deposit Request Submitted! Wait for plan active.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. WITHDRAWAL REQUEST
app.post('/api/user/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, upi, name, bank, accountNo, ifsc } = req.body;
    const user = await User.findById(req.user.id);

    if (user.walletBalance < Number(amount)) {
      return res.status(400).json({ message: 'Low Balance! Apke wallet me itna balance nahi hai.' });
    }

    user.withdrawalRequests.unshift({
      amount: Number(amount),
      upi,
      name,
      bank,
      accountNo,
      ifsc,
      status: 'PENDING'
    });
    await user.save();

    resend.emails.send({
      from: FROM_EMAIL,
      to: [process.env.ADMIN_EMAIL || 'awnishac@gmail.com'],
      subject: `🏦 Withdrawal Request: ₹${amount}`,
      text: `User: ${user.name} (${user.email})\nAmount: ₹${amount}\nUPI: ${upi}\nBank: ${bank}\nAccount: ${accountNo}\nIFSC: ${ifsc}\nHolder Name: ${name}`
    }).catch(e => console.log('Resend Mail error:', e));

    res.json({ message: 'Withdrawal Request submitted successfully!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. SUPPORT CHAT
app.post('/api/user/support-msg', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;
    const user = await User.findById(req.user.id);

    resend.emails.send({
      from: FROM_EMAIL,
      to: [process.env.ADMIN_EMAIL || 'awnishac@gmail.com'],
      subject: `💬 Support Query from ${user.name}`,
      text: `User: ${user.name} (${user.email})\nMessage: ${text}`
    }).catch(e => console.log('Resend Mail error:', e));

    res.json({ message: 'Message sent to Admin Email!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET ALL DATA FOR ADMIN PANEL
app.get('/api/admin/all-data', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });

    const users = await User.find({ role: { $ne: 'admin' } }).select('-password');
    
    let deposits = [];
    let withdrawals = [];

    users.forEach(u => {
      (u.depositRequests || []).forEach(d => {
        if (d.status === 'PENDING') {
          deposits.push({ ...d.toObject(), userName: u.name, userEmail: u.email, userId: u._id });
        }
      });

      (u.withdrawalRequests || []).forEach(w => {
        if (w.status === 'PENDING') {
          withdrawals.push({ ...w.toObject(), userName: u.name, userEmail: u.email, userId: u._id, currentBalance: u.walletBalance });
        }
      });
    });

    res.json({ users, deposits, withdrawals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ALL USERS FOR ADMIN PANEL (Fixes 404 Error)
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });

    const users = await User.find({ role: { $ne: 'admin' } }).select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// APPROVE WITHDRAWAL REQUEST
app.post('/api/admin/approve-withdraw', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
    const { userId, reqId } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const reqObj = user.withdrawalRequests.id(reqId);
    if (reqObj && reqObj.status === 'PENDING') {
      reqObj.status = 'APPROVED';
      const approvedAmount = reqObj.amount;

      user.walletBalance = 0;
      user.transactionsHistory.unshift({
        type: 'Withdrawal Approved (Paid)',
        amount: -approvedAmount,
        date: new Date().toLocaleString()
      });

      await user.save();
      return res.json({ message: 'Withdrawal Approved! User wallet set to 0.' });
    }
    res.status(400).json({ message: 'Request not found or already processed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// APPROVE PLAN DEPOSIT REQUEST
app.post('/api/admin/approve-deposit', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
    const { userId, reqId } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const reqObj = user.depositRequests.id(reqId);
    if (reqObj && reqObj.status === 'PENDING') {
      reqObj.status = 'APPROVED';
      user.activePlan = reqObj.planName;
      user.perPageRate = reqObj.perPageRate;

      user.transactionsHistory.unshift({
        type: `Plan Activated (${reqObj.planName})`,
        amount: reqObj.amount,
        date: new Date().toLocaleString()
      });

      await user.save();
      return res.json({ message: 'Plan Approved & Deposit Balance Credited!' });
    }
    res.status(400).json({ message: 'Request not found.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MANUAL PLAN APPROVAL
app.post('/api/admin/approve-plan/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  const { planName, perPageRate } = req.body;
  await User.findByIdAndUpdate(req.params.id, { activePlan: planName, perPageRate: Number(perPageRate) });
  res.json({ message: 'Plan approved and activated!' });
});

// DELETE USER
app.delete('/api/admin/delete-user/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: 'User deleted permanently!' });
});

// RESET USER BALANCE
app.post('/api/admin/user-reset/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  await User.findByIdAndUpdate(req.params.id, { walletBalance: 0, totalEarned: 0, activePlan: 'No Active Plan' });
  res.json({ message: 'User balance reset to 0.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Health check ping endpoint
app.get('/ping', (req, res) => {
  res.status(200).send('Server is awake!');
});