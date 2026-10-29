const mongoose = require("mongoose");

const unitStaySchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  unitId: { type: String, default: "", index: true },
  propertyType: { type: String, enum: ["bed", "room", "shop"], required: true },
  category: { type: String, default: "" },
  wingName: { type: String, default: "" },
  floorNo: { type: String, default: "" },
  roomNo: { type: String, default: "" },
  bedNo: { type: String, default: "" },
  tenantName: { type: String, default: "" },
  tenantSrNo: { type: Number },
  phoneNo: { type: String, default: "" },
  joiningDate: { type: Date },
  monthlyRent: { type: Number },
  depositAmount: { type: Number },
  tenantDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  endReason: { type: String, default: "" },
}, { timestamps: true });

unitStaySchema.index({ organizationId: 1, unitId: 1, bedNo: 1, startedAt: -1 });
unitStaySchema.index({ organizationId: 1, tenantId: 1, endedAt: 1 });

module.exports = mongoose.models.UnitStay || mongoose.model("UnitStay", unitStaySchema);
