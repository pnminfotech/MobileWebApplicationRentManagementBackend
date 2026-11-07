const mongoose = require("mongoose");

const guideStepSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    detail: { type: String, default: "" },
  },
  { _id: false }
);

const guideDocumentOptionSchema = new mongoose.Schema(
  {
    key: { type: String, default: "" },
    label: { type: String, default: "" },
  },
  { _id: false }
);

const guideDocumentSchema = new mongoose.Schema(
  {
    key: { type: String, default: "" },
    label: { type: String, default: "" },
    required: { type: Boolean, default: false },
    options: { type: [guideDocumentOptionSchema], default: [] },
  },
  { _id: false }
);

const policeVerificationGuideSchema = new mongoose.Schema(
  {
    portalUrl: { type: String, default: "" },
    header: { type: String, default: "Police Verification (Online)" },
    intro: { type: String, default: "" },
    steps: { type: [guideStepSchema], default: [] },
    documents: { type: [guideDocumentSchema], default: [] },
    helpText: { type: String, default: "" },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model("PoliceVerificationGuide", policeVerificationGuideSchema);
