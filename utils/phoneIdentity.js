function normalizePhoneIdentity(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const phone = digits.startsWith("91") && digits.length === 12
    ? digits.slice(2)
    : digits.startsWith("0") && digits.length === 11
      ? digits.slice(1)
      : digits;
  return /^[6-9]\d{9}$/.test(phone) ? phone : "";
}

function phoneIdentityVariants(phone) {
  return [phone, `+91${phone}`, `91${phone}`, `0${phone}`];
}

function phoneIdentityNumberVariants(phone) {
  return [phone, `91${phone}`, `0${phone}`].map(Number);
}

function phoneConflict(message) {
  const error = new Error(message);
  error.code = "PHONE_IDENTITY_CONFLICT";
  error.http = 409;
  return error;
}

async function findTenantPhoneMatches(value, { excludeTenantId } = {}) {
  const phone = normalizePhoneIdentity(value);
  if (!phone) return [];

  const Form = require("../models/formModels");
  const query = { phoneNo: { $in: phoneIdentityNumberVariants(phone) } };
  if (excludeTenantId) query._id = { $ne: excludeTenantId };
  return Form.find(query).select("_id name propertyType phoneNo organizationId").lean();
}

async function findSystemAdminPhoneMatches(value, { excludeSystemUserId } = {}) {
  const phone = normalizePhoneIdentity(value);
  if (!phone) return [];

  const SystemUser = require("../models/SystemUser");
  const query = { role: "system_admin", phone: { $in: phoneIdentityVariants(phone) } };
  if (excludeSystemUserId) query._id = { $ne: excludeSystemUserId };
  return SystemUser.find(query).select("_id name phone role organizationId").lean();
}

async function assertTenantPhoneAvailable(value, { excludeTenantId } = {}) {
  const phone = normalizePhoneIdentity(value);
  if (!phone) return;

  const [tenantMatches, adminMatches] = await Promise.all([
    findTenantPhoneMatches(phone, { excludeTenantId }),
    findSystemAdminPhoneMatches(phone),
  ]);

  if (tenantMatches.length) {
    throw phoneConflict("This mobile number is already used by another tenant. Each tenant can have only one record across beds, rooms, and shops.");
  }
  if (adminMatches.length) {
    throw phoneConflict("This mobile number is already registered to a system admin and cannot be used for a tenant.");
  }
}

async function assertSystemAdminPhoneAvailable(value, { excludeSystemUserId } = {}) {
  const phone = normalizePhoneIdentity(value);
  if (!phone) return;

  const [tenantMatches, adminMatches] = await Promise.all([
    findTenantPhoneMatches(phone),
    findSystemAdminPhoneMatches(phone, { excludeSystemUserId }),
  ]);

  if (tenantMatches.length) {
    throw phoneConflict("This mobile number is already registered to a tenant and cannot be used for a system admin account.");
  }
  if (adminMatches.length) {
    throw phoneConflict("This mobile number is already linked to another system admin account.");
  }
}

module.exports = {
  normalizePhoneIdentity,
  phoneIdentityVariants,
  phoneIdentityNumberVariants,
  findTenantPhoneMatches,
  findSystemAdminPhoneMatches,
  assertTenantPhoneAvailable,
  assertSystemAdminPhoneAvailable,
};
