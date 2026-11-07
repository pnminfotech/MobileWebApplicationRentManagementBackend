const router = require("express").Router();

const Notification = require("../models/Notification");
const Attendance = require("../models/Attendance");
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const Form = require("../models/formModels");

router.use(attachSystemAuthIfPresent);
router.use(authAdmin);

// Older notifications may not have organizationId even though their tenant
// belongs to this admin's organization. Scope those safely through the tenant.
async function scopedNotificationQuery(req, query = {}) {
  if (!req.organizationId) return query;
  const tenantIds = await Form.find({ organizationId: req.organizationId }).distinct("_id");
  return {
    ...query,
    $or: [
      { organizationId: req.organizationId },
      { organizationId: null, tenantId: { $in: tenantIds } },
    ],
  };
}

async function organizationTenantIds(req) {
  return req.organizationId
    ? Form.find({ organizationId: req.organizationId }).distinct("_id")
    : Form.distinct("_id");
}

router.get("/notifications/attendance", async (req, res, next) => {
  try {
    const query = await scopedNotificationQuery(req, {
        type: "system",
        "payload.kind": { $regex: "^attendance_" },
        read: { $ne: true },
      });
    const docs = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("tenantId", "name roomNo bedNo");

    // Attendance is the source of truth for pending requests. Include these
    // directly so a failed/missing notification insert cannot hide a request.
    const tenantIds = await organizationTenantIds(req);
    const pendingAttendance = await Attendance.find({
      tenantId: { $in: tenantIds },
      isLate: true,
      status: "pending",
      approvalStatus: { $in: ["pending", null] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("tenantId", "name roomNo bedNo");

    const notifiedAttendanceIds = new Set(
      docs.map((doc) => String(doc.payload?.attendanceId || "")).filter(Boolean)
    );
    const attendanceItems = pendingAttendance
      .filter((record) => !notifiedAttendanceIds.has(String(record._id)))
      .map((record) => ({
        _id: String(record._id),
        tenantId: record.tenantId,
        tenantName: record.tenantId?.name || "Tenant",
        roomNo: record.tenantId?.roomNo,
        bedNo: record.tenantId?.bedNo,
        type: "system",
        createdAt: record.createdAt,
        payload: {
          kind: "attendance_late",
          attendanceId: String(record._id),
          dateKey: record.dateKey,
          whenISO: record.lateReportedAt || record.createdAt,
          scheduledAt: record.scheduledAt,
          reason: record.lateReason || "",
          status: "pending",
        },
      }));

    res.json([...docs, ...attendanceItems].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
  } catch (err) {
    next(err);
  }
});

async function reviewLateRequest(req, res, next, approvalStatus) {
  try {
    const query = await scopedNotificationQuery(req, { _id: req.params.id, type: "system", read: { $ne: true }, "payload.kind": "attendance_late" });
    const notification = await Notification.findOne(query);
    const attendanceId = notification?.payload?.attendanceId || req.params.id;
    const tenantIds = await organizationTenantIds(req);
    const note = String(req.body?.note || "").trim().slice(0, 500) ||
      (approvalStatus === "approved" ? "Late-entry request approved" : "Late-entry request rejected");

    const attendanceFilter = {
      _id: attendanceId,
      tenantId: notification?.tenantId || { $in: tenantIds },
      status: "pending",
      approvalStatus: { $in: ["pending", null] },
    };
    if (req.organizationId) {
      attendanceFilter.$or = [
        { organizationId: req.organizationId },
        { organizationId: null },
      ];
    }
    const attendance = await Attendance.findOneAndUpdate(
      attendanceFilter,
      { $set: { approvalStatus, approvalNote: note, reviewedAt: new Date() } },
      { new: true }
    );
    if (!attendance) return res.status(404).json({ message: "Attendance request record not found" });

    if (notification) {
      notification.read = true;
      notification.payload = { ...notification.payload, status: approvalStatus, approvalNote: note };
      await notification.save();
    }
    res.json({ ok: true, attendance, notification });
  } catch (err) {
    next(err);
  }
}

router.post("/notifications/:id/approve", (req, res, next) => reviewLateRequest(req, res, next, "approved"));
router.post("/notifications/:id/reject", (req, res, next) => reviewLateRequest(req, res, next, "rejected"));

router.post("/notifications/:id/seen", async (req, res, next) => {
  try {
    const query = await scopedNotificationQuery(req, { _id: req.params.id });
    const doc = await Notification.findOneAndUpdate(
      query,
      { $set: { read: true } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: "Notification not found" });

    res.json({ ok: true, updated: doc });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
