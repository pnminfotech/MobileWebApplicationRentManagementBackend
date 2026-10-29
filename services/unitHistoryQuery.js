const Form = require("../models/formModels");
const Archive = require("../models/archiveSchema");
const UnitStay = require("../models/UnitStay");
const { scopedQuery } = require("../utils/organizationScope");
const { propertyTypeOf } = require("./unitHistory");

const text = (value) => String(value ?? "").trim();
const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();

function legacyMatchesUnit(tenant, room, bedNo) {
  if (tenant.intakeStatus === "pending_tenant" || propertyTypeOf(tenant) !== room.propertyType) return false;
  if (tenant.roomId) {
    if (String(tenant.roomId) !== String(room._id)) return false;
  } else if (!same(tenant.roomNo, room.roomNo) || !same(tenant.category, room.category) ||
    !same(tenant.wingName, room.wingName) || !same(tenant.floorNo, room.floorNo)) return false;
  return !bedNo || same(tenant.bedNo, bedNo);
}

function detailsOf(tenant) {
  return {
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
  };
}

async function getUnitHistory(req, room, bedNo = "") {
  const location = {
    category: room.category || "", roomNo: room.roomNo || "", floorNo: room.floorNo || "",
    wingName: room.wingName ? room.wingName : { $in: ["", null] },
  };
  const identity = { $or: [{ roomId: String(room._id) }, { roomId: { $in: ["", null] }, ...location }] };
  const stayIdentity = { $or: [{ unitId: String(room._id) }, { unitId: "", ...location }] };
  const tenantFields = "_id originalFormId srNo propertyType intakeStatus roomId roomNo bedNo category wingName floorNo name phoneNo joiningDate createdAt leaveDate baseRent rentAmount depositAmount address houseNo nearbyPlace city state pincode firstRentStatus shopName shopBusiness familyMembers dob relative1Relation relative1Name relative1Phone relative2Relation relative2Name relative2Phone relativeAddress1 relativeAddress2 companyAddress dateOfJoiningCollege hasCanteen canteenPlanType canteenStartDate canteenMonthlyAmount canteenIncludedMeals canteenMealPrices";
  const [stays, active, archived] = await Promise.all([
    UnitStay.find(scopedQuery(req, stayIdentity)).collation({ locale: "en", strength: 2 }).lean(),
    Form.find(scopedQuery(req, identity)).select(tenantFields).collation({ locale: "en", strength: 2 }).lean(),
    Archive.find(scopedQuery(req, identity)).select(tenantFields).collation({ locale: "en", strength: 2 }).lean(),
  ]);
  const targetBed = room.propertyType === "bed" ? text(bedNo) : "";
  const filteredStays = stays.filter((stay) => !targetBed || same(stay.bedNo, targetBed));
  const now = new Date();
  const currentById = new Map(active.filter((tenant) => legacyMatchesUnit(tenant, room, targetBed)).map((tenant) => [String(tenant._id), tenant]));
  const archivedById = new Map(archived.filter((tenant) => legacyMatchesUnit(tenant, room, targetBed)).map((tenant) => [String(tenant.originalFormId || tenant._id), tenant]));
  const latestStayByTenant = new Map();
  filteredStays.forEach((stay) => {
    const id = String(stay.tenantId);
    const previous = latestStayByTenant.get(id);
    if (!previous || new Date(stay.startedAt || 0) > new Date(previous.startedAt || 0)) latestStayByTenant.set(id, stay);
  });
  const records = filteredStays.map((stay) => {
    const tenantId = String(stay.tenantId);
    const currentTenant = currentById.get(tenantId);
    const archivedTenant = archivedById.get(tenantId);
    const latestStay = latestStayByTenant.get(tenantId);
    const matchingTenant = !stay.endedAt ? currentTenant : latestStay === stay ? archivedTenant : null;
    const details = { ...(stay.tenantDetails || {}) };
    if (matchingTenant) {
      const available = detailsOf(matchingTenant);
      ["canteenPlanType", "canteenStartDate", "canteenMonthlyAmount", "canteenIncludedMeals", "canteenMealPrices", "dateOfJoiningCollege", "relativeAddress1", "relativeAddress2"].forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(details, key)) details[key] = available[key];
      });
    }
    return {
      ...stay,
      tenantId,
      tenantSrNo: stay.tenantSrNo ?? currentTenant?.srNo ?? archivedTenant?.srNo ?? null,
      tenantDetails: details,
      status: stay.startedAt && new Date(stay.startedAt) > now ? "Upcoming" :
        stay.endedAt && new Date(stay.endedAt) <= now ? "Former" : "Current",
      source: "recorded",
    };
  });

  for (const [list, archivedRecord] of [[active, false], [archived, true]]) {
    for (const tenant of list) {
      if (!legacyMatchesUnit(tenant, room, targetBed)) continue;
      const tenantId = String(tenant.originalFormId || tenant._id);
      const alreadyRecorded = filteredStays.some((stay) => String(stay.tenantId) === tenantId &&
        (archivedRecord ? Boolean(stay.endedAt) : !stay.endedAt));
      if (alreadyRecorded) continue;
      const leaveDate = tenant.leaveDate ? new Date(tenant.leaveDate) : null;
      records.push({
        tenantId, unitId: String(room._id), propertyType: room.propertyType,
        category: room.category, wingName: room.wingName, floorNo: room.floorNo,
        roomNo: room.roomNo, bedNo: room.propertyType === "bed" ? text(tenant.bedNo) : "",
        tenantName: text(tenant.name), phoneNo: text(tenant.phoneNo),
        tenantSrNo: tenant.srNo ?? null,
        joiningDate: tenant.joiningDate || null, startedAt: tenant.joiningDate || tenant.createdAt || null,
        endedAt: leaveDate && !Number.isNaN(leaveDate.getTime()) && (archivedRecord || leaveDate <= now) ? leaveDate : null,
        monthlyRent: tenant.baseRent ?? tenant.rentAmount ?? null,
        depositAmount: tenant.depositAmount ?? null,
        tenantDetails: detailsOf(tenant),
        status: archivedRecord || (leaveDate && leaveDate <= now) ? "Former" : "Current",
        source: "existing_record",
      });
    }
  }

  records.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
  return {
    unit: { id: String(room._id), propertyType: room.propertyType, category: room.category,
      wingName: room.wingName, floorNo: room.floorNo, roomNo: room.roomNo, bedNo: targetBed,
      flatType: room.flatType, meterNo: room.meterNo, lastMeterReading: room.lastMeterReading },
    totalTenants: new Set(records.map((record) => record.tenantId)).size,
    totalStays: records.length,
    records,
  };
}

module.exports = { getUnitHistory, legacyMatchesUnit };
