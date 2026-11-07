// // routes/tenantRoutes.js
// const express = require('express');
// const router = express.Router();
// const jwt = require('jsonwebtoken');
// const QRCode = require('qrcode');

// const Form = require('../models/formModels');
// const OtpSession = require('../models/OtpSession');
// const authTenant = require('../middleware/tenantAuth');
// const { docsUpload, avatarUpload, ekycUpload } = require('../lib/upload');
// const Payment = require('../models/Payment');

// // Debug ping (optional)
// router.get('/auth/ping', (req, res) => res.json({ ok: true, at: '/api/tenant/auth/ping' }));

// // ---------- AUTH (OTP) ----------
// router.post('/auth/request-otp', async (req, res) => {
//   const { phone } = req.body;
//   if (!phone) return res.status(400).json({ message: "phone required" });

//   const code = process.env.NODE_ENV === 'production'
//     ? String(Math.floor(100000 + Math.random() * 900000))
//     : '123456';

//   await OtpSession.deleteMany({ phone });
//   await OtpSession.create({ phone, code, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });

//   res.json({ ok: true, devCode: process.env.NODE_ENV === 'production' ? undefined : code });
// });

// router.post('/auth/verify', async (req, res) => {
//   const { phone, code } = req.body;
//   if (!phone || !code) return res.status(400).json({ message: "phone & code required" });

//   const sess = await OtpSession.findOne({ phone, code });
//   if (!sess || new Date(sess.expiresAt) < new Date()) {
//     return res.status(400).json({ message: "Invalid/expired code" });
//   }

//   const me = await Form.findOne({ phoneNo: Number(phone) });
//   if (!me) return res.status(404).json({ message: "Tenant not found" });

//   await OtpSession.deleteMany({ phone });

//   // inside POST /auth/verify
// const token = jwt.sign(
//   { id: me._id.toString() },   // role not required since middleware doesn’t check it
//   'dev_secret',                // <— MUST MATCH middleware
//   { expiresIn: '30d' }
// );
// //
//   res.json({ token });
// });

// // ---------- ME ----------
// router.get('/me', authTenant, async (req, res) => res.json(req.tenant));

// // ---------- PROFILE ----------
// router.put('/profile', authTenant, async (req, res) => {
//   const up = {};
//   ['name','email','address','companyAddress','emergencyContact','dob'].forEach(k => {
//     if (req.body[k] != null) up[k] = req.body[k];
//   });
//   Object.assign(req.tenant, up);
//   await req.tenant.save();
//   res.json(req.tenant);
// });

// router.post('/profile/avatar', authTenant, avatarUpload.single('avatar'), async (req, res) => {
//   if (!req.file) return res.status(400).json({ message: "no file" });
//   const url = `/uploads/avatars/${req.file.filename}`;
//   req.tenant.avatarUrl = url;
//   await req.tenant.save();
//   res.json({ avatarUrl: url });
// });

// // ---------- DOCS ----------
// router.post('/docs', authTenant, docsUpload.array('documents'), async (req, res) => {
//   const files = req.files || [];
//   const mapped = files.map((f) => ({
//     fileName: f.originalname,
//     url: `/uploads/docs/${f.filename}`,
//     contentType: f.mimetype,
//     size: f.size,
//     relation: "Self",
//   }));
//   req.tenant.documents = [...(req.tenant.documents || []), ...mapped];
//   await req.tenant.save();
//   res.json({ ok: true, added: mapped.length });
// });

// // ---------- RENTS ----------
// router.get('/rents', authTenant, async (req, res) => {
//   const t = req.tenant;
//   const now = new Date();
//   const y = now.getFullYear();
//   const paidSet = new Set(
//     (t.rents || [])
//       .filter(r => r?.date && Number(r.rentAmount) > 0)
//       .map(r => { const d = new Date(r.date); return `${d.getFullYear()}-${d.getMonth()}`; })
//   );

//  // start counting from the later of: Jan 1st this year OR month after joining
//  const base = Number(t.baseRent || 0);
//  let totalDue = 0;
//  const join = t.joiningDate ? new Date(t.joiningDate) : null;
//  const startOfYear = new Date(y, 0, 1);
//  // month after joining
//  const startAfterJoin = join ? new Date(join.getFullYear(), join.getMonth() + 1, 1) : startOfYear;
//  const start = startAfterJoin > startOfYear ? startAfterJoin : startOfYear;

//  const cursor = new Date(start);
//  while (cursor.getFullYear() === y && cursor <= now) {
//    const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
//    if (!paidSet.has(key)) totalDue += base;
//    cursor.setMonth(cursor.getMonth() + 1);
//  }
//   res.json({ currentYear: y, totalDue, rents: t.rents || [] });
// });

// // ---------- LEAVE ----------
// router.post('/leave', authTenant, async (req, res) => {
//   const { leaveDate } = req.body;
//   if (!leaveDate) return res.status(400).json({ message: "leaveDate required" });
//   req.tenant.leaveRequestDate = new Date(leaveDate);
//   await req.tenant.save();
//   res.json({ ok: true, leaveRequestDate: req.tenant.leaveRequestDate });
// });

// // ---------- ANNOUNCEMENTS ----------
// router.get('/announcements', authTenant, async (_req, res) => {
//   res.json([]); // replace with real announcements
// });

// // ---------- eKYC ----------
// router.get('/ekyc', authTenant, async (req, res) => res.json(req.tenant.ekyc || { status: "not_started" }));

// router.post('/ekyc', authTenant, ekycUpload.fields([
//   { name: 'docs', maxCount: 10 },
//   { name: 'selfie', maxCount: 1 },
// ]), async (req, res) => {
//   const { aadhaarLast4, panLast4 } = req.body;
//   const docs = (req.files?.docs || []).map(f => ({
//     fileName: f.originalname,
//     url: `/uploads/ekyc/${f.filename}`,
//     contentType: f.mimetype,
//     size: f.size,
//     relation: "Self",
//   }));
//   const selfie = (req.files?.selfie || [])[0];
//   const selfieUrl = selfie ? `/uploads/ekyc/${selfie.filename}` : undefined;

//   req.tenant.ekyc = {
//     ...(req.tenant.ekyc || {}),
//     status: "pending",
//     aadhaarLast4,
//     panLast4,
//     selfieUrl: selfieUrl || req.tenant.ekyc?.selfieUrl,
//     docs: [ ...(req.tenant.ekyc?.docs || []), ...docs ],
//   };
//   await req.tenant.save();
//   res.json({ ok: true, ekyc: req.tenant.ekyc });
// });

// // ---------- UPI ----------
// router.get('/upi-qr', async (req, res) => {
//   const amount = Number(req.query.amount || 0);
//   const note = String(req.query.note || 'Rent');
//   const payeeVPA  = process.env.UPI_VPA  || 'demo@upi';
//   const payeeName = process.env.UPI_NAME || 'Hostel Owner';
//   const url = `upi://pay?pa=${encodeURIComponent(payeeVPA)}&pn=${encodeURIComponent(payeeName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
//   try {
//     const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 256 });
//     res.setHeader('Content-Type','image/svg+xml'); res.send(svg);
//   } catch { res.status(500).send('QR error'); }
// });

// router.get('/upi-intent', (req, res) => {
//   const amount = Number(req.query.amount || 0);
//   const note = String(req.query.note || 'Rent');
//   const payeeVPA  = process.env.UPI_VPA  || 'demo@upi';
//   const payeeName = process.env.UPI_NAME || 'Hostel Owner';
//   const url = `upi://pay?pa=${encodeURIComponent(payeeVPA)}&pn=${encodeURIComponent(payeeName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
//   res.redirect(url);
// });

// // ---------- PAYMENTS ----------
// router.get('/payments/my', authTenant, async (req, res) => {
//   const list = await Payment.find({ tenant: req.tenant._id }).sort({ createdAt: -1 });
//   res.json(list);
// });

// // router.post('/payments/report', authTenant, async (req, res) => {
// //   const { amount, utr, note, month, year } = req.body;
// //   if (!amount) return res.status(400).json({ message: 'amount required' });

// //  const p = await Payment.create({
// //     tenant: req.tenant._id,
// //     amount: Number(amount),
// //     utr: (utr || '').trim(),
// //     note: (note || '').trim(),
// //     month: (month ?? null),
// //     year:  (year ?? null),
// //     status: 'reported',
// //   });
// //  // 🔔 ALSO create a PaymentNotification so the admin can see/act
// //   try {
// //     const PaymentNotification = require('../models/PaymentNotification');
// //     await PaymentNotification.create({
// //       tenantId: req.tenant._id,
// //       paymentId: p._id,
// //       amount: p.amount,
// //       month: p.month,
// //       year: p.year,
// //       utr: p.utr,
// //       note: p.note,
// //       status: 'pending',
// //       read: false,
// //     });
// //   } catch (e) {
// //     console.error('Failed to create PaymentNotification:', e);
// //     // not fatal for the tenant flow
// //   }
// //   res.json({ ok: true, payment: p });
// // });
// // routes/tenantRoutes.js
// router.post('/payments/report', authTenant, async (req, res) => {
//   const { amount, utr, note, month, year } = req.body;
//   if (!amount) return res.status(400).json({ message: 'amount required' });

//   const p = await Payment.create({
//     tenant: req.tenant._id,
//     amount: Number(amount),
//     utr: (utr || '').trim(),
//     note: (note || '').trim(),
//     month: (month ?? null),
//     year:  (year ?? null),
//     status: 'reported',
//   });

//  // 🔔 Create an admin-facing notification
//  try {
//    const PaymentNotification = require('../models/PaymentNotification');
//    const payload = {
//      tenantId: req.tenant._id,
//      paymentId: p._id,
//      amount: p.amount,
//      month: p.month,
//      year: p.year,
//      utr: p.utr,
//      note: p.note,
//      status: 'pending',
//      read: false,
//    };
//    console.log('[notif] creating PaymentNotification =>', payload);
//    const created = await PaymentNotification.create(payload);
//    console.log('[notif] created id:', created._id);
//  } catch (e) {
//    console.error('[notif] FAILED to create PaymentNotification:', e);
//  }
//   res.json({ ok: true, payment: p });
// });


// module.exports = router;




// routes/tenantRoutes.js
const express = require('express');
const router = express.Router();
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const QRCode = require('qrcode');

const Form = require('../models/formModels');
const Room = require('../models/Room');
const Organization = require('../models/Organization');
const OtpSession = require('../models/OtpSession');
const authTenant = require('../middleware/tenantAuth');
const Payment = require('../models/Payment');
const multer = require('multer');
const sharp = require('sharp');
const ImageKit = require('imagekit');
const { getTenantJwtSecret } = require('../config/tenantJwt');
const { sendTenantLoginOtp } = require('../services/smsService');
const { getUnpaidRentBeforeDate, getCurrentMonthlyRent } = require('./_helpers/rentHistory');
const {
  createAuthRateLimit,
  requestIp,
  challengeIdentifier,
} = require('../middleware/authRateLimit');
const { findSystemAdminPhoneMatches, phoneIdentityNumberVariants } = require('../utils/phoneIdentity');

/* ------------------------------------------------------------------ */
/* Helpers kept in this file (no new files created)                    */
/* ------------------------------------------------------------------ */
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const MAX_IMAGE_UPLOAD_SIZE = 2 * 1024 * 1024;
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_UPLOAD_SIZE, files: 10 },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedImageFile(file)) {
      const error = new Error('Only JPG, JPEG, and PNG files are allowed.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
});

function getImageKit() {
  if (!process.env.IMAGEKIT_PUBLIC_KEY || !process.env.IMAGEKIT_PRIVATE_KEY || !process.env.IMAGEKIT_URL_ENDPOINT) {
    return null;
  }
  return new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  });
}

async function uploadTenantImages(files, folder) {
  const imagekit = getImageKit();
  if (!imagekit) {
    const error = new Error('ImageKit is not configured.');
    error.status = 503;
    throw error;
  }
  return Promise.all(files.map(async (file) => {
    const safeName = String(file.originalname || 'image').replace(/[^\\w.\\-]/g, '_');
    const buffer = await sharp(file.buffer).rotate().webp({ quality: 82 }).toBuffer();
    const uploaded = await imagekit.upload({
      file: buffer,
      fileName: `${Date.now()}_${safeName}.webp`,
      folder,
      useUniqueFileName: true,
    });
    return {
      fileName: file.originalname,
      url: uploaded.url,
      fileId: uploaded.fileId,
      filePath: uploaded.filePath,
      contentType: 'image/webp',
      size: buffer.length,
    };
  }));
}

function isAllowedImageFile(file) {
  if (!file) return false;

  const mime = String(file.mimetype || '').toLowerCase();
  const ext = path.extname(String(file.originalname || '')).toLowerCase();

  return ALLOWED_IMAGE_MIME_TYPES.has(mime) && ALLOWED_IMAGE_EXTENSIONS.has(ext);
}

function normalizePhone(raw) {
  // Keep only digits, take last 10 (adapt to your country if needed)
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.slice(-10);
}

const tenantOtpRequestIpLimit = createAuthRateLimit({
  name: 'tenant-otp-request-ip',
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFromRequest: requestIp,
  countSuccessfulRequests: true,
});
const tenantOtpRequestPhoneLimit = createAuthRateLimit({
  name: 'tenant-otp-request-phone',
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyFromRequest: (req) => normalizePhone(req.body?.phone),
  countSuccessfulRequests: true,
});
const tenantOtpVerifyIpLimit = createAuthRateLimit({
  name: 'tenant-otp-verify-ip',
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFromRequest: requestIp,
});
const tenantOtpVerifyChallengeLimit = createAuthRateLimit({
  name: 'tenant-otp-verify-challenge',
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFromRequest: (req) => String(req.body?.otpId || challengeIdentifier(req)).trim(),
});

const TENANT_OTP_CODE_TTL_MS = 5 * 60 * 1000;
const TENANT_OTP_CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
const TENANT_OTP_MAX_ATTEMPTS = 3;
const TENANT_OTP_MAX_RESENDS = 2;

function publicTenantOtpState(challenge) {
  return {
    otpId: String(challenge._id),
    codeExpiresAt: challenge.codeExpiresAt || challenge.expiresAt,
    resendAvailableAt: challenge.resendAvailableAt || challenge.codeExpiresAt || challenge.expiresAt,
    attempts: Number(challenge.attempts || 0),
    attemptsRemaining: Math.max(0, TENANT_OTP_MAX_ATTEMPTS - Number(challenge.attempts || 0)),
    resendCount: Number(challenge.resendCount || 0),
  };
}

function hashTenantOtp(otpId, phone, code) {
  return crypto
    .createHmac('sha256', getTenantJwtSecret())
    .update(`${otpId}:${phone}:${code}`)
    .digest('hex');
}

function validTenantPhone(phone) {
  return /^[6-9]\d{9}$/.test(phone);
}

// Debug ping (optional)
router.get('/auth/ping', (req, res) => res.json({ ok: true, at: '/api/tenant/auth/ping' }));

router.post('/auth/request-otp', tenantOtpRequestIpLimit, tenantOtpRequestPhoneLimit, async (req, res) => {
  try {
    const phoneNorm = normalizePhone(req.body?.phone);
    if (!validTenantPhone(phoneNorm)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    }

    const [tenants, systemAdmins] = await Promise.all([
      Form.find({
        phoneNo: { $in: phoneIdentityNumberVariants(phoneNorm) },
      }).limit(2),
      findSystemAdminPhoneMatches(phoneNorm),
    ]);
    if (systemAdmins.length) {
      return res.status(409).json({ message: 'This mobile number belongs to a system admin and cannot be used for tenant login.' });
    }
    if (tenants.length > 1) {
      return res.status(409).json({ message: 'This mobile number is linked to multiple tenant records. Contact the property administrator to resolve the duplicate.' });
    }
    const tenant = tenants[0] || null;
    const genericResponse = {
      ok: true,
      message: 'If this number is registered, a verification code has been sent.',
      expiresIn: 300,
    };
    if (!tenant) return res.json(genericResponse);

    const now = new Date();
    const activeChallenge = await OtpSession.findOne({
      phone: phoneNorm,
      purpose: 'tenant_login',
      usedAt: null,
      expiresAt: { $gt: now },
    }).sort({ createdAt: -1 });
    if (activeChallenge) {
      const resendAvailableAt = activeChallenge.resendAvailableAt || activeChallenge.codeExpiresAt || activeChallenge.expiresAt;
      if (resendAvailableAt > now) {
        return res.status(429).json({
          message: 'Wait for the 5-minute timer before requesting another OTP.',
          ...publicTenantOtpState(activeChallenge),
        });
      }
      activeChallenge.usedAt = now;
      await activeChallenge.save();
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const otpId = new mongoose.Types.ObjectId();
    const challenge = await OtpSession.create({
      _id: otpId,
      phone: phoneNorm,
      codeHash: hashTenantOtp(otpId, phoneNorm, code),
      purpose: 'tenant_login',
      codeExpiresAt: new Date(now.getTime() + TENANT_OTP_CODE_TTL_MS),
      resendAvailableAt: new Date(now.getTime() + TENANT_OTP_CODE_TTL_MS),
      expiresAt: new Date(now.getTime() + TENANT_OTP_CHALLENGE_TTL_MS),
    });

    let delivery;
    try {
      delivery = await sendTenantLoginOtp({ tenant, code });
    } catch (error) {
      await OtpSession.deleteOne({ _id: challenge._id });
      console.error('tenant OTP delivery failed:', error?.message || error);
      return res.status(503).json({ message: 'Unable to send a verification code right now. Please try again later.' });
    }

    if (!delivery?.sent) {
      if (process.env.NODE_ENV === 'production') {
        await OtpSession.deleteOne({ _id: challenge._id });
        return res.status(503).json({ message: 'Tenant SMS verification is not configured. Please contact support.' });
      }
      return res.json({ ...genericResponse, ...publicTenantOtpState(challenge), devCode: code });
    }

    return res.json({ ...genericResponse, ...publicTenantOtpState(challenge) });
  } catch (error) {
    console.error('tenant OTP request failed:', error?.message || error);
    return res.status(500).json({ message: 'Unable to request a verification code.' });
  }
});

router.post('/auth/challenge/status', async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const otpId = String(req.body?.otpId || '').trim();
    if (!validTenantPhone(phone) || !mongoose.Types.ObjectId.isValid(otpId)) {
      return res.status(400).json({ message: 'Sign-in request expired. Request a new OTP.' });
    }
    const challenge = await OtpSession.findOne({
      _id: otpId,
      phone,
      purpose: 'tenant_login',
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!challenge) return res.status(404).json({ message: 'Sign-in request expired. Request a new OTP.' });
    return res.json(publicTenantOtpState(challenge));
  } catch (error) {
    console.error('tenant OTP status failed:', error?.message || error);
    return res.status(500).json({ message: 'Unable to restore the sign-in request.' });
  }
});

router.post('/auth/resend-otp', tenantOtpRequestIpLimit, tenantOtpRequestPhoneLimit, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const otpId = String(req.body?.otpId || '').trim();
    if (!validTenantPhone(phone) || !mongoose.Types.ObjectId.isValid(otpId)) {
      return res.status(400).json({ message: 'Sign-in request expired. Request a new OTP.' });
    }

    const now = new Date();
    const challenge = await OtpSession.findOne({
      _id: otpId,
      phone,
      purpose: 'tenant_login',
      usedAt: null,
      expiresAt: { $gt: now },
    });
    if (!challenge) return res.status(400).json({ message: 'Sign-in request expired. Request a new OTP.' });

    const resendAvailableAt = challenge.resendAvailableAt || challenge.codeExpiresAt || challenge.expiresAt;
    if (resendAvailableAt > now) {
      return res.status(429).json({
        message: 'Wait for the 5-minute timer before requesting another OTP.',
        ...publicTenantOtpState(challenge),
      });
    }
    if (Number(challenge.resendCount || 0) >= TENANT_OTP_MAX_RESENDS) {
      return res.status(429).json({
        message: 'You have used both OTP resends. Request a fresh OTP to continue.',
        restartRequired: true,
        ...publicTenantOtpState(challenge),
      });
    }

    const [tenants, systemAdmins] = await Promise.all([
      Form.find({ phoneNo: { $in: phoneIdentityNumberVariants(phone) } }).limit(2),
      findSystemAdminPhoneMatches(phone),
    ]);
    if (systemAdmins.length) {
      challenge.usedAt = now;
      await challenge.save();
      return res.status(409).json({ message: 'This mobile number belongs to a system admin and cannot be used for tenant login.' });
    }
    if (tenants.length !== 1) {
      challenge.usedAt = now;
      await challenge.save();
      return res.status(409).json({ message: 'This mobile number must belong to exactly one tenant record to sign in.' });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    challenge.codeHash = hashTenantOtp(challenge._id, phone, code);
    challenge.codeExpiresAt = new Date(now.getTime() + TENANT_OTP_CODE_TTL_MS);
    challenge.resendAvailableAt = new Date(now.getTime() + TENANT_OTP_CODE_TTL_MS);
    challenge.expiresAt = new Date(now.getTime() + TENANT_OTP_CHALLENGE_TTL_MS);
    challenge.attempts = 0;
    challenge.resendCount = Number(challenge.resendCount || 0) + 1;
    await challenge.save();

    let delivery;
    try {
      delivery = await sendTenantLoginOtp({ tenant: tenants[0], code });
    } catch (error) {
      challenge.usedAt = new Date();
      await challenge.save();
      console.error('tenant OTP resend delivery failed:', error?.message || error);
      return res.status(503).json({ message: 'Unable to resend the OTP right now. Please try again later.' });
    }
    if (!delivery?.sent && process.env.NODE_ENV === 'production') {
      challenge.usedAt = new Date();
      await challenge.save();
      return res.status(503).json({ message: 'Tenant SMS verification is not configured. Please contact support.' });
    }
    return res.json({
      ...publicTenantOtpState(challenge),
      ...(delivery?.sent ? {} : { devCode: code }),
    });
  } catch (error) {
    console.error('tenant OTP resend failed:', error?.message || error);
    return res.status(500).json({ message: 'Unable to resend the OTP. Please try again.' });
  }
});

router.post('/auth/verify', tenantOtpVerifyIpLimit, tenantOtpVerifyChallengeLimit, async (req, res) => {
  try {
    const phoneNorm = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || req.body?.otp || '').trim();
    const otpId = String(req.body?.otpId || '').trim();
    if (!validTenantPhone(phoneNorm) || !mongoose.Types.ObjectId.isValid(otpId) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: 'The verification code is invalid or expired. Request a new code.' });
    }

    const now = new Date();
    const challenge = await OtpSession.findOne({
      _id: otpId,
      phone: phoneNorm,
      purpose: 'tenant_login',
      expiresAt: { $gt: now },
      usedAt: null,
      attempts: { $lt: TENANT_OTP_MAX_ATTEMPTS },
      $or: [
        { codeExpiresAt: { $gt: now } },
        { codeExpiresAt: null, expiresAt: { $gt: now } },
      ],
    });
    if (!challenge) {
      const lockedChallenge = await OtpSession.findOne({
        _id: otpId,
        phone: phoneNorm,
        purpose: 'tenant_login',
        usedAt: null,
        expiresAt: { $gt: now },
        attempts: { $gte: TENANT_OTP_MAX_ATTEMPTS },
      });
      if (lockedChallenge) {
        return res.status(429).json({
          message: 'Too many incorrect OTP attempts. Request a new code when the 5-minute timer ends.',
          locked: true,
          ...publicTenantOtpState(lockedChallenge),
        });
      }
      return res.status(400).json({ message: 'The verification code is invalid or expired. Request a new code.' });
    }

    const expectedHash = hashTenantOtp(challenge._id, phoneNorm, code);
    const matches = crypto.timingSafeEqual(
      Buffer.from(challenge.codeHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
    if (!matches) {
      const updatedChallenge = await OtpSession.findOneAndUpdate(
        {
          _id: challenge._id,
          codeHash: challenge.codeHash,
          attempts: { $lt: TENANT_OTP_MAX_ATTEMPTS },
          expiresAt: { $gt: now },
          usedAt: null,
          $or: [
            { codeExpiresAt: { $gt: now } },
            { codeExpiresAt: null, expiresAt: { $gt: now } },
          ],
        },
        { $inc: { attempts: 1 } },
        { new: true }
      );
      if (!updatedChallenge) return res.status(400).json({ message: 'The verification code is invalid or expired. Request a new code.' });
      const locked = updatedChallenge.attempts >= TENANT_OTP_MAX_ATTEMPTS;
      return res.status(locked ? 429 : 400).json({
        message: locked
          ? 'Too many incorrect OTP attempts. Request a new code when the 5-minute timer ends.'
          : 'The verification code is incorrect.',
        locked,
        ...publicTenantOtpState(updatedChallenge),
      });
    }

    const [tenants, systemAdmins] = await Promise.all([
      Form.find({
        phoneNo: { $in: phoneIdentityNumberVariants(phoneNorm) },
      }).limit(2),
      findSystemAdminPhoneMatches(phoneNorm),
    ]);
    if (systemAdmins.length) {
      await OtpSession.deleteOne({ _id: challenge._id });
      return res.status(409).json({ message: 'This mobile number belongs to a system admin and cannot be used for tenant login.' });
    }
    if (tenants.length > 1) {
      await OtpSession.deleteOne({ _id: challenge._id });
      return res.status(409).json({ message: 'This mobile number is linked to multiple tenant records. Contact the property administrator to resolve the duplicate.' });
    }
    const tenant = tenants[0] || null;
    if (!tenant) {
      await OtpSession.deleteOne({ _id: challenge._id });
      return res.status(400).json({ message: 'The verification code is invalid or expired. Request a new code.' });
    }

    const consumed = await OtpSession.findOneAndDelete({
      _id: challenge._id,
      phone: phoneNorm,
      codeHash: expectedHash,
      purpose: 'tenant_login',
      expiresAt: { $gt: now },
      usedAt: null,
      attempts: { $lt: TENANT_OTP_MAX_ATTEMPTS },
      $or: [
        { codeExpiresAt: { $gt: now } },
        { codeExpiresAt: null, expiresAt: { $gt: now } },
      ],
    });
    if (!consumed) {
      return res.status(400).json({ message: 'The verification code is invalid or expired. Request a new code.' });
    }

    const token = jwt.sign(
      { id: tenant._id.toString() },
      getTenantJwtSecret(),
      { expiresIn: '30d' }
    );
    return res.json({ token });
  } catch (error) {
    console.error('tenant OTP verification failed:', error?.message || error);
    return res.status(500).json({ message: 'Unable to verify the code.' });
  }
});
/* ME                                                                  */
/* ------------------------------------------------------------------ */
router.get('/me', authTenant, async (req, res) => res.json(req.tenant));

/* ------------------------------------------------------------------ */
/* PROFILE                                                             */
/* ------------------------------------------------------------------ */
router.put('/profile', authTenant, async (req, res) => {
  const up = {};
  ['name','email','address','companyAddress','emergencyContact','dob'].forEach(k => {
    if (req.body[k] != null) up[k] = req.body[k];
  });
  Object.assign(req.tenant, up);
  await req.tenant.save();
  res.json(req.tenant);
});

router.post('/profile/avatar', authTenant, imageUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'A JPG, JPEG, or PNG image is required.' });
    const [uploaded] = await uploadTenantImages([req.file], '/rent-management-mobile-app/avatars');
    req.tenant.avatarUrl = uploaded.url;
    await req.tenant.save();
    res.json({ avatarUrl: uploaded.url });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'Avatar upload failed.' });
  }
});

/* ------------------------------------------------------------------ */
/* DOCS                                                                */
/* ------------------------------------------------------------------ */
router.post('/docs', authTenant, imageUpload.array('documents', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ message: 'At least one JPG, JPEG, or PNG document is required.' });
    const uploaded = await uploadTenantImages(files, '/rent-management-mobile-app/tenant_docs');
    const mapped = uploaded.map((file) => ({ ...file, relation: 'Self' }));
    req.tenant.documents = [...(req.tenant.documents || []), ...mapped];
    await req.tenant.save();
    res.json({ ok: true, added: mapped.length, documents: mapped });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'Document upload failed.' });
  }
});

/* ------------------------------------------------------------------ */
/* RENTS                                                               */
/* ------------------------------------------------------------------ */
router.get('/rents', authTenant, async (req, res) => {
  const t = req.tenant;
  const now = new Date();
  const roomsQuery = t.organizationId ? { organizationId: t.organizationId } : {};
  const rooms = await Room.find(roomsQuery).lean();
  const dueMonths = getUnpaidRentBeforeDate(t, now, rooms);
  const totalDue = dueMonths.reduce((sum, month) => sum + Number(month.outstanding || 0), 0);
  const baseRent = getCurrentMonthlyRent(t, rooms);
  let paymentQrUrl = '';
  if (t.organizationId) {
    const organization = await Organization.findById(t.organizationId).select('+ownerDocuments').lean();
    const paymentQr = organization?.ownerDocuments?.qr;
    const imagekit = getImageKit();
    if (paymentQr?.filePath && imagekit) {
      paymentQrUrl = imagekit.url({ path: paymentQr.filePath, signed: true, expireSeconds: 3600 });
    }
  }
  res.json({
    currentYear: now.getFullYear(),
    baseRent,
    totalDue,
    dueMonths,
    paymentQrUrl,
    rents: t.rents || [],
  });
});

/* ------------------------------------------------------------------ */
/* LEAVE                                                               */
/* ------------------------------------------------------------------ */
router.post('/leave', authTenant, async (req, res) => {
  const { leaveDate } = req.body;
  if (!leaveDate) return res.status(400).json({ message: "leaveDate required" });
  req.tenant.leaveRequestDate = new Date(leaveDate);
  await req.tenant.save();
  res.json({ ok: true, leaveRequestDate: req.tenant.leaveRequestDate });
});

/* ------------------------------------------------------------------ */
/* ANNOUNCEMENTS                                                       */
/* ------------------------------------------------------------------ */
router.get('/announcements', authTenant, async (_req, res) => {
  res.json([]); // replace with real announcements
});

/* ------------------------------------------------------------------ */
/* eKYC                                                                */
/* ------------------------------------------------------------------ */
router.get('/ekyc', authTenant, async (req, res) => res.json(req.tenant.ekyc || { status: "not_started" }));

router.post('/ekyc', authTenant, imageUpload.fields([
  { name: 'docs', maxCount: 10 },
  { name: 'selfie', maxCount: 1 },
]), async (req, res) => {
  try {
    const files = [...(req.files?.docs || []), ...(req.files?.selfie || [])];
    if (!files.length) return res.status(400).json({ message: 'At least one JPG, JPEG, or PNG image is required.' });
    const uploaded = await uploadTenantImages(files, '/rent-management-mobile-app/ekyc');
    const docCount = (req.files?.docs || []).length;
    const docs = uploaded.slice(0, docCount).map((file) => ({ ...file, relation: 'Self' }));
    const selfieUrl = uploaded[docCount]?.url;
    const { aadhaarLast4, panLast4 } = req.body;

    req.tenant.ekyc = {
      ...(req.tenant.ekyc || {}),
      status: 'pending',
      aadhaarLast4,
      panLast4,
      selfieUrl: selfieUrl || req.tenant.ekyc?.selfieUrl,
      docs: [...(req.tenant.ekyc?.docs || []), ...docs],
    };
    await req.tenant.save();
    res.json({ ok: true, ekyc: req.tenant.ekyc });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'eKYC upload failed.' });
  }
});

/* ------------------------------------------------------------------ */
/* UPI                                                                 */
/* ------------------------------------------------------------------ */
router.get('/upi-qr', async (req, res) => {
  const amount = Number(req.query.amount || 0);
  const note = String(req.query.note || 'Rent');
  const payeeVPA  = process.env.UPI_VPA  || 'demo@upi';
  const payeeName = process.env.UPI_NAME || 'Hostel Owner';
  const url = `upi://pay?pa=${encodeURIComponent(payeeVPA)}&pn=${encodeURIComponent(payeeName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 256 });
    res.setHeader('Content-Type','image/svg+xml'); res.send(svg);
  } catch { res.status(500).send('QR error'); }
});

router.get('/upi-intent', (req, res) => {
  const amount = Number(req.query.amount || 0);
  const note = String(req.query.note || 'Rent');
  const payeeVPA  = process.env.UPI_VPA  || 'demo@upi';
  const payeeName = process.env.UPI_NAME || 'Hostel Owner';
  const url = `upi://pay?pa=${encodeURIComponent(payeeVPA)}&pn=${encodeURIComponent(payeeName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
  res.redirect(url);
});

/* ------------------------------------------------------------------ */
/* PAYMENTS                                                            */
/* ------------------------------------------------------------------ */
router.get('/payments/my', authTenant, async (req, res) => {
  const query = { tenant: req.tenant._id };
  if (req.tenant.organizationId) query.organizationId = req.tenant.organizationId;
  const list = await Payment.find(query).sort({ createdAt: -1 });
  res.json(list);
});

router.patch('/payments/:id/read', authTenant, async (req, res) => {
  const query = { _id: req.params.id, tenant: req.tenant._id };
  if (req.tenant.organizationId) query.organizationId = req.tenant.organizationId;
  const payment = await Payment.findOne(query);
  if (!payment) return res.status(404).json({ message: 'Payment notification not found' });
  if (!['confirmed', 'rejected'].includes(payment.status)) {
    return res.status(400).json({ message: 'Payment report has no final review yet' });
  }

  payment.tenantReadAt = new Date();
  await payment.save();
  res.json({ ok: true, paymentId: payment._id, tenantReadAt: payment.tenantReadAt });
});

router.patch('/payments/read-all', authTenant, async (req, res) => {
  const query = {
    tenant: req.tenant._id,
    status: { $in: ['confirmed', 'rejected'] },
    $or: [{ tenantReadAt: null }, { tenantReadAt: { $exists: false } }],
  };
  if (req.tenant.organizationId) query.organizationId = req.tenant.organizationId;

  const result = await Payment.updateMany(query, { $set: { tenantReadAt: new Date() } });
  res.json({ ok: true, modifiedCount: result.modifiedCount ?? result.nModified ?? 0 });
});

router.post('/payments/report', authTenant, async (req, res) => {
  const { amount, utr, note, month, year } = req.body;
  if (!amount) return res.status(400).json({ message: 'amount required' });

  const p = await Payment.create({
    organizationId: req.tenant.organizationId || null,
    tenant: req.tenant._id,
    amount: Number(amount),
    utr: (utr || '').trim(),
    note: (note || '').trim(),
    month: (month ?? null),
    year:  (year ?? null),
    status: 'reported',
  });

  // Admin-facing notification
  try {
    const PaymentNotification = require('../models/PaymentNotification');
    const payload = {
      organizationId: req.tenant.organizationId || null,
      tenantId: req.tenant._id,
      paymentId: p._id,
      amount: p.amount,
      month: p.month,
      year: p.year,
      utr: p.utr,
      note: p.note,
      status: 'pending',
      read: false,
    };
    console.log('[notif] creating PaymentNotification =>', payload);
    const created = await PaymentNotification.create(payload);
    console.log('[notif] created id:', created._id);
  } catch (e) {
    console.error('[notif] FAILED to create PaymentNotification:', e);
    // not fatal for tenant flow
  }
  res.json({ ok: true, payment: p });
});

module.exports = router;
