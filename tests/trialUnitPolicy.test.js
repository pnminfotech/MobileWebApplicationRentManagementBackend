const test = require("node:test");
const assert = require("node:assert/strict");
const { totalUnits, canAddIntroductoryUnits, allocationCoversUsage } = require("../services/trialUnitPolicy");

test("the introductory allowance is shared across property types", () => {
  const usage = { beds: 5, rooms: 3, shops: 1 };
  assert.equal(totalUnits(usage), 9);
  assert.equal(canAddIntroductoryUnits(usage, { shops: 1 }), true);
  assert.equal(canAddIntroductoryUnits(usage, { beds: 2 }), false);
});

test("configured counts must cover existing units of each type", () => {
  const usage = { beds: 5, rooms: 3, shops: 1 };
  assert.equal(allocationCoversUsage({ beds: 5, rooms: 3, shops: 2 }, usage), true);
  assert.equal(allocationCoversUsage({ beds: 4, rooms: 4, shops: 2 }, usage), false);
});
