const test = require("node:test");
const assert = require("node:assert/strict");
const { getSubscriptionReadOnlyAccess } = require("../services/subscriptionLifecycle");
const { enforceTrialReadOnlyAccess } = require("../middleware/saasAuth");
const Organization = require("../models/Organization");
const Subscription = require("../models/Subscription");
const jwt = require("jsonwebtoken");
const Room = require("../models/Room");
const { getUnitQuota, assertUnitCapacity } = require("../services/unitQuota");

const organization = { status: "expired" };
const trial = { status: "expired", planId: null, amount: 0, endDate: new Date(2026, 9, 28) };

test("expired trial data remains read only for one calendar month", () => {
  assert.equal(getSubscriptionReadOnlyAccess(organization, trial, new Date(2026, 9, 29)).readOnly, true);
  assert.equal(getSubscriptionReadOnlyAccess(organization, trial, new Date(2026, 10, 28, 23, 59)).readOnly, true);
  const after = getSubscriptionReadOnlyAccess(organization, trial, new Date(2026, 10, 29));
  assert.equal(after.readOnly, false);
  assert.ok(after.readOnlyUntil);
});

test("expired paid subscriptions also receive one month of read only access", () => {
  const paid = { ...trial, planId: "paid-plan", amount: 600 };
  assert.equal(getSubscriptionReadOnlyAccess(organization, paid, new Date(2026, 9, 29)).readOnly, true);
  assert.equal(getSubscriptionReadOnlyAccess(organization, paid, new Date(2026, 10, 28, 23, 59)).readOnly, true);
  assert.equal(getSubscriptionReadOnlyAccess(organization, paid, new Date(2026, 10, 29)).readOnly, false);
  assert.equal(getSubscriptionReadOnlyAccess({ status: "active" }, { ...trial, status: "active" }, new Date(2026, 9, 28)).readOnly, false);
  assert.equal(getSubscriptionReadOnlyAccess({ status: "suspended" }, trial, new Date(2026, 9, 29)).readOnly, false);
});

test("an active paid record with yesterday's end date enters read only access on login", () => {
  const paid = {
    status: "active",
    planId: "paid-plan",
    amount: 600,
    endDate: new Date("2026-10-27T11:13:55.680Z"),
  };
  const access = getSubscriptionReadOnlyAccess({ status: "active" }, paid, new Date("2026-10-28T12:00:00Z"));
  assert.equal(access.readOnly, true);
  assert.equal(new Date(access.readOnlyUntil).getMonth(), 10);
});

test("calendar month clamps dates at the end of a shorter month", () => {
  const januaryTrial = { ...trial, endDate: new Date(2027, 0, 31) };
  assert.equal(getSubscriptionReadOnlyAccess(organization, januaryTrial, new Date(2027, 1, 28)).readOnly, true);
  assert.equal(getSubscriptionReadOnlyAccess(organization, januaryTrial, new Date(2027, 2, 1)).readOnly, false);
});

test("API permits reads and blocks writes during the trial read only month", async (context) => {
  process.env.SAAS_JWT_SECRET = "test-only-secret-for-trial-access-tests";
  const orgId = "507f1f77bcf86cd799439011";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  let trialEndDate = yesterday;
  let paidMode = false;
  context.mock.method(Organization, "findById", async () => organization);
  context.mock.method(Subscription, "findOne", () => ({ sort: async () => ({ ...trial, planId: paidMode ? "paid-plan" : null, amount: paidMode ? 600 : 0, endDate: trialEndDate }) }));
  const token = jwt.sign({ tokenType: "system", organizationId: orgId }, process.env.SAAS_JWT_SECRET);
  const resultFor = async (method, originalUrl) => {
    const result = { next: false, status: null, body: null };
    const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
    await enforceTrialReadOnlyAccess({ method, originalUrl, headers: { authorization: `Bearer ${token}` } }, res, () => { result.next = true; });
    return result;
  };
  assert.equal((await resultFor("GET", "/api/rooms")).next, true);
  assert.equal((await resultFor("POST", "/api/rooms")).body.code, "TRIAL_READ_ONLY");
  assert.equal((await resultFor("DELETE", "/api/forms/1")).status, 403);
  assert.equal((await resultFor("POST", "/api/saas/subscription/renew-request")).next, true);
  paidMode = true;
  assert.equal((await resultFor("GET", "/api/rooms")).next, true);
  assert.equal((await resultFor("POST", "/api/rooms")).body.code, "TRIAL_READ_ONLY");
  trialEndDate = new Date();
  trialEndDate.setMonth(trialEndDate.getMonth() - 2);
  assert.equal((await resultFor("GET", "/api/rooms")).body.code, "TRIAL_DATA_ACCESS_ENDED");
  assert.equal((await resultFor("POST", "/api/saas/subscription/renew-request")).next, true);
});

test("saved unit usage remains readable without creating placeholders after trial expiry", async (context) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  context.mock.method(Organization, "findById", () => ({ lean: async () => ({ status: "expired", onboardingMode: "legacy" }) }));
  context.mock.method(Subscription, "findOne", (query) => ({ sort: () => ({ lean: async () => query.status === "expired" ? { ...trial, endDate: yesterday, units: { rooms: 12 } } : null }) }));
  context.mock.method(Room, "aggregate", async () => []);
  context.mock.method(Room, "countDocuments", async (query) => query.propertyType === "room" ? 2 : 0);
  context.mock.method(Room, "find", () => { throw new Error("Read only requests must not create reserved units"); });
  const quota = await getUnitQuota("org");
  assert.equal(quota.readOnly, true);
  assert.equal(quota.usage.rooms, 2);
  await assert.rejects(assertUnitCapacity("org", { rooms: 1 }), (error) => error.code === "TRIAL_READ_ONLY");
});
