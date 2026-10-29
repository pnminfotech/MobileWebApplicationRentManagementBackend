const Organization = require("../models/Organization");
const Room = require("../models/Room");
const Subscription = require("../models/Subscription");
const { isPastDate, getSubscriptionReadOnlyAccess } = require("./subscriptionLifecycle");
const { INTRODUCTORY_UNIT_LIMIT, totalUnits } = require("./trialUnitPolicy");

const reservationLocks = new Map();

function normalizeAllocation(units = {}) {
  return {
    beds: Math.max(0, Number(units.beds) || 0),
    rooms: Math.max(0, Number(units.rooms) || 0),
    shops: Math.max(0, Number(units.shops) || 0),
  };
}

function placeholderRoomNo(type, index) {
  const prefix = type === "shop" ? "SHOP" : type === "room" ? "ROOM" : "BED";
  return `UNASSIGNED-${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function placeholderBeds(type, index) {
  if (type === "bed") {
    return [{ bedNo: `B${index + 1}`, bedCategory: "Unassigned", price: 0 }];
  }
  return [{
    bedNo: type === "shop" ? "SHOP-1" : "ROOM-1",
    bedCategory: type === "shop" ? "Shop" : "Rental Room",
    price: 0,
  }];
}

function unitCapacity(unit) {
  if (unit?.propertyType === "bed") {
    return Math.max(Array.isArray(unit.beds) ? unit.beds.length : 0, 1);
  }
  return 1;
}

async function getUnitUsage(organizationId) {
  const [bedResult, rooms, shops] = await Promise.all([
    Room.aggregate([
      { $match: { organizationId, propertyType: "bed" } },
      { $project: { count: { $size: { $ifNull: ["$beds", []] } } } },
      { $group: { _id: null, total: { $sum: "$count" } } },
    ]),
    Room.countDocuments({ organizationId, propertyType: "room" }),
    Room.countDocuments({ organizationId, propertyType: "shop" }),
  ]);

  return {
    beds: bedResult[0]?.total || 0,
    rooms,
    shops,
  };
}

async function createMissingReservedUnits(organizationId, allocation = {}) {
  const limits = normalizeAllocation(allocation);
  const docs = [];

  for (const [type, quotaKey] of [["bed", "beds"], ["room", "rooms"], ["shop", "shops"]]) {
    const existingUnits = await Room.find({ organizationId, propertyType: type }).lean();
    const existingCount = existingUnits.reduce((sum, unit) => sum + unitCapacity(unit), 0);
    const missingCount = Math.max(0, limits[quotaKey] - existingCount);
    const usedRoomNumbers = new Set(
      existingUnits.map((unit) => String(unit.roomNo || "").trim().toUpperCase()).filter(Boolean)
    );
    let nextIndex = existingUnits.length;

    for (let index = 0; index < missingCount; index += 1) {
      let roomNo = placeholderRoomNo(type, nextIndex);
      while (usedRoomNumbers.has(roomNo)) {
        nextIndex += 1;
        roomNo = placeholderRoomNo(type, nextIndex);
      }
      usedRoomNumbers.add(roomNo);
      docs.push({
        organizationId,
        propertyType: type,
        category: "Unassigned",
        hasWing: false,
        wingName: "",
        floorNo: "Unassigned",
        flatType: type === "room" ? "Unassigned" : "",
        roomNo,
        meterNo: "",
        lastMeterReading: null,
        beds: placeholderBeds(type, nextIndex),
        isPlaceholder: true,
      });
      nextIndex += 1;
    }
  }

  if (!docs.length) return [];
  return Room.insertMany(docs);
}

async function ensureReservedUnits(organizationId, allocation = {}) {
  const key = String(organizationId || "");
  if (!key) return [];
  const existingLock = reservationLocks.get(key);
  if (existingLock) return existingLock;

  const lock = createMissingReservedUnits(organizationId, allocation)
    .finally(() => {
      reservationLocks.delete(key);
    });
  reservationLocks.set(key, lock);
  return lock;
}

async function getUnitQuota(organizationId) {
  const [organization, activeSubscription] = await Promise.all([
    Organization.findById(organizationId).lean(),
    Subscription.findOne({ organizationId, status: "active" })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  if (!organization) {
    const err = new Error("Organization not found");
    err.status = 404;
    throw err;
  }

  const subscription = activeSubscription || await Subscription.findOne({ organizationId, status: "expired" })
    .sort({ createdAt: -1 })
    .lean();
  const readOnly = getSubscriptionReadOnlyAccess(organization, subscription).readOnly;
  if (!subscription || (subscription.status !== "active" && !readOnly)) {
    const err = new Error("Active subscription required");
    err.status = 402;
    throw err;
  }

  if (isPastDate(subscription.endDate) && !readOnly) {
    const err = new Error("Subscription expired");
    err.status = 402;
    throw err;
  }

  const limits = normalizeAllocation(
    subscription.units || organization.unitAllocation
  );
  if (organization.onboardingMode !== "flexible" && !readOnly) await ensureReservedUnits(organizationId, limits);
  const usage = await getUnitUsage(organizationId);
  const introductory = organization.onboardingMode === "flexible" && !organization.unitCountsConfigured && !subscription.planId && Number(subscription.amount || 0) === 0;
  const remaining = {
    beds: Math.max(0, limits.beds - usage.beds),
    rooms: Math.max(0, limits.rooms - usage.rooms),
    shops: Math.max(0, limits.shops - usage.shops),
  };

  return {
    limits,
    usage,
    remaining,
    readOnly,
    subscriptionId: subscription._id,
    introductory,
    introductoryLimit: introductory ? INTRODUCTORY_UNIT_LIMIT : null,
    introductoryRemaining: introductory ? Math.max(0, INTRODUCTORY_UNIT_LIMIT - totalUnits(usage)) : null,
    selectedPropertyTypes: organization.onboardingMode === "flexible" ? organization.selectedPropertyTypes || [] : null,
  };
}

async function assertUnitCapacity(organizationId, requested = {}) {
  const quota = await getUnitQuota(organizationId);
  if (quota.readOnly) {
    const err = new Error("Your subscription has ended. Purchase a plan to add units.");
    err.status = 403;
    err.code = "TRIAL_READ_ONLY";
    throw err;
  }
  const increments = normalizeAllocation(requested);

  if (quota.selectedPropertyTypes) {
    const mapping = { beds: "bed", rooms: "room", shops: "shop" };
    const disallowed = Object.keys(requested).some((key) => mapping[key] && !quota.selectedPropertyTypes.includes(mapping[key]));
    if (disallowed) {
      const err = new Error("Select this property type in Profile before adding units.");
      err.status = 403;
      err.code = "UNIT_LIMIT_EXCEEDED";
      err.details = quota;
      throw err;
    }
  }

  if (quota.introductory) {
    if (totalUnits(quota.usage) + totalUnits(increments) > INTRODUCTORY_UNIT_LIMIT) {
      const err = new Error("You have reached the 10-unit trial allowance. Set your unit counts in Profile to add more units.");
      err.status = 403;
      err.code = "UNIT_LIMIT_EXCEEDED";
      err.details = quota;
      throw err;
    }
    return quota;
  }

  for (const key of ["beds", "rooms", "shops"]) {
    if (quota.usage[key] + increments[key] > quota.limits[key]) {
      const err = new Error(
        `${key.slice(0, -1)} limit exceeded. ${quota.remaining[key]} remaining.`
      );
      err.status = 403;
      err.code = "UNIT_LIMIT_EXCEEDED";
      err.details = {
        unitType: key,
        requested: increments[key],
        ...quota,
      };
      throw err;
    }
  }

  return quota;
}

module.exports = {
  assertUnitCapacity,
  ensureReservedUnits,
  getUnitQuota,
  getUnitUsage,
};
