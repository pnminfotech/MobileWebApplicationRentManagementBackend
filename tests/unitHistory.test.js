const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const UnitStay = require("../models/UnitStay");
const Form = require("../models/formModels");
const Archive = require("../models/archiveSchema");
const { assignmentOf, sameAssignment, syncUnitStay } = require("../services/unitHistory");
const { getUnitHistory, legacyMatchesUnit } = require("../services/unitHistoryQuery");

test("unit stay history records assignments, moves, leave and return", async () => {
  const original = { findOne: UnitStay.findOne, create: UnitStay.create, updateOne: UnitStay.updateOne };
  const entries = [];
  const sameId = (a, b) => String(a || "") === String(b || "");
  UnitStay.findOne = (query) => ({ sort: () => ({ lean: async () => [...entries].reverse().find((entry) =>
    sameId(entry.tenantId, query.tenantId) && sameId(entry.organizationId, query.organizationId) &&
    (query.endedAt !== null || entry.endedAt == null)) || null }) });
  UnitStay.create = async (docs) => docs.map((doc) => {
    const entry = { ...doc, _id: new mongoose.Types.ObjectId(), endedAt: null };
    entries.push(entry);
    return { toObject: () => ({ ...entry }) };
  });
  UnitStay.updateOne = async (filter, update) => {
    const entry = entries.find((item) => sameId(item._id, filter._id) && (filter.endedAt !== null || item.endedAt == null));
    if (entry) Object.assign(entry, update.$set);
  };

  try {
    const tenant = { _id: new mongoose.Types.ObjectId(), organizationId: new mongoose.Types.ObjectId(),
      name: "Tenant", srNo: 18, phoneNo: "1234567890", propertyType: "bed", roomId: "unit-a", category: "Building",
      floorNo: "1", roomNo: "101", bedNo: "B1", joiningDate: new Date("2025-01-01"), baseRent: 3000, depositAmount: 5000,
      hasCanteen: true, canteenPlanType: "per_meal", canteenIncludedMeals: ["lunch"], canteenMealPrices: { lunch: 50 } };
    assert.equal(assignmentOf({ ...tenant, intakeStatus: "pending_tenant" }), null);
    assert.equal(sameAssignment(assignmentOf(tenant), assignmentOf({ ...tenant, bedNo: "b1" })), true);
    await syncUnitStay(null, tenant);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].tenantSrNo, 18);
    assert.equal(entries[0].tenantDetails.canteenMealPrices.lunch, 50);
    assert.equal(entries[0].startedAt.toISOString(), "2025-01-01T00:00:00.000Z");
    await syncUnitStay(tenant, { ...tenant, name: "Updated name" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].tenantName, "Updated name");

    const shifted = { ...tenant, roomId: "unit-b", roomNo: "102", bedNo: "B2", shiftEffectiveFrom: new Date("2025-03-01") };
    await syncUnitStay(tenant, shifted);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].endReason, "shifted");
    assert.equal(entries[0].endedAt.toISOString(), "2025-03-01T00:00:00.000Z");
    assert.equal(entries[1].unitId, "unit-b");
    const left = { ...shifted, leaveDate: "2025-04-01" };
    await syncUnitStay(shifted, left);
    assert.equal(entries[1].endReason, "left");
    await syncUnitStay(left, null);
    assert.equal(entries.length, 2, "archiving must not duplicate a closed stay");
    await syncUnitStay(null, { ...shifted, leaveDate: "" });
    assert.equal(entries.length, 3, "returning creates a separate stay");
    assert.equal(entries[2].endedAt, null);
    await syncUnitStay(shifted, null);
    assert.equal(entries[2].endReason, "removed");

    const older = { ...tenant, _id: new mongoose.Types.ObjectId(), roomId: "unit-old", leaveDate: "2025-02-01" };
    await syncUnitStay(older, null);
    assert.equal(entries[3].unitId, "unit-old");
    assert.equal(entries[3].endReason, "left");
    await syncUnitStay(null, { ...older, roomId: "unit-new", roomNo: "103", leaveDate: "" });
    assert.equal(entries[4].unitId, "unit-new");
    assert.ok(entries[4].startedAt > entries[3].endedAt, "return should begin a new stay after the old one ended");

    const pending = { ...tenant, _id: new mongoose.Types.ObjectId(), intakeStatus: "pending_tenant", roomId: "", roomNo: "", bedNo: "" };
    await syncUnitStay(null, pending);
    assert.equal(entries.length, 5, "unassigned tenants must not create a stay");
    await syncUnitStay(pending, { ...tenant, _id: pending._id, intakeStatus: "submitted" });
    assert.ok(entries[5].startedAt > tenant.joiningDate, "an assignment made later should start when the unit was assigned");

    const olderActive = { ...tenant, _id: new mongoose.Types.ObjectId() };
    await syncUnitStay(olderActive, { ...olderActive, name: "Edited" });
    assert.equal(entries[6].startedAt.toISOString(), "2025-01-01T00:00:00.000Z", "an existing stay should retain its original joining date");
    await syncUnitStay({ ...olderActive, leaveDate: "2099-01-01" }, null);
    assert.equal(entries[6].endReason, "removed", "deleting before a scheduled leave ends the stay now");
  } finally {
    UnitStay.findOne = original.findOne; UnitStay.create = original.create; UnitStay.updateOne = original.updateOne;
  }
});

test("legacy room and shop tenants are matched without confusing sections", async () => {
  for (const [type, bedNo] of [["room", "ROOM-1"], ["shop", "SHOP-1"]]) {
    const room = { _id: new mongoose.Types.ObjectId(), propertyType: type, category: "Building", wingName: "A", floorNo: "1", roomNo: "45" };
    const tenant = { propertyType: "bed", roomId: String(room._id), roomNo: "45", bedNo, name: "Legacy" };
    assert.equal(legacyMatchesUnit(tenant, room, ""), true, `${type} legacy tenant should match`);
    assert.equal(legacyMatchesUnit({ ...tenant, roomId: String(new mongoose.Types.ObjectId()) }, room, ""), false);
  }
});

test("unit history combines recorded stays with matching older tenants", async () => {
  const originals = { stayFind: UnitStay.find, formFind: Form.find, archiveFind: Archive.find };
  const roomId = new mongoose.Types.ObjectId();
  const activeId = new mongoose.Types.ObjectId();
  const oldId = new mongoose.Types.ObjectId();
  const room = { _id: roomId, propertyType: "bed", category: "Building", wingName: "A", floorNo: "1", roomNo: "101" };
  const active = { _id: activeId, srNo: 18, propertyType: "bed", roomId: String(roomId), roomNo: "101", bedNo: "B1", name: "Current", joiningDate: new Date("2026-01-01"), canteenPlanType: "full_package", canteenMonthlyAmount: 500 };
  const old = { _id: oldId, srNo: 19, propertyType: "bed", roomId: "", roomNo: "101", bedNo: "B1", category: "Building", wingName: "A", floorNo: "1", name: "Former", joiningDate: new Date("2025-01-01"), leaveDate: "2025-12-01", canteenIncludedMeals: ["dinner"], canteenMealPrices: { dinner: 75 } };
  const queryResult = (rows) => ({ select() { return this; }, collation() { return this; }, lean: async () => rows });
  UnitStay.find = () => queryResult([{ _id: new mongoose.Types.ObjectId(), tenantId: activeId, unitId: String(roomId), bedNo: "B1", tenantName: "Current", startedAt: new Date("2026-01-01"), endedAt: null, tenantDetails: { address: "Saved address", canteenMonthlyAmount: 0 } }]);
  Form.find = () => queryResult([active]);
  Archive.find = () => queryResult([old, { ...old, _id: new mongoose.Types.ObjectId(), wingName: "B" }]);
  try {
    assert.equal(legacyMatchesUnit(old, room, "B1"), true);
    assert.equal(legacyMatchesUnit({ ...old, wingName: "B" }, room, "B1"), false);
    const result = await getUnitHistory({}, room, "B1");
    assert.equal(result.totalTenants, 2);
    assert.equal(result.totalStays, 2);
    assert.equal(result.records.find((entry) => entry.status === "Former").tenantSrNo, 19);
    assert.equal(result.records.find((entry) => entry.status === "Former").tenantDetails.canteenMealPrices.dinner, 75);
    assert.equal(result.records.find((entry) => entry.status === "Current").tenantSrNo, 18);
    assert.equal(result.records.find((entry) => entry.status === "Current").tenantDetails.canteenPlanType, "full_package");
    assert.equal(result.records.find((entry) => entry.status === "Current").tenantDetails.canteenMonthlyAmount, 0);
    assert.equal(result.records.find((entry) => entry.status === "Current").tenantDetails.address, "Saved address");
    assert.deepEqual(result.records.map((entry) => entry.status).sort(), ["Current", "Former"]);
  } finally {
    UnitStay.find = originals.stayFind; Form.find = originals.formFind; Archive.find = originals.archiveFind;
  }
});

test("saving an assigned tenant creates a unit stay", async () => {
  const originals = { insertOne: Form.collection.insertOne, findOne: UnitStay.findOne, create: UnitStay.create };
  const created = [];
  Form.collection.insertOne = async (doc) => ({ acknowledged: true, insertedId: doc._id });
  UnitStay.findOne = () => ({ sort: () => ({ lean: async () => null }) });
  UnitStay.create = async (docs) => docs.map((doc) => {
    created.push(doc);
    return { toObject: () => doc };
  });
  try {
    const tenant = new Form({ srNo: 989898, name: "Assigned", phoneNo: 1234567890, joiningDate: new Date("2025-01-01"),
      depositAmount: 1000, propertyType: "room", roomId: "unit-1", category: "Building", floorNo: "1", roomNo: "45", bedNo: "ROOM-1", baseRent: 3000 });
    await tenant.save();
    assert.equal(created.length, 1);
    assert.equal(created[0].unitId, "unit-1");
    assert.equal(created[0].tenantName, "Assigned");
    assert.equal(created[0].monthlyRent, 3000);
  } finally {
    Form.collection.insertOne = originals.insertOne; UnitStay.findOne = originals.findOne; UnitStay.create = originals.create;
  }
});
