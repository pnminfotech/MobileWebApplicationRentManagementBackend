const Form = require("../models/formModels");
const Archive = require("../models/archiveSchema");
const Counter = require("../models/counterModel");

function serialScope(organizationId) {
  return { organizationId: organizationId || null };
}

function counterName(organizationId) {
  return organizationId ? `form_srno:${String(organizationId)}` : "form_srno";
}

async function existingMaximum(organizationId) {
  const scope = serialScope(organizationId);
  const [lastForm, archived] = await Promise.all([
    Form.findOne(scope).sort({ srNo: -1 }).select("srNo").lean(),
    Archive.aggregate([
      { $match: scope },
      { $group: { _id: null, max: { $max: { $convert: { input: "$srNo", to: "long", onError: 0, onNull: 0 } } } } },
    ]),
  ]);
  return Math.max(Number(lastForm?.srNo) || 0, Number(archived[0]?.max) || 0);
}

async function previewTenantSerial(organizationId) {
  const [maximum, counter] = await Promise.all([
    existingMaximum(organizationId),
    Counter.findOne({ name: counterName(organizationId) }).lean(),
  ]);
  return Math.max(maximum, Number(counter?.seq) || 0) + 1;
}

async function assignTenantSerial(organizationId) {
  const name = counterName(organizationId);
  const maximum = await existingMaximum(organizationId);
  // A unique counter name plus atomic $inc prevents duplicate numbers from
  // concurrent requests. $max preserves existing tenant and archive numbers.
  try {
    await Counter.updateOne({ name }, { $max: { seq: maximum } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    await Counter.updateOne({ name }, { $max: { seq: maximum } });
  }
  const counter = await Counter.findOneAndUpdate({ name }, { $inc: { seq: 1 } }, { new: true });
  return counter.seq;
}

module.exports = { assignTenantSerial, previewTenantSerial };
