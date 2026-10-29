const test = require("node:test");
const assert = require("node:assert/strict");
const Form = require("../models/formModels");
const Archive = require("../models/archiveSchema");
const Counter = require("../models/counterModel");
const { assignTenantSerial, previewTenantSerial } = require("../services/tenantSerial");

test("serial numbers are isolated by account and preserve archived numbers", async (t) => {
  const counters = new Map([["form_srno", 30]]);
  const records = { existing: 12, fresh: 0 };
  const archives = { existing: 18, fresh: 0 };
  t.mock.method(Form, "findOne", (scope) => ({ sort: () => ({ select: () => ({ lean: async () => records[scope.organizationId] ? { srNo: records[scope.organizationId] } : null }) }) }));
  t.mock.method(Archive, "aggregate", async (pipeline) => archives[pipeline[0].$match.organizationId] ? [{ max: archives[pipeline[0].$match.organizationId] }] : []);
  t.mock.method(Counter, "findOne", ({ name }) => ({ lean: async () => counters.has(name) ? { seq: counters.get(name) } : null }));
  t.mock.method(Counter, "updateOne", async ({ name }, update) => { counters.set(name, Math.max(counters.get(name) || 0, update.$max.seq)); });
  t.mock.method(Counter, "findOneAndUpdate", async ({ name }) => { const seq = counters.get(name) + 1; counters.set(name, seq); return { seq }; });
  assert.equal(await previewTenantSerial("fresh"), 1);
  assert.equal(await assignTenantSerial("fresh"), 1);
  assert.equal(await assignTenantSerial("fresh"), 2);
  assert.equal(await previewTenantSerial("existing"), 19);
  assert.equal(await assignTenantSerial("existing"), 19);
  assert.equal(await previewTenantSerial("fresh"), 3);
});
