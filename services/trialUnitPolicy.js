// The introductory allowance is shared by beds, residential rooms and shops.
const INTRODUCTORY_UNIT_LIMIT = 10;
const UNIT_KEYS = ["beds", "rooms", "shops"];

function totalUnits(units = {}) {
  return UNIT_KEYS.reduce((total, key) => total + Math.max(0, Number(units[key]) || 0), 0);
}

function canAddIntroductoryUnits(usage = {}, requested = {}) {
  return totalUnits(usage) + totalUnits(requested) <= INTRODUCTORY_UNIT_LIMIT;
}

function allocationCoversUsage(allocation = {}, usage = {}) {
  return UNIT_KEYS.every((key) => Number(allocation[key] || 0) >= Number(usage[key] || 0));
}

module.exports = { INTRODUCTORY_UNIT_LIMIT, totalUnits, canAddIntroductoryUnits, allocationCoversUsage };
