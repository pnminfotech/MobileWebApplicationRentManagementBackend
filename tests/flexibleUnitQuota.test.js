const test = require("node:test");
const assert = require("node:assert/strict");
const Organization = require("../models/Organization");
const Subscription = require("../models/Subscription");
const Room = require("../models/Room");
const { assertUnitCapacity } = require("../services/unitQuota");

test("new trial accounts share ten units without creating placeholders", async (t) => {
  t.mock.method(Organization, "findById", () => ({ lean: async () => ({ onboardingMode: "flexible", selectedPropertyTypes: ["bed", "room", "shop"], unitCountsConfigured: false }) }));
  t.mock.method(Subscription, "findOne", () => ({ sort: () => ({ lean: async () => ({ _id: "trial", status: "active", endDate: new Date(Date.now() + 86400000), units: {}, amount: 0 }) }) }));
  t.mock.method(Room, "aggregate", async () => [{ total: 6 }]);
  t.mock.method(Room, "countDocuments", async (query) => query.propertyType === "room" ? 3 : 0);
  t.mock.method(Room, "find", () => { throw new Error("Flexible accounts must not create placeholders"); });
  await assert.doesNotReject(assertUnitCapacity("org", { shops: 1 }));
  await assert.rejects(assertUnitCapacity("org", { beds: 2 }), (error) => error.code === "UNIT_LIMIT_EXCEEDED" && /10-unit/.test(error.message));
});

test("a selected type without allocated capacity cannot be added after counts are set", async (t) => {
  t.mock.method(Organization, "findById", () => ({ lean: async () => ({ onboardingMode: "flexible", selectedPropertyTypes: ["room", "shop"], unitCountsConfigured: true }) }));
  t.mock.method(Subscription, "findOne", () => ({ sort: () => ({ lean: async () => ({ _id: "trial", status: "active", endDate: new Date(Date.now() + 86400000), units: { rooms: 2, shops: 0 }, amount: 0 }) }) }));
  t.mock.method(Room, "aggregate", async () => []);
  t.mock.method(Room, "countDocuments", async () => 0);
  await assert.doesNotReject(assertUnitCapacity("org", { rooms: 1 }));
  await assert.rejects(assertUnitCapacity("org", { shops: 1 }), (error) => error.code === "UNIT_LIMIT_EXCEEDED");
  await assert.rejects(assertUnitCapacity("org", { beds: 1 }), (error) => error.code === "UNIT_LIMIT_EXCEEDED" && /Select this property type/.test(error.message));
});
