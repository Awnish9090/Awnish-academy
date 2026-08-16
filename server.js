const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { Resend } = require('resend');

// Environment Variables Setup
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_98765';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'awnishac@gmail.com';
const apiKey = process.env.RESEND_API_KEY || 're_HNc3dgS8_KsVCJeuf7jBpLFFwyjwfm4oX';

if (!process.env.RESEND_API_KEY) {
  console.log('⚠️ WARNING: .env file me RESEND_API_KEY missing hai. Emails send nahi honge lekin server chalta rahega.');
}
const resend = new Resend(apiKey);

const { User, Task } = require('./models/User');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://awnishac_db_user:ej1jT6HIUJkd0FmR@cluster0.nh9ma2o.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB Connected Successfully!');
    let admin = await User.findOne({ email: ADMIN_EMAIL });
    if (!admin) {
      const hashedPassword = await bcrypt.hash('Admin@12345', 10);
      admin = new User({
        name: 'System Admin',
        email: ADMIN_EMAIL,
        mobile: '0000000000',
        password: hashedPassword,
        role: 'admin',
        referralCode: 'ADMIN1'
      });
      await admin.save();
      console.log(`✅ Default Admin Created: ${ADMIN_EMAIL} / Admin@12345`);
    }
  })
  .catch(err => console.log('DB Connection Error: ', err));

// JWT Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access Denied' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid Token' });
    req.user = user;
    next();
  });
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// 1. REGISTRATION WITH REFERRAL FIX
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, mobile, password, referralCode } = req.body;
    if (!name || !email || !mobile || !password) return res.status(400).json({ message: 'All fields are required.' });
    if (await User.findOne({ email })) return res.status(400).json({ message: 'This Email is already registered.' });
    if (await User.findOne({ mobile })) return res.status(400).json({ message: 'This Mobile Number is already registered.' });

    let referrer = null;
    if (referralCode && referralCode.trim() !== "") {
      referrer = await User.findOne({ referralCode: referralCode.trim().toUpperCase() });
      if (!referrer) {
        return res.status(400).json({ message: 'Galat Referral Code!' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const refCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const user = new User({ 
      name, 
      email, 
      mobile, 
      password: hashedPassword, 
      referralCode: refCode,
      referredBy: referrer ? referrer._id : null,
      referredCodeUsed: referrer ? referrer.referralCode : null
    });

    await user.save();

    if (referrer) {
      referrer.directReferralsCount = (referrer.directReferralsCount || 0) + 1;
      await referrer.save();
    }

    res.status(201).json({ message: 'Registration Successful!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and Password are required.' });

    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: 'Wrong Email or Password!' });
    }
    
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
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

    if (apiKey) {
      await resend.emails.send({
        from: 'Portal App <noreply@awnishacademy.online>',
        to: [email],
        subject: '🔑 Password Reset OTP',
        html: `<p>Aapka Password Reset OTP hai: <b>${otp}</b> (10 minutes tak valid hai)</p>`
      }).catch(e => console.log('Mail error:', e));
    }

    res.json({ message: 'OTP Generated!', otp: otp });
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

    res.json({ message: 'Password Reset Successful! Ab Login Kre.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. DASHBOARD & AUTO CREDIT CHECK
app.get('/api/user/dashboard', authenticateToken, async (req, res) => {
  try {
    let user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    
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

// GET ACTIVE DAILY TASK
app.get('/api/user/daily-task', authenticateToken, async (req, res) => {
  try {
    const task = await Task.findOne().sort({ createdAt: -1 });
    const user = await User.findById(req.user.id);
    const todayStr = new Date().toISOString().split('T')[0];
    const isSubmittedToday = user ? user.lastSubmissionDate === todayStr : false;

    res.json({ task, isSubmittedToday });
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
      return res.status(400).json({ message: 'Aaj ka task already submit ho chuka hai. Please wait for next task!' });
    }

    const earnedAmount = (user.perPageRate || 210) * Number(pageCount);
    const creditTime = new Date(Date.now() + 10 * 60 * 1000);

    user.lastSubmissionDate = todayStr;
    user.pendingSubmissions.push({ pages: pageCount, amount: earnedAmount, creditTime });
    await user.save();

    if (apiKey) {
      let emailPayload = {
        from: 'Portal App <noreply@awnishacademy.online>',
        to: [ADMIN_EMAIL],
        subject: `📄 New Page Submission: ${user.name}`,
        html: `<p><b>User:</b> ${user.name} (${user.email})</p><p><b>Pages:</b> ${pageCount}</p><p><b>Plan:</b> ${user.activePlan}</p>`
      };

      if (imageBase64) {
        emailPayload.attachments = [{ filename: 'submission.jpg', content: imageBase64.split(',')[1] }];
      }

      await resend.emails.send(emailPayload).catch(e => console.log('Mail error:', e));
    }

    res.json({ message: 'Task Submitted successfully! 10 minutes me amount wallet me credit ho jayega.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. DEPOSIT REQUEST
app.post('/api/user/deposit', authenticateToken, async (req, res) => {
  try {
    const { planName, amount, perPageRate, utr, screenshotBase64 } = req.body;
    const user = await User.findById(req.user.id);

    user.deposits.unshift({
      planName,
      amount: Number(amount),
      perPageRate: Number(perPageRate),
      utr,
      screenshotBase64: screenshotBase64 || null,
      status: 'PENDING',
      date: new Date().toLocaleString()
    });
    await user.save();

    if (apiKey) {
      let emailPayload = {
        from: 'Portal App <noreply@awnishacademy.online>',
        to: [ADMIN_EMAIL],
        subject: `💵 Deposit Request: ₹${amount} (${planName})`,
        html: `
          <h3>User Deposit Details:</h3>
          <p><b>Name:</b> ${user.name}</p>
          <p><b>Email:</b> ${user.email}</p>
          <p><b>Mobile:</b> ${user.mobile}</p>
          <p><b>Plan:</b> ${planName} (₹${amount})</p>
          <p><b>Rate Per Page:</b> ₹${perPageRate}</p>
          <p><b>UTR Ref:</b> ${utr}</p>
        `
      };

      if (screenshotBase64) {
        emailPayload.attachments = [{ filename: 'screenshot.jpg', content: screenshotBase64.split(',')[1] }];
      }

      await resend.emails.send(emailPayload).catch(e => console.log('Mail error:', e));
    }

    res.json({ message: 'Deposit Request submitted! Verification ke baad Plan active ho jayega.' });
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
    
    user.withdrawals.unshift({
      amount: Number(amount),
      upi,
      bank,
      accountNo,
      ifsc,
      name,
      status: 'PENDING',
      date: new Date().toLocaleString()
    });

    user.transactionsHistory.unshift({
      type: 'Withdrawal (Pending)',
      amount: -Number(amount),
      date: new Date().toLocaleString()
    });
    
    await user.save();

    if (apiKey) {
      await resend.emails.send({
        from: 'Portal App <noreply@awnishacademy.online>',
        to: [ADMIN_EMAIL],
        subject: `🏦 Withdrawal Request: ₹${amount}`,
        html: `
          <h3>Withdrawal Details:</h3>
          <p><b>User:</b> ${user.name} (${user.email})</p>
          <p><b>Amount:</b> ₹${amount}</p>
          <p><b>UPI:</b> ${upi}</p>
          <p><b>Bank:</b> ${bank}</p>
          <p><b>Account:</b> ${accountNo}</p>
          <p><b>IFSC:</b> ${ifsc}</p>
          <p><b>Holder Name:</b> ${name}</p>
        `
      }).catch(e => console.log('Mail error:', e));
    }

    res.json({ message: 'Withdrawal Request submitted! Status: Pending' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. SUPPORT CHAT
app.post('/api/user/support-msg', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;
    const user = await User.findById(req.user.id);

    if (apiKey) {
      await resend.emails.send({
        from: 'Portal App <noreply@awnishacademy.online>',
        to: [ADMIN_EMAIL],
        subject: `💬 Support Query from ${user.name}`,
        html: `<p><b>User:</b> ${user.name} (${user.email})</p><p><b>Message:</b> ${text}</p>`
      }).catch(e => console.log('Mail error:', e));
    }

    res.json({ message: 'Message sent to Admin Email!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- TEAM & REFERRAL API ---
app.get('/api/user/team', authenticateToken, async (req, res) => {
  try {
    const directUsers = await User.find({ referredBy: req.user.id }).select('name email mobile activePlan walletBalance createdAt');
    const directActive = directUsers.filter(u => u.activePlan && u.activePlan !== 'No Active Plan').length;

    res.json({
      directTotal: directUsers.length,
      directActive: directActive,
      directUsers: directUsers
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/user/tree', authenticateToken, async (req, res) => {
  try {
    // FIX 1: Included 'mobile' in select so that mobile number shows up in tree view
    const teamTree = await User.find({ referredBy: req.user.id }).select('name email mobile activePlan referralCode');
    res.json(teamTree);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN PANEL ROUTES
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  const users = await User.find({ role: { $ne: 'admin' } }).select('-password');
  res.json(users);
});

// ADMIN: GET ALL REQUESTS
app.get('/api/admin/requests', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  try {
    const users = await User.find({ role: { $ne: 'admin' } });
    let deposits = [];
    let withdrawals = [];

    users.forEach(u => {
      if (u.deposits) {
        u.deposits.forEach(d => {
          deposits.push({
            userId: u._id,
            userName: u.name,
            userEmail: u.email,
            userMobile: u.mobile,
            depositId: d._id,
            planName: d.planName,
            amount: d.amount,
            perPageRate: d.perPageRate,
            utr: d.utr,
            screenshotBase64: d.screenshotBase64,
            status: d.status,
            date: d.date
          });
        });
      }

      if (u.withdrawals) {
        u.withdrawals.forEach(w => {
          withdrawals.push({
            userId: u._id,
            userName: u.name,
            userEmail: u.email,
            userMobile: u.mobile,
            withdrawalId: w._id,
            amount: w.amount,
            upi: w.upi,
            bank: w.bank,
            accountNo: w.accountNo,
            ifsc: w.ifsc,
            holderName: w.name,
            status: w.status,
            date: w.date
          });
        });
      }
    });

    res.json({ deposits, withdrawals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: POST DAILY TASK
app.post('/api/admin/create-task', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  try {
    const { title, description, sampleText } = req.body;
    await Task.deleteMany({});
    const newTask = new Task({ title, description, sampleText });
    await newTask.save();
    res.json({ message: 'Daily Task published to all users successfully! (Valid for 24 hours)' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: APPROVE / REJECT DEPOSIT
app.post('/api/admin/deposit-action', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  try {
    const { userId, depositId, action } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const dep = user.deposits.id(depositId);
    if (!dep) return res.status(404).json({ message: 'Deposit request not found' });

    dep.status = action;

    if (action === 'APPROVED') {
      const isFirstActivation = user.activePlan === 'No Active Plan';
      user.activePlan = dep.planName;
      user.perPageRate = Number(dep.perPageRate);

      if (isFirstActivation && user.referredBy) {
        const referrer = await User.findById(user.referredBy);
        if (referrer) {
          const bonus = dep.amount * 0.10;
          referrer.walletBalance += bonus;
          referrer.totalEarned += bonus;
          referrer.referralBonusEarned = (referrer.referralBonusEarned || 0) + bonus;
          referrer.transactionsHistory.unshift({
            type: `Referral Bonus (${user.name})`,
            amount: bonus,
            date: new Date().toLocaleString()
          });
          await referrer.save();
        }
      }
    }

    await user.save();
    res.json({ message: `Deposit request ${action} successfully!` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: APPROVE / REJECT WITHDRAWAL
app.post('/api/admin/withdraw-action', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  try {
    const { userId, withdrawalId, action } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const w = user.withdrawals.id(withdrawalId);
    if (!w) return res.status(404).json({ message: 'Withdrawal request not found' });

    w.status = action;

    if (action === 'REJECTED') {
      user.walletBalance += w.amount;
      user.transactionsHistory.unshift({
        type: 'Withdrawal Refunded',
        amount: w.amount,
        date: new Date().toLocaleString()
      });
    } else if (action === 'APPROVED') {
      user.transactionsHistory.unshift({
        type: 'Withdrawal Approved',
        amount: -w.amount,
        date: new Date().toLocaleString()
      });
    }

    await user.save();
    res.json({ message: `Withdrawal request ${action} successfully!` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/approve-plan/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  const { planName, perPageRate, planPrice } = req.body;
  
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const isFirstActivation = user.activePlan === 'No Active Plan';
  user.activePlan = planName;
  user.perPageRate = Number(perPageRate);
  await user.save();

  if (isFirstActivation && user.referredBy) {
    const referrer = await User.findById(user.referredBy);
    if (referrer) {
      const price = Number(planPrice) || 599;
      const bonus = price * 0.10;

      referrer.walletBalance += bonus;
      referrer.totalEarned += bonus;
      referrer.referralBonusEarned = (referrer.referralBonusEarned || 0) + bonus;
      referrer.transactionsHistory.unshift({
        type: `Referral Bonus (${user.name})`,
        amount: bonus,
        date: new Date().toLocaleString()
      });
      await referrer.save();
    }
  }

  res.json({ message: 'Plan approved and activated successfully!' });
});

app.delete('/api/admin/delete-user/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: 'User deleted permanently!' });
});

app.post('/api/admin/user-reset/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
  await User.findByIdAndUpdate(req.params.id, { walletBalance: 0, totalEarned: 0, activePlan: 'No Active Plan' });
  res.json({ message: 'User balance reset to 0.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

function joinDate(date) {
  return new Date(date);
}

// Public folder ki files ko directly accessible banane ke liye:
app.use(express.static('public'));