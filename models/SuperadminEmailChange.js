const mongoose = require("mongoose");

const superadminEmailChangeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "SystemUser", required: true, index: true },
    sessionVersion: { type: Number, required: true },
    currentEmail: { type: String, required: true, lowercase: true, trim: true },
    newEmail: { type: String, required: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

superadminEmailChangeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.SuperadminEmailChange ||
  mongoose.model("SuperadminEmailChange", superadminEmailChangeSchema);
