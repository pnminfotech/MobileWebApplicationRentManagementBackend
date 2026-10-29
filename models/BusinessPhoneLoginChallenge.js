const mongoose = require("mongoose");

const businessPhoneLoginChallengeSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    codeExpiresAt: { type: Date, default: null },
    resendAvailableAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

businessPhoneLoginChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.BusinessPhoneLoginChallenge ||
  mongoose.model("BusinessPhoneLoginChallenge", businessPhoneLoginChallengeSchema);
