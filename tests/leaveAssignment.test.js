const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Form = require("../models/formModels");
const Archive = require("../models/archiveSchema");
const Room = require("../models/Room");
const historyService = require("../services/unitHistory");
const originalHistorySync = historyService.syncUnitStay;
historyService.syncUnitStay = async () => {};

// Loading the controller normally starts the daily archive job. These tests
// exercise its handlers with in-memory records and never connect to MongoDB.
const oldTimeout = global.setTimeout;
const oldInterval = global.setInterval;
global.setTimeout = () => 0;
global.setInterval = () => 0;
const sms = require("../services/smsService");
sms.sendAdmissionSms = async () => {};
const controller = require("../controllers/formController");
const router = require("../routes/formRoutes");
historyService.syncUnitStay = originalHistorySync;
global.setTimeout = oldTimeout;
global.setInterval = oldInterval;

const undo = router.stack.find((layer) => layer.route?.path === "/cancel-leave").route.stack[0].handle;
const objectId = () => new mongoose.Types.ObjectId();
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const mockFind = (getRows) => () => ({
  select: () => ({ lean: async () => getRows() }),
  lean: async () => getRows(),
});

test("leave, undo and assignment protect occupancy for beds, rooms and shops", async () => {
  const missingFields = Object.keys(Form.schema.paths).filter((key) => !Archive.schema.path(key));
  assert.deepEqual(missingFields, [], "the archive must retain all tenant fields");
  const formRentFields = Form.schema.path("rents").schema.paths;
  const archiveRentFields = Archive.schema.path("rents").schema.paths;
  assert.deepEqual(Object.keys(formRentFields).filter((key) => !archiveRentFields[key]), [], "the archive must retain payment totals");
  const originals = {
    formFindOne: Form.findOne, formFind: Form.find, formFindById: Form.findById,
    formUpdate: Form.findOneAndUpdate, formDelete: Form.deleteOne,
    formSave: Form.prototype.save, archiveFind: Archive.findOne,
    archiveUpdate: Archive.findOneAndUpdate, archiveDelete: Archive.deleteOne,
    roomFind: Room.find, roomFindOne: Room.findOne,
  };
  try {
    for (const type of ["bed", "room", "shop"]) {
      const oldRoomId = String(objectId());
      const otherRoomId = String(objectId());
      const tenantId = objectId();
      const bedNo = type === "bed" ? "A1" : type === "room" ? "ROOM-1" : "SHOP-1";
      const otherBedNo = type === "bed" ? "A2" : bedNo;
      const room = { _id: oldRoomId, propertyType: type, category: "Building", wingName: "A", floorNo: "1", roomNo: "45", beds: type === "bed" ? [{ bedNo: "A1" }, { bedNo: "A2" }] : [{ bedNo }] };
      const otherRoom = { _id: otherRoomId, propertyType: type, category: "Building", wingName: "A", floorNo: "1", roomNo: "46", beds: [{ bedNo: otherBedNo }] };
      const otherType = type === "shop" ? "room" : "shop";
      const wrongRoom = { _id: String(objectId()), propertyType: otherType, category: "Building", wingName: "A", floorNo: "1", roomNo: "77", beds: [{ bedNo: otherType === "shop" ? "SHOP-1" : "ROOM-1" }] };
      const pendingRoom = { _id: String(objectId()), propertyType: type, category: "Unassigned", floorNo: "Unassigned", roomNo: `UNASSIGNED-${type}-1`, isPlaceholder: true, beds: [{ bedNo }] };
      const otherPendingRoom = { ...pendingRoom, _id: String(objectId()), propertyType: otherType };
      const inventory = [room, otherRoom, pendingRoom, otherPendingRoom];
      const targetRoom = type === "bed" ? room : otherRoom;
      const former = new Form({
        _id: tenantId, srNo: 456, name: "Former tenant", phoneNo: 1234567890,
        joiningDate: new Date("2025-01-01"), depositAmount: 1000, propertyType: type,
        category: "Building", wingName: "A", floorNo: "1", roomNo: "45", roomId: oldRoomId, bedNo,
        baseRent: 2000, hasCanteen: true, canteenPlanType: "full_package", canteenMonthlyAmount: 500, joiningDateChangeUsed: true,
        rentHistory: [{ effectiveFrom: new Date("2025-01-01"), baseRent: 2000, source: "initial" }],
        rents: [{ month: "Jan-25", date: new Date("2025-01-01"), paymentMode: "Cash", rentAmount: 2000, lightBillAmount: 500, totalAmount: 2500,
          payments: [{ amount: 2500, rentAmount: 2000, lightBillAmount: 500, date: new Date("2025-01-01"), paymentMode: "Cash" }] }],
      });
      Archive.findOneAndUpdate = originals.archiveUpdate;
      const archiveUpdateQuery = Archive.findOneAndUpdate({ _id: tenantId }, { $set: former.toObject() });
      const castArchiveUpdate = archiveUpdateQuery._castUpdate(archiveUpdateQuery.getUpdate());
      assert.equal(castArchiveUpdate.$set.canteenMonthlyAmount, 500);
      assert.equal(castArchiveUpdate.$set.rents[0].lightBillAmount, 500);
      let archived;
      let deleted = false;
      Form.findOneAndUpdate = async (_query, update) => {
        Object.assign(former, update.$set);
        return former;
      };
      Archive.findOneAndUpdate = async (query, update) => {
        archived = new Archive({ _id: query._id, ...update.$set });
        return archived;
      };
      Form.deleteOne = async () => { deleted = true; };
      const scheduledRes = response();
      await controller.processLeave({ body: { tenantId, leaveDate: "2099-02-01" } }, scheduledRes);
      assert.equal(scheduledRes.body.archived, false, `${type}: a future leave stays scheduled`);
      assert.equal(deleted, false);
      const leaveRes = response();
      await controller.processLeave({ body: { tenantId, leaveDate: "2025-02-01" } }, leaveRes);
      assert.equal(leaveRes.body.archived, true, `${type}: leave should archive the tenant`);
      assert.equal(deleted, true);
      assert.equal(archived.canteenMonthlyAmount, 500);
      assert.equal(archived.rents[0].lightBillAmount, 500);

      // Some older residential and shop tenants were stored as "bed".
      if (type !== "bed") archived.propertyType = "bed";
      const occupant = { _id: objectId(), name: "Occupant", propertyType: "bed", roomId: oldRoomId,
        category: "Building", wingName: "A", floorNo: "1", roomNo: "45", bedNo: type === "bed" ? "a1" : bedNo };
      const occupants = [occupant];
      Form.findOne = async () => null;
      Archive.findOne = async () => archived;
      Form.find = mockFind(() => occupants);
      Room.find = mockFind(() => inventory);
      Room.findOne = (query) => ({ lean: async () => [...inventory, wrongRoom].find((entry) => String(entry._id) === String(query._id)) || null });
      let restored;
      let archiveRemoved = false;
      Form.prototype.save = async function () { assert.equal(this.validateSync(), undefined); restored = this.toObject(); return this; };
      Archive.deleteOne = async () => { archiveRemoved = true; };

      const occupiedRes = response();
      await undo({ body: { id: String(tenantId) } }, occupiedRes);
      assert.equal(occupiedRes.statusCode, 409, `${type}: occupied unit must block Undo`);
      assert.equal(occupiedRes.body.code, "BED_OCCUPIED");
      assert.equal(occupiedRes.body.pendingDetailsCount, 1, `${type}: only unconfigured units in this section should be counted`);
      assert.ok(!occupiedRes.body.vacantBeds.some((slot) => slot.roomId === String(pendingRoom._id)));
      assert.equal(archiveRemoved, false);
      const pendingUndoRes = response();
      await undo({ body: { id: String(tenantId), roomId: String(pendingRoom._id), roomNo: pendingRoom.roomNo, bedNo } }, pendingUndoRes);
      assert.equal(pendingUndoRes.statusCode, 409);
      assert.match(pendingUndoRes.body.message, /needs its details/);
      assert.equal(pendingUndoRes.body.pendingDetailsCount, 1);
      const wrongUndoRes = response();
      await undo({ body: { id: String(tenantId), roomId: String(wrongRoom._id), roomNo: wrongRoom.roomNo, bedNo: wrongRoom.beds[0].bedNo } }, wrongUndoRes);
      assert.equal(wrongUndoRes.statusCode, 400, `${type}: Undo must reject a different section`);
      const vacant = occupiedRes.body.vacantBeds.find((slot) => slot.roomId === String(targetRoom._id) && slot.bedNo === otherBedNo);
      assert.ok(vacant, `${type}: another vacant unit should be offered`);
      assert.ok(!occupiedRes.body.vacantBeds.some((slot) => slot.roomId === oldRoomId && slot.bedNo === bedNo));

      const undoRes = response();
      await undo({ body: { id: String(tenantId), ...vacant } }, undoRes);
      assert.equal(undoRes.statusCode, 200, `${type}: selected vacancy should restore tenant`);
      assert.equal(restored.propertyType, type);
      assert.equal(String(restored._id), String(tenantId));
      assert.equal(restored.roomId, String(targetRoom._id));
      assert.equal(restored.bedNo, otherBedNo);
      assert.equal(restored.rents[0].rentAmount, 2000);
      assert.equal(restored.rents[0].lightBillAmount, 500);
      assert.equal(restored.rents[0].payments[0].lightBillAmount, 500);
      assert.equal(restored.canteenMonthlyAmount, 500);
      assert.equal(restored.joiningDateChangeUsed, true);
      assert.equal(restored.rentHistory[0].baseRent, 2000);
      assert.equal(archiveRemoved, true);

      const pending = new Form({ ...former.toObject(), _id: tenantId, intakeStatus: "pending_tenant", pendingAssignmentOrigin: "returning_tenant", roomId: "", roomNo: "", bedNo: "" });
      Form.findById = async () => pending;
      let assignedUpdate;
      Form.findOneAndUpdate = async (_query, update) => { assignedUpdate = update.$set; return { ...pending.toObject(), ...assignedUpdate }; };
      const assignmentRes = response();
      await controller.updateFormById({ params: { id: String(tenantId) }, organization: { features: {} },
        body: { propertyType: type, roomId: oldRoomId, category: "Building", wingName: "A", floorNo: "1", roomNo: "45", bedNo, intakeStatus: "submitted" } }, assignmentRes);
      assert.equal(assignmentRes.statusCode, 409, `${type}: assignment must reject occupied unit`);
      assert.equal(assignedUpdate, undefined);
      const freeAssignmentRes = response();
      await controller.updateFormById({ params: { id: String(tenantId) }, organization: { features: {} },
        body: { propertyType: type, roomId: String(targetRoom._id), category: "Building", wingName: "A", floorNo: "1", roomNo: targetRoom.roomNo, bedNo: otherBedNo, intakeStatus: "submitted" } }, freeAssignmentRes);
      assert.equal(freeAssignmentRes.statusCode, 200, `${type}: vacancy should be assignable`);
      assert.equal(assignedUpdate.roomId, String(targetRoom._id));
      assert.ok(!Object.hasOwn(assignedUpdate, "rents"), `${type}: returning payments must remain intact`);
      assert.ok(!Object.hasOwn(assignedUpdate, "rentHistory"), `${type}: returning history must remain intact`);

      occupants.length = 0;
      archiveRemoved = false;
      const freeUndoRes = response();
      await undo({ body: { id: String(tenantId) } }, freeUndoRes);
      assert.equal(freeUndoRes.statusCode, 200, `${type}: a free original unit should restore directly`);
      assert.equal(restored.roomId, oldRoomId);
      assert.equal(restored.bedNo, bedNo);
      assert.equal(archiveRemoved, true);

      const quick = new Form({ ...pending.toObject(), pendingAssignmentOrigin: "quick_add", firstRentStatus: "ADVANCE_PAID" });
      Form.findById = async () => quick;
      Form.findOneAndUpdate = async (_query, update) => {
        const merged = new Form({ ...quick.toObject(), ...update.$set });
        const validation = merged.validateSync();
        if (validation) throw validation;
        return merged;
      };
      const quickRes = response();
      await controller.updateFormById({ params: { id: String(tenantId) }, organization: { features: {} },
        body: { propertyType: type, roomId: String(targetRoom._id), category: "Building", wingName: "A", floorNo: "1", roomNo: targetRoom.roomNo, bedNo: otherBedNo, baseRent: 2000, intakeStatus: "submitted" } }, quickRes);
      assert.equal(quickRes.statusCode, 200, `${type}: Quick tenant assignment should save`);
      assert.equal(quickRes.body.form.baseRent, 2000);
      assert.equal(quickRes.body.form.rents[0].month, "Jan-25");
      assert.equal(quickRes.body.form.rents[0].lightBillAmount, 500);
      assert.equal(quickRes.body.form.rents[0].payments[0].lightBillAmount, 500);

      const missingUnitRes = response();
      await controller.updateFormById({ params: { id: String(tenantId) }, organization: { features: {} },
        body: { propertyType: type, roomId: String(objectId()), roomNo: "99", bedNo, intakeStatus: "submitted" } }, missingUnitRes);
      assert.equal(missingUnitRes.statusCode, 409, `${type}: a deleted unit must not be assigned`);
      const wrongAssignmentRes = response();
      await controller.updateFormById({ params: { id: String(tenantId) }, organization: { features: {} },
        body: { propertyType: type, roomId: String(wrongRoom._id), roomNo: wrongRoom.roomNo, bedNo, intakeStatus: "submitted" } }, wrongAssignmentRes);
      assert.equal(wrongAssignmentRes.statusCode, 400, `${type}: assignment must reject a different section`);

      occupants.push(occupant, { ...occupant, _id: objectId(), roomId: otherRoomId, roomNo: "46", bedNo: otherBedNo });
      if (type === "bed") occupants.push({ ...occupant, _id: objectId(), bedNo: "A2" });
      const noVacancyRes = response();
      await undo({ body: { id: String(tenantId) } }, noVacancyRes);
      assert.equal(noVacancyRes.statusCode, 409, `${type}: occupied original must stay archived`);
      assert.equal(noVacancyRes.body.vacantBeds.length, 0, `${type}: occupied units must not be offered`);
      assert.equal(noVacancyRes.body.pendingDetailsCount, 1, `${type}: an unconfigured unit is not an available unit`);
      const incompleteRoom = { ...pendingRoom, _id: String(objectId()), isPlaceholder: false, roomNo: "48", category: "", floorNo: "" };
      inventory.push(incompleteRoom);
      const incompleteRes = response();
      await undo({ body: { id: String(tenantId) } }, incompleteRes);
      assert.equal(incompleteRes.body.pendingDetailsCount, 2, `${type}: incomplete legacy units must be counted`);
      assert.ok(!incompleteRes.body.vacantBeds.some((slot) => slot.roomId === incompleteRoom._id));
      occupants.push({ ...occupant, _id: objectId(), propertyType: type, roomId: "", roomNo: "48", wingName: "", bedNo });
      const occupiedIncompleteRes = response();
      await undo({ body: { id: String(tenantId) } }, occupiedIncompleteRes);
      assert.equal(occupiedIncompleteRes.body.pendingDetailsCount, 1, `${type}: an occupied incomplete legacy unit must not be counted`);
      occupants.pop();
      inventory.pop();
      occupants.push({ ...occupant, _id: objectId(), propertyType: type, roomId: pendingRoom._id, roomNo: pendingRoom.roomNo, bedNo });
      const occupiedPendingRes = response();
      await undo({ body: { id: String(tenantId) } }, occupiedPendingRes);
      assert.equal(occupiedPendingRes.body.pendingDetailsCount, 0, `${type}: an occupied incomplete unit must not be offered for setup`);
      occupants.pop();
      inventory.splice(inventory.indexOf(pendingRoom), 1);
      const noPendingRes = response();
      await undo({ body: { id: String(tenantId) } }, noPendingRes);
      assert.equal(noPendingRes.body.pendingDetailsCount, 0, `${type}: no pending details should be reported when all units are set up`);

      occupants.length = 0;
      const scheduled = new Form({ ...former.toObject(), leaveDate: "2099-02-01" });
      Form.findOne = async () => scheduled;
      let scheduledUpdate;
      Form.findOneAndUpdate = async (_query, update) => { scheduledUpdate = update; return scheduled; };
      const cancelScheduledRes = response();
      await undo({ body: { id: String(tenantId) } }, cancelScheduledRes);
      assert.equal(cancelScheduledRes.statusCode, 200, `${type}: a scheduled leave should be cancellable`);
      assert.ok(Object.hasOwn(scheduledUpdate.$unset, "leaveDate"));
    }
  } finally {
    Form.findOne = originals.formFindOne; Form.find = originals.formFind; Form.findById = originals.formFindById;
    Form.findOneAndUpdate = originals.formUpdate; Form.deleteOne = originals.formDelete; Form.prototype.save = originals.formSave;
    Archive.findOne = originals.archiveFind; Archive.findOneAndUpdate = originals.archiveUpdate; Archive.deleteOne = originals.archiveDelete;
    Room.find = originals.roomFind; Room.findOne = originals.roomFindOne;
  }
});
