const UnitStay = require("../models/UnitStay");
const Room = require("../models/Room");

const text = (value) => String(value ?? "").trim();
const keyText = (value) => text(value).replace(/\s+/g, " ").toLowerCase();
const dateOr = (value, fallback) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : fallback;
};

function propertyTypeOf(tenant = {}) {
  const type = text(tenant.propertyType).toLowerCase();
  if (type === "room" || type === "shop") return type;
  const bed = text(tenant.bedNo).toUpperCase();
  return bed === "ROOM-1" ? "room" : bed === "SHOP-1" ? "shop" : "bed";
}

function assignmentOf(tenant) {
  if (!tenant || tenant.intakeStatus === "pending_tenant") return null;
  const propertyType = propertyTypeOf(tenant);
  const roomNo = text(tenant.roomNo);
  const bedNo = propertyType === "bed" ? text(tenant.bedNo) : "";
  if (!roomNo || /^UNASSIGNED-/i.test(roomNo) || (propertyType === "bed" && !bedNo)) return null;
  return {
    unitId: text(tenant.roomId?._id || tenant.roomId), propertyType,
    category: text(tenant.category), wingName: text(tenant.wingName),
    floorNo: text(tenant.floorNo), roomNo, bedNo,
  };
}

function sameAssignment(a, b) {
  if (!a || !b || a.propertyType !== b.propertyType || keyText(a.bedNo) !== keyText(b.bedNo)) return false;
  if (a.unitId && b.unitId) return String(a.unitId) === String(b.unitId);
  return ["category", "wingName", "floorNo", "roomNo"].every((field) => keyText(a[field]) === keyText(b[field]));
}

function leaveIsDue(value) {
  const date = dateOr(value, null);
  if (!date) return false;
  date.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date <= today;
}

function staySnapshot(tenant, assignment, startedAt) {
  const monthlyRent = Number(tenant.baseRent ?? tenant.rentAmount);
  const depositAmount = Number(tenant.depositAmount);
  const tenantSrNo = tenant.srNo == null ? NaN : Number(tenant.srNo);
  return {
    organizationId: tenant.organizationId || null,
    tenantId: tenant._id,
    ...assignment,
    tenantName: text(tenant.name), phoneNo: text(tenant.phoneNo),
    tenantSrNo: Number.isFinite(tenantSrNo) ? tenantSrNo : undefined,
    joiningDate: dateOr(tenant.joiningDate, undefined),
    monthlyRent: Number.isFinite(monthlyRent) ? monthlyRent : undefined,
    depositAmount: Number.isFinite(depositAmount) ? depositAmount : undefined,
    tenantDetails: {
      address: text(tenant.address), houseNo: text(tenant.houseNo), nearbyPlace: text(tenant.nearbyPlace),
      city: text(tenant.city), state: text(tenant.state), pincode: text(tenant.pincode),
      firstRentStatus: text(tenant.firstRentStatus), shopName: text(tenant.shopName),
      shopBusiness: text(tenant.shopBusiness), familyMembers: tenant.familyMembers ?? null,
      dob: tenant.dob || null, relative1Relation: text(tenant.relative1Relation),
      relative1Name: text(tenant.relative1Name), relative1Phone: text(tenant.relative1Phone),
      relative2Relation: text(tenant.relative2Relation), relative2Name: text(tenant.relative2Name),
      relative2Phone: text(tenant.relative2Phone), companyAddress: text(tenant.companyAddress),
      hasCanteen: Boolean(tenant.hasCanteen),
      canteenPlanType: text(tenant.canteenPlanType), canteenStartDate: tenant.canteenStartDate || null,
      canteenMonthlyAmount: tenant.canteenMonthlyAmount ?? null,
      canteenIncludedMeals: Array.isArray(tenant.canteenIncludedMeals) ? tenant.canteenIncludedMeals : [],
      canteenMealPrices: tenant.canteenMealPrices || {},
      dateOfJoiningCollege: tenant.dateOfJoiningCollege || null,
      relativeAddress1: text(tenant.relativeAddress1), relativeAddress2: text(tenant.relativeAddress2),
    },
    startedAt,
  };
}

const withSession = (query, session) => session ? query.session(session) : query;

async function resolveUnitId(assignment, tenant, session) {
  if (!assignment || assignment.unitId || !assignment.category || !assignment.floorNo) return assignment;
  const query = {
    organizationId: tenant.organizationId || null,
    propertyType: assignment.propertyType,
    category: assignment.category,
    floorNo: assignment.floorNo,
    wingName: assignment.wingName,
    roomNo: assignment.roomNo,
    isPlaceholder: { $ne: true },
    ...(assignment.propertyType === "bed" ? { "beds.bedNo": assignment.bedNo } : {}),
  };
  const matches = await withSession(Room.find(query).select("_id").limit(2).collation({ locale: "en", strength: 2 }).lean(), session);
  return matches.length === 1 ? { ...assignment, unitId: String(matches[0]._id) } : assignment;
}

async function syncUnitStay(before, after, session = null) {
  const tenant = after || before;
  if (!tenant?._id) return;
  const scope = { organizationId: tenant.organizationId || null, tenantId: tenant._id };
  const oldAssignment = await resolveUnitId(assignmentOf(before), before, session);
  const newAssignment = after && !leaveIsDue(after.leaveDate)
    ? await resolveUnitId(assignmentOf(after), after, session)
    : null;
  if (!oldAssignment && !newAssignment) return;
  let open = await withSession(UnitStay.findOne({ ...scope, endedAt: null }).sort({ startedAt: -1 }).lean(), session);

  // Existing tenants may predate unit history. Record their last known stay
  // before closing it on a shift, leave, or deletion.
  if (!open && oldAssignment && !sameAssignment(oldAssignment, newAssignment)) {
    const previous = await withSession(UnitStay.findOne(scope).sort({ startedAt: -1 }).lean(), session);
    if (!previous || !leaveIsDue(before?.leaveDate)) {
      const start = dateOr(before.joiningDate, dateOr(before.createdAt, new Date()));
      const created = await UnitStay.create([staySnapshot(before, oldAssignment, start)], session ? { session } : {});
      open = created[0].toObject();
    }
  }

  const changedShiftDate = before && after?.shiftEffectiveFrom &&
    String(after.shiftEffectiveFrom) !== String(before?.shiftEffectiveFrom);
  const candidateLeaveDate = after?.leaveDate || before?.leaveDate;
  const leaveDate = leaveIsDue(candidateLeaveDate) ? candidateLeaveDate : null;
  const transitionDate = !newAssignment && leaveDate
    ? dateOr(leaveDate, new Date())
    : changedShiftDate ? dateOr(after.shiftEffectiveFrom, new Date()) : new Date();

  if (open && (!newAssignment || !sameAssignment(open, newAssignment))) {
    await UnitStay.updateOne({ _id: open._id, endedAt: null }, {
      $set: { endedAt: transitionDate, endReason: newAssignment ? "shifted" : leaveDate ? "left" : after ? "unassigned" : "removed" },
    }, session ? { session } : {});
    open = null;
  }

  if (!newAssignment) return;
  if (open) {
    const current = staySnapshot(after, newAssignment, open.startedAt);
    delete current.startedAt;
    await UnitStay.updateOne({ _id: open._id }, { $set: current }, session ? { session } : {});
    return;
  }

  const previous = await withSession(UnitStay.findOne(scope).sort({ startedAt: -1 }).lean(), session);
  const startedAt = !previous && sameAssignment(oldAssignment, newAssignment)
    ? dateOr(before.joiningDate, dateOr(before.createdAt, new Date()))
    : before || previous ? transitionDate : dateOr(after.joiningDate, dateOr(after.createdAt, new Date()));
  await UnitStay.create([staySnapshot(after, newAssignment, startedAt)], session ? { session } : {});
}

module.exports = { assignmentOf, sameAssignment, propertyTypeOf, syncUnitStay };
