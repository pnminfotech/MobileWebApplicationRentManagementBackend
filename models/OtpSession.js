const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  codeHash: { type: String, required: true },
  codeExpiresAt: { type: Date, default: null },
  resendAvailableAt: { type: Date, default: null },
  purpose: { type: String, default: 'tenant_login' },
  attempts: { type: Number, default: 0 },
  resendCount: { type: Number, default: 0 },
  usedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpSession', otpSchema);
