const mongoose = require("mongoose");

const loginEmailChallengeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SystemUser",
      required: true,
      index: true,
    },
    sessionVersion: { type: Number, required: true },
    clientPlatform: { type: String, enum: ["web", "mobile"], default: "web" },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

loginEmailChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.LoginEmailChallenge ||
  mongoose.model("LoginEmailChallenge", loginEmailChallengeSchema);
