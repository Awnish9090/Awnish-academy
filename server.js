const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const User = require('./models/User');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB Connected Successfully!');
    // Auto-Create Default Admin Account
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@gmail.com';
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      const hashedPassword = await bcrypt.hash('Admin@12345', 10);
      admin = new User({
        name: 'System Admin',
        email: adminEmail,
        mobile: '0000000000',
        password: hashedPassword,
        role: 'admin',
        referralCode: 'ADMIN1'
      });
      await admin.save();
      console.log('✅ Default Admin Created: admin@gmail.com / Admin@12345');
    }
  })
  .catch(err => console.log('DB Connection Error: ', err));

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

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

// 1. REGISTRATION
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, mobile, password } = req.body;
    if (!name || !email || !mobile || !password) return res.status(400).json({ message: 'Saare fields bharna zaroori hai.' });
    if (await User.findOne({ email })) return res.status(400).json({ message: 'Yeh Email pehle se registered hai.' });
    if (await User.findOne({ mobile })) return res.status(400).json({ message: 'Yeh Mobile Number pehle se registered hai.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const refCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const user = new User({ name, email, mobile, password: hashedPassword, referralCode: refCode });
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
    if (!user) return res.status(404).json({ message: 'Email registered nahi hai.' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: '🔑 Password Reset OTP',
      text: `Aapka Password Reset OTP hai: ${otp} (10 minutes tak valid hai)`
    }).catch(e => console.log('Mail error:', e));

    res.json({ message: 'OTP aapke Email par bhej diya gaya hai!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. RESET PASSWORD WITH OTP
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email, otp });

    if (!user || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: 'Galat ya Expired OTP!' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ message: 'Password Reset Successful! Ab Login Karein.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. DASHBOARD & AUTO 10-MIN CREDIT CHECK
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

    if (updated) await user.save();
    res.json(user);
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

    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: `📄 New Page Submission: ${user.name}`,
      text: `User: ${user.name} (${user.email})\nPages: ${pageCount}\nPlan: ${user.activePlan}`,
      attachments: imageBase64 ? [{ filename: 'submission.jpg', path: imageBase64 }] : []
    }).catch(e => console.log('Mail error:', e));

    res.json({ message: 'Page Submitted! 10 Minutes me balance wallet me credit ho jayega.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. DEPOSIT REQUEST
app.post('/api/user/deposit', authenticateToken, async (req, res) => {
  try {
    const { planName, amount, perPageRate, utr, screenshotBase64 } = req.body;
    const user = await User.findById(req.user.id);

    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: `💵 Deposit Request: ₹${amount} (${planName})`,
      text: `User Details:\nName: ${user.name}\nEmail: ${user.email}\nMobile: ${user.mobile}\nPlan: ${planName} (₹${amount})\nRate Per Page: ₹${perPageRate}\nUTR Ref: ${utr}`,
      attachments: screenshotBase64 ? [{ filename: 'screenshot.jpg', path: screenshotBase64 }] : []
    }).catch(e => console.log('Mail error:', e));

    res.json({ message: 'Deposit Request Admin Gmail par bhej di gayi hai! Verification ke baad Plan active ho jayega.' });
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

    user.walletBalance -= Number(amount);
    user.transactionsHistory.unshift({
      type: 'Withdrawal paid',
      amount: -Number(amount),
      date: new Date().toLocaleString()
    });
    await user.save();

    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: `🏦 Withdrawal Request: ₹${amount}`,
      text: `User: ${user.name} (${user.email})\nAmount: ₹${amount}\nUPI: ${upi}\nBank: ${bank}\nAccount: ${accountNo}\nIFSC: ${ifsc}\nHolder Name: ${name}`
    }).catch(e => console.log('Mail error:', e));

    res.json({ message: 'Withdrawal Request submitted successfully!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. SUPPORT CHAT
app.post('/api/user/support-msg', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;
    const user = await User.findById(req.user.id);

    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: `💬 Support Query from ${user.name}`,
      text: `User: ${user.name} (${user.email})\nMessage: ${text}`
    }).catch(e => console.log('Mail error:', e));

    res.json({ message: 'Message sent to Admin Email!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------- ADMIN PANEL ROUTES ----------------

// GET ALL USERS (Track Balance & Active Plan)
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  const users = await User.find({ role: { $ne: 'admin' } }).select('-password');
  res.json(users);
});

// APPROVE PLAN
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