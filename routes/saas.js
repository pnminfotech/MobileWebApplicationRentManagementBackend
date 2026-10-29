const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const Organization = require("../models/Organization");
const SystemUser = require("../models/SystemUser");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const ReferralCode = require("../models/ReferralCode");
const Subscription = require("../models/Subscription");
const BillingTransaction = require("../models/BillingTransaction");
const PasswordResetToken = require("../models/PasswordResetToken");
const LoginEmailChallenge = require("../models/LoginEmailChallenge");
const BusinessPhoneLoginChallenge = require("../models/BusinessPhoneLoginChallenge");
const SuperadminEmailChange = require("../models/SuperadminEmailChange");
const Room = require("../models/Room");
const Form = require("../models/formModels");
const Payment = require("../models/Payment");
const OtherExpense = require("../models/OtherExpense");
const LightBillEntry = require("../models/LightBillEntry");
const CommercialUnit = require("../models/CommercialUnit");
const StaffExpense = require("../models/StaffExpense");
const Invoice = require("../models/Invoice");
const PaymentNotification = require("../models/PaymentNotification");
const LeaveRequest = require("../models/LeaveRequest");
const LeaveNotification = require("../models/LeaveNotification");
const Attendance = require("../models/Attendance");
const Notification = require("../models/Notification");
const Archive = require("../models/archiveSchema");
const DuplicateForm = require("../models/DuplicateForm");
const AuditLog = require("../models/AuditLog");
const {
  getJwtSecret,
  signSystemToken,
  requireSystemAuth,
  requireRole,
  requireActiveOrganization,
} = require("../middleware/saasAuth");
const {
  slugify,
  normalizeUnits,
  normalizeDiscountPercent,
  applyDiscount,
  calculateSubscriptionPricing,
  calculatePendingSubscriptionPricing,
  calculateSubscriptionAmount,
  addMonths,
} = require("../utils/saas");
const { ensureReservedUnits, getUnitQuota, getUnitUsage } = require("../services/unitQuota");
const { allocationCoversUsage } = require("../services/trialUnitPolicy");
const {
  normalizeReferralCode,
  ensureReferralCodeForOrganization,
  grantReferralRewardFromTransaction,
} = require("../services/referralService");
const {
  addWalletEntry,
  getWalletBalance,
  getWalletSummary,
  debitWalletUsageFromTransaction,
} = require("../services/walletService");
const {
  sendPasswordResetEmail,
  sendLoginEmailCode,
  sendSuperadminEmailChangeCode,
  sendSuperadminEmailChangedNotice,
} = require("../services/emailService");
const { sendBusinessLoginOtp } = require("../services/smsService");
const {
  notifyOrganization,
  notifySuperadmins,
  resolveNotifications,
} = require("../services/notificationService");
const { createPaymentIntent } = require("../services/paymentProviders");
const { checkPhonePeOrderStatus } = require("../services/phonePeService");
const {
  expireDueSubscriptions,
  isPastDate,
  isSubscriptionUsable,
  refreshSubscriptionStateForOrganization,
  getSubscriptionReadOnlyAccess,
} = require("../services/subscriptionLifecycle");
const { sendSubscriptionExpiryReminders } = require("../services/subscriptionReminderService");
const {
  createAuthRateLimit,
  requestIp,
  accountIdentifier,
  resetTokenIdentifier,
  challengeIdentifier,
} = require("../middleware/authRateLimit");

const router = express.Router();
const bootstrapIpLimit = createAuthRateLimit({ name: "bootstrap-ip", windowMs: 60 * 60 * 1000, max: 3, keyFromRequest: requestIp });
const registrationIpLimit = createAuthRateLimit({ name: "registration-ip", windowMs: 60 * 60 * 1000, max: 5, keyFromRequest: requestIp, countSuccessfulRequests: true });
const loginIpLimit = createAuthRateLimit({ name: "login-ip", windowMs: 15 * 60 * 1000, max: 10, keyFromRequest: requestIp });
const loginAccountLimit = createAuthRateLimit({ name: "login-account", windowMs: 15 * 60 * 1000, max: 5, keyFromRequest: accountIdentifier });
// Count failed code-send attempts only; a successful login request should not
// prevent the same user from signing in again after logging out.
const loginCodeSendIpLimit = createAuthRateLimit({ name: "login-code-send-fail-ip", windowMs: 15 * 60 * 1000, max: 5, keyFromRequest: requestIp });
const loginCodeSendAccountLimit = createAuthRateLimit({ name: "login-code-send-fail-account", windowMs: 60 * 60 * 1000, max: 5, keyFromRequest: accountIdentifier });
const loginCodeVerifyIpLimit = createAuthRateLimit({ name: "login-code-verify-ip", windowMs: 15 * 60 * 1000, max: 10, keyFromRequest: requestIp });
const loginCodeVerifyChallengeLimit = createAuthRateLimit({ name: "login-code-verify-challenge", windowMs: 15 * 60 * 1000, max: 5, keyFromRequest: challengeIdentifier });
const loginCodeResendIpLimit = createAuthRateLimit({ name: "login-code-resend-ip", windowMs: 15 * 60 * 1000, max: 5, keyFromRequest: requestIp, countSuccessfulRequests: true });
const loginCodeResendChallengeLimit = createAuthRateLimit({ name: "login-code-resend-challenge", windowMs: 15 * 60 * 1000, max: 2, keyFromRequest: challengeIdentifier, countSuccessfulRequests: true });
const phoneLoginRequestIpLimit = createAuthRateLimit({ name: "phone-login-request-ip", windowMs: 15 * 60 * 1000, max: 5, keyFromRequest: requestIp, countSuccessfulRequests: true });
const phoneLoginRequestPhoneLimit = createAuthRateLimit({ name: "phone-login-request-phone", windowMs: 60 * 60 * 1000, max: 5, keyFromRequest: (req) => normalizeBusinessPhone(req.body?.phone), countSuccessfulRequests: true });
const phoneLoginVerifyIpLimit = createAuthRateLimit({ name: "phone-login-verify-ip", windowMs: 15 * 60 * 1000, max: 20, keyFromRequest: requestIp });
const phoneLoginVerifyChallengeLimit = createAuthRateLimit({ name: "phone-login-verify-challenge", windowMs: 15 * 60 * 1000, max: 10, keyFromRequest: challengeIdentifier });
const phoneLoginResendIpLimit = createAuthRateLimit({ name: "phone-login-resend-ip", windowMs: 15 * 60 * 1000, max: 5, keyFromRequest: requestIp, countSuccessfulRequests: true });
const phoneLoginResendChallengeLimit = createAuthRateLimit({ name: "phone-login-resend-challenge", windowMs: 15 * 60 * 1000, max: 2, keyFromRequest: challengeIdentifier, countSuccessfulRequests: true });
const loginPinVerifyIpLimit = createAuthRateLimit({ name: "login-pin-verify-ip", windowMs: 15 * 60 * 1000, max: 10, keyFromRequest: requestIp });
const loginPinVerifyChallengeLimit = createAuthRateLimit({ name: "login-pin-verify-challenge", windowMs: 15 * 60 * 1000, max: 5, keyFromRequest: challengeIdentifier });
const emailChangeStartIpLimit = createAuthRateLimit({ name: "superadmin-email-change-start-ip", windowMs: 60 * 60 * 1000, max: 5, keyFromRequest: requestIp, countSuccessfulRequests: true });
const emailChangeStartAccountLimit = createAuthRateLimit({ name: "superadmin-email-change-start-account", windowMs: 60 * 60 * 1000, max: 3, keyFromRequest: (req) => String(req.systemUser?._id || ""), countSuccessfulRequests: true });
const emailChangeVerifyIpLimit = createAuthRateLimit({ name: "superadmin-email-change-verify-ip", windowMs: 15 * 60 * 1000, max: 10, keyFromRequest: requestIp });
const emailChangeVerifyChallengeLimit = createAuthRateLimit({ name: "superadmin-email-change-verify-challenge", windowMs: 15 * 60 * 1000, max: 5, keyFromRequest: challengeIdentifier });
const emailChangeResendIpLimit = createAuthRateLimit({ name: "superadmin-email-change-resend-ip", windowMs: 15 * 60 * 1000, max: 5, keyFromRequest: requestIp, countSuccessfulRequests: true });
const emailChangeResendChallengeLimit = createAuthRateLimit({ name: "superadmin-email-change-resend-challenge", windowMs: 15 * 60 * 1000, max: 2, keyFromRequest: challengeIdentifier, countSuccessfulRequests: true });
const recoveryIpLimit = createAuthRateLimit({ name: "recovery-ip", windowMs: 60 * 60 * 1000, max: 5, keyFromRequest: requestIp, countSuccessfulRequests: true });
const recoveryAccountLimit = createAuthRateLimit({ name: "recovery-account", windowMs: 60 * 60 * 1000, max: 2, keyFromRequest: accountIdentifier, countSuccessfulRequests: true });
const resetIpLimit = createAuthRateLimit({ name: "reset-ip", windowMs: 15 * 60 * 1000, max: 5, keyFromRequest: requestIp });
const resetTokenLimit = createAuthRateLimit({ name: "reset-token", windowMs: 15 * 60 * 1000, max: 3, keyFromRequest: resetTokenIdentifier });

function passRateLimits(req, res, limits) {
  for (const limit of limits) {
    let allowed = false;
    limit(req, res, () => { allowed = true; });
    if (!allowed) return false;
  }
  return true;
}

function userStatusForOrganization(status) {
  if (status === "active") return "active";
  if (status === "suspended") return "suspended";
  return "pending_payment";
}

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    loginId: user.loginId || "",
    email: String(user.email || "").endsWith("@phone-login.invalid") ? "" : user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    organizationId: user.organizationId ? String(user.organizationId) : null,
  };
}

async function verifySuperadminSecurityPin(req, res) {
  const pin = String(req.body?.securityPin || "").trim();
  if (!/^\d{4,8}$/.test(pin)) {
    res.status(400).json({ message: "Enter your 4 to 8 digit security PIN." });
    return false;
  }
  const user = await SystemUser.findById(req.systemUser._id).select("+securityPin");
  if (!user?.securityPin) {
    res.status(428).json({ message: "Set up your security PIN before performing this action." });
    return false;
  }
  if (!(await user.compareSecurityPin(pin))) {
    res.status(403).json({ message: "Incorrect security PIN." });
    return false;
  }
  return true;
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function hashLoginCode(challengeId, code) {
  return crypto
    .createHmac("sha256", getJwtSecret())
    .update(`${challengeId}:${code}`)
    .digest("hex");
}

function maskedEmail(email) {
  const [local = "", domain = ""] = String(email || "").split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function normalizeBusinessPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const phone = digits.startsWith("91") && digits.length === 12
    ? digits.slice(2)
    : digits.startsWith("0") && digits.length === 11
      ? digits.slice(1)
      : digits;
  return /^[6-9]\d{9}$/.test(phone) ? phone : "";
}

function businessPhoneVariants(phone) {
  return [phone, `+91${phone}`, `91${phone}`, `0${phone}`];
}

function maskedPhone(phone) {
  return `******${String(phone || "").slice(-4)}`;
}

function hashPhoneLoginCode(challengeId, code) {
  return crypto
    .createHmac("sha256", getJwtSecret())
    .update(`${challengeId}:${code}`)
    .digest("hex");
}

async function findUsersByPhone(phone) {
  return SystemUser.find({ phone: { $in: businessPhoneVariants(phone) } });
}

async function createPhoneTrialAccount(phone) {
  const now = new Date();
  const trialEndsAt = addDays(now, 15);
  const units = normalizeUnits({});
  const businessName = "New Business";
  const ownerName = "Owner";
  const internalEmail = `phone-${phone}@phone-login.invalid`;
  const organization = await Organization.create({
    name: businessName,
    slug: await uniqueSlug(`${businessName}-${phone}`),
    businessType: "mixed",
    ownerName,
    phone,
    unitAllocation: units,
    onboardingMode: "flexible",
    features: { canteenEnabled: false },
    status: "active",
    activatedAt: now,
  });

  let user;
  let subscription;
  try {
    user = await SystemUser.create({
      organizationId: organization._id,
      name: ownerName,
      email: internalEmail,
      phone,
      role: "system_admin",
      status: "active",
    });
    organization.createdBy = user._id;
    await organization.save();

    subscription = await Subscription.create({
      organizationId: organization._id,
      status: "active",
      startDate: now,
      endDate: trialEndsAt,
      durationMonths: 1,
      units,
      currency: "INR",
      amount: 0,
      pricing: { subtotal: 0, payableAmount: 0 },
    });

    await Promise.allSettled([
      notifySuperadmins({
        type: "registration",
        title: "New trial account registered",
        message: `A new phone-based trial account was created. Trial is active until ${trialEndsAt.toLocaleDateString("en-IN")}.`,
        actionUrl: `/superadmin/organization-detail?id=${organization._id}`,
        priority: "normal",
        entityType: "organization",
        entityId: organization._id,
        actionType: "registration",
        expiresAt: addDays(new Date(), 30),
        payload: {
          organizationId: String(organization._id),
          subscriptionId: String(subscription._id),
          trial: true,
          trialEndsAt,
        },
      }),
      notifyOrganization(organization._id, {
        type: "registration",
        title: "Trial account created",
        message: "Your 15-day trial is active. Select your property types to get started, then complete your business profile.",
        priority: "normal",
        entityType: "subscription",
        entityId: subscription._id,
        actionType: "trial_started",
        expiresAt: trialEndsAt,
        payload: {
          subscriptionId: String(subscription._id),
          trial: true,
          trialEndsAt,
        },
      }),
    ]);

    return { user, organization };
  } catch (error) {
    await Promise.all([
      subscription ? Subscription.deleteOne({ _id: subscription._id }) : Promise.resolve(),
      user ? SystemUser.deleteOne({ _id: user._id }) : Promise.resolve(),
      Organization.deleteOne({ _id: organization._id }),
    ]);
    throw error;
  }
}

async function deliverSuperadminLoginCode(user, code) {
  try {
    await sendLoginEmailCode({ to: user.email, name: user.name, code, expiresMinutes: 10 });
    return true;
  } catch (error) {
    if (error?.code !== "SMTP_NOT_CONFIGURED") {
      console.error("login code email delivery failed:", error?.message || error);
    }
    return false;
  }
}

async function startEmailLoginChallenge(req, res) {
  const login = String(req.body?.email || req.body?.loginId || "").trim().toLowerCase();
  if (!login) {
    return res.status(400).json({ message: "Email is required." });
  }

  const user = await SystemUser.findOne({
    $or: [{ email: login }, { loginId: login }],
  });
  if (!user) return res.status(400).json({ message: "No account was found for this email." });
  if (user.role === "system_admin") {
    return res.status(410).json({ message: "Business accounts now sign in with a mobile OTP." });
  }
  if (user.status === "suspended") return res.status(403).json({ message: "Account suspended" });

  if (!passRateLimits(req, res, [loginCodeSendIpLimit, loginCodeSendAccountLimit])) return null;

  await LoginEmailChallenge.updateMany(
    { userId: user._id, usedAt: null },
    { $set: { usedAt: new Date() } }
  );

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const challengeId = new mongoose.Types.ObjectId();
  const challenge = await LoginEmailChallenge.create({
    _id: challengeId,
    userId: user._id,
    sessionVersion: Number(user.sessionVersion || 0),
    clientPlatform: String(req.get("X-Platform") || "web").toLowerCase() === "mobile" ? "mobile" : "web",
    codeHash: hashLoginCode(challengeId, code),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const delivered = await deliverSuperadminLoginCode(user, code);
  if (!delivered) {
    return res.status(503).json({ message: "Unable to send the verification code. Check the server email settings or contact support." });
  }

  return res.json({
    requiresEmailCode: true,
    challengeId: String(challenge._id),
    email: maskedEmail(user.email),
    expiresInMinutes: 10,
  });
}

async function sendPhoneLoginCode(phone, challengeId) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const id = challengeId || new mongoose.Types.ObjectId();
  const now = new Date();
  const challenge = await BusinessPhoneLoginChallenge.create({
    _id: id,
    phone,
    codeHash: hashPhoneLoginCode(id, code),
    codeExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    resendAvailableAt: new Date(now.getTime() + 5 * 60 * 1000),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });
  return { challenge, code };
}

function publicResetUrl(req, token) {
  const configured = String(process.env.PASSWORD_RESET_URL || "").trim();
  if (configured) {
    const url = new URL(configured);
    url.searchParams.set("token", token);
    return url.toString();
  }

  const origin = req.get("X-Origin") || req.get("Origin") || `${req.protocol}://${req.get("host")}`;
  const url = new URL("/reset-password", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

async function completeLoginFromChallenge(challenge, user, res) {
  const now = new Date();
  const consumed = await LoginEmailChallenge.findOneAndUpdate(
    { _id: challenge._id, userId: user._id, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: true }
  );
  if (!consumed) return res.status(400).json({ message: "Sign-in request expired. Please start again." });

  user.lastLoginAt = now;
  if (consumed.clientPlatform !== "mobile") user.lastWebActivityAt = now;
  await user.save();
  return res.json({ token: signSystemToken(user, consumed.clientPlatform), user: publicUser(user), organization: null });
}

async function uniqueSlug(name) {
  const base = slugify(name) || `org-${Date.now()}`;
  let candidate = base;
  let counter = 1;

  while (await Organization.exists({ slug: candidate })) {
    counter += 1;
    candidate = `${base}-${counter}`;
  }

  return candidate;
}

async function uniquePlanCode(name) {
  const base = slugify(name) || `plan-${Date.now()}`;
  let candidate = base;
  let counter = 1;

  while (await SubscriptionPlan.exists({ code: candidate })) {
    counter += 1;
    candidate = `${base}-${counter}`;
  }

  return candidate;
}

function getDurationMonths(body) {
  const durationMonths = Number(body?.durationMonths || 0);
  if (durationMonths > 0) return durationMonths;
  const years = Number(body?.planYears || body?.durationYears || 1);
  return Math.max(1, years) * 12;
}

function renewalStartDate(subscription, requestedStartDate) {
  if (requestedStartDate) return new Date(requestedStartDate);
  const now = new Date();
  if (subscription?.endDate && subscription.status === "active" && !isPastDate(subscription.endDate, now)) {
    return new Date(subscription.endDate);
  }
  return now;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addUnits(currentUnits, addedUnits) {
  return {
    beds: Number(currentUnits?.beds || 0) + Number(addedUnits?.beds || 0),
    rooms: Number(currentUnits?.rooms || 0) + Number(addedUnits?.rooms || 0),
    shops: Number(currentUnits?.shops || 0) + Number(addedUnits?.shops || 0),
  };
}

function hasAnyUnit(units) {
  return Number(units?.beds || 0) > 0 || Number(units?.rooms || 0) > 0 || Number(units?.shops || 0) > 0;
}

function needsUnitSetupFor(subscription, organization) {
  if (organization?.onboardingMode === "flexible") return false;
  const units = normalizeUnits(subscription?.units || organization?.unitAllocation || {});
  return !hasAnyUnit(units);
}

function publicReferralCode(referral) {
  if (!referral) return null;
  return {
    id: String(referral._id),
    code: referral.code,
    title: referral.title,
    discountPercent: referral.discountPercent,
    rewardCoins: referral.rewardCoins,
    earnedCoins: referral.earnedCoins,
    source: referral.source,
    ownerOrganizationId: referral.ownerOrganizationId ? String(referral.ownerOrganizationId) : null,
    maxUses: referral.maxUses,
    usedCount: referral.usedCount,
    validFrom: referral.validFrom,
    validUntil: referral.validUntil,
    isActive: referral.isActive,
    notes: referral.notes,
  };
}

function referralUnavailableMessage(referral, now = new Date()) {
  if (!referral) return "Referral code not found";
  if (!referral.isActive) return "Referral code is inactive";
  if (referral.validFrom && new Date(referral.validFrom) > now) return "Referral code is not active yet";
  if (referral.validUntil && new Date(referral.validUntil) < now) return "Referral code has expired";
  if (Number(referral.maxUses || 0) > 0 && Number(referral.usedCount || 0) >= Number(referral.maxUses || 0)) {
    return "Referral code usage limit reached";
  }
  return "";
}

async function getUsableReferralCode(code, options = {}) {
  const normalizedCode = normalizeReferralCode(code);
  if (!normalizedCode) return null;
  const referral = await ReferralCode.findOne({ code: normalizedCode });
  const unavailable = referralUnavailableMessage(referral);
  if (unavailable) {
    const error = new Error(unavailable);
    error.statusCode = unavailable === "Referral code not found" ? 404 : 400;
    throw error;
  }
  if (options.excludeOwnerOrganizationId && String(referral.ownerOrganizationId || "") === String(options.excludeOwnerOrganizationId)) {
    const error = new Error("You cannot use your own referral code");
    error.statusCode = 400;
    throw error;
  }
  return referral;
}

function businessTypeFromUnits(units) {
  const activeTypes = [
    Number(units?.beds || 0) > 0 ? "hostel" : null,
    Number(units?.rooms || 0) > 0 ? "rooms" : null,
    Number(units?.shops || 0) > 0 ? "shops" : null,
  ].filter(Boolean);
  return activeTypes.length === 1 ? activeTypes[0] : "mixed";
}

async function applyWalletPricing(organizationId, amount, enabled) {
  const originalAmount = Math.max(0, Math.round(Number(amount || 0)));
  if (!enabled) {
    return {
      walletCoinsUsed: 0,
      walletDiscountAmount: 0,
      walletDebitGranted: false,
      payableAmount: originalAmount,
    };
  }
  const balance = await getWalletBalance(organizationId);
  const walletCoinsUsed = Math.min(Number(balance || 0), originalAmount);
  return {
    walletCoinsUsed,
    walletDiscountAmount: walletCoinsUsed,
    walletDebitGranted: false,
    payableAmount: Math.max(0, originalAmount - walletCoinsUsed),
  };
}

async function isFirstPaidPendingCheckout(subscription) {
  if (!subscription || subscription.status !== "pending_payment" ||
      (Number(subscription.amount || 0) <= 0 && Number(subscription.pricing?.subtotal || 0) <= 0)) return false;
  const earlierPaidPlan = await Subscription.exists({
    organizationId: subscription.organizationId,
    _id: { $ne: subscription._id },
    planId: { $ne: null },
    status: { $in: ["active", "expired", "cancelled"] },
    createdAt: { $lt: subscription.createdAt },
  });
  return !earlierPaidPlan;
}

async function ensurePendingPaymentCanBeRepriced(subscription) {
  const transactions = await BillingTransaction.find({ subscriptionId: subscription._id });
  if (transactions.some((transaction) => transaction.status === "success")) {
    const error = new Error("This payment has already succeeded. Refresh the page to see your active plan.");
    error.statusCode = 409;
    throw error;
  }
  for (const transaction of transactions.filter((item) => ["created", "pending"].includes(item.status))) {
    const creatingAt = transaction.requestPayload?.intentCreatingAt;
    const gatewayWindowMs = (Number(process.env.PHONEPE_EXPIRE_AFTER_SECONDS || 1200) + 60) * 1000;
    if (creatingAt && Date.now() - new Date(creatingAt).getTime() < gatewayWindowMs) {
      const error = new Error("The previous payment is still being created. Please retry after it expires.");
      error.statusCode = 409;
      throw error;
    }
    const orderId = transaction.responsePayload?.merchantOrderId || transaction.responsePayload?.merchantTransactionId;
    if (orderId && transaction.responsePayload?.provider === "phonepe") {
      let status;
      try {
        status = await checkPhonePeOrderStatus(orderId);
      } catch (_error) {
        const error = new Error("Could not verify the previous payment yet. Please try again shortly.");
        error.statusCode = 503;
        throw error;
      }
      if (["failed", "cancelled"].includes(status.status)) {
        transaction.status = status.status;
        transaction.callbackPayload = { ...(transaction.callbackPayload || {}), repriceStatusPoll: status, polledAt: new Date() };
        await transaction.save();
        continue;
      }
      const error = new Error(status.status === "success"
        ? "The previous payment succeeded. Refresh the page to see your active plan."
        : "The previous payment is still processing. You can change the referral code or wallet choice after it fails or expires.");
      error.statusCode = 409;
      throw error;
    }
  }
  return transactions;
}

function calculateUpgradeAmount(plan, addedUnits, subscription, now = new Date()) {
  const pricing = plan?.unitPricing || {};
  const endDate = subscription?.endDate ? new Date(subscription.endDate) : null;
  const remainingDays = endDate && !Number.isNaN(endDate.getTime())
    ? Math.max(1, Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    : 30;
  const remainingMonthFactor = remainingDays / 30;
  const monthlyAmount =
    Number(addedUnits.beds || 0) * Number(pricing.bedMonthly || 0) +
    Number(addedUnits.rooms || 0) * Number(pricing.roomMonthly || 0) +
    Number(addedUnits.shops || 0) * Number(pricing.shopMonthly || 0);
  const subtotal = Math.ceil(monthlyAmount * remainingMonthFactor);

  return {
    amount: applyDiscount(subtotal, plan?.discountPercent),
    discountPercent: normalizeDiscountPercent(plan?.discountPercent),
    subtotal,
    remainingDays,
    remainingMonthFactor,
    monthlyAmount,
  };
}

async function findUpgradePricingPlan(subscription) {
  if (subscription?.planId?._id) {
    const plan = await SubscriptionPlan.findOne({
      _id: subscription.planId._id,
      isActive: true,
    });
    if (plan) return plan;
  }

  if (subscription?.durationMonths) {
    const plan = await SubscriptionPlan.findOne({
      durationMonths: subscription.durationMonths,
      isActive: true,
    }).sort({ createdAt: -1 });
    if (plan) return plan;
  }

  return SubscriptionPlan.findOne({ isActive: true }).sort({
    durationMonths: 1,
    baseAmount: 1,
    createdAt: -1,
  });
}

function isTrialSubscription(subscription) {
  return (
    Number(subscription?.amount || 0) === 0 &&
    !subscription?.planId &&
    subscription?.status === "active"
  );
}

async function resolveSubscriptionNotifications(subscription, organizationId) {
  if (!subscription?._id) return;
  const orgId = organizationId || subscription.organizationId;
  await Promise.allSettled([
    resolveNotifications({
      organizationId: orgId,
      entityType: "subscription",
      entityId: subscription._id,
      actionType: "subscription_expiry",
    }),
    resolveNotifications({
      organizationId: orgId,
      entityType: "subscription",
      entityId: subscription._id,
      actionType: "subscription_payment_required",
    }),
    resolveNotifications({
      organizationId: orgId,
      entityType: "subscription",
      entityId: subscription._id,
      actionType: "renewal_payment_required",
    }),
  ]);
}

const MIGRATION_MODELS = {
  rooms: Room,
  forms: Form,
  commercialUnits: CommercialUnit,
  payments: Payment,
  paymentNotifications: PaymentNotification,
  invoices: Invoice,
  otherExpenses: OtherExpense,
  lightBills: LightBillEntry,
  staffExpenses: StaffExpense,
  leaveRequests: LeaveRequest,
  leaveNotifications: LeaveNotification,
  attendance: Attendance,
  notifications: Notification,
  archives: Archive,
  duplicateForms: DuplicateForm,
};

function unassignedOrganizationQuery() {
  return {
    $or: [
      { organizationId: { $exists: false } },
      { organizationId: null },
      { organizationId: "" },
    ],
  };
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, module: "saas" });
});

router.post("/auth/session/activity", requireSystemAuth, (_req, res) => {
  res.status(204).end();
});

router.post("/superadmin/bootstrap", bootstrapIpLimit, async (req, res) => {
  try {
    const existing = await SystemUser.exists({ role: "superadmin" });
    if (existing) {
      return res.status(409).json({ message: "Superadmin already exists" });
    }

    const setupSecret = process.env.SAAS_SETUP_SECRET;
    if (process.env.NODE_ENV === "production" && !setupSecret) {
      return res.status(503).json({ message: "Superadmin bootstrap is not configured." });
    }
    if (process.env.NODE_ENV === "production" && Buffer.byteLength(setupSecret, "utf8") < 32) {
      return res.status(503).json({ message: "SAAS_SETUP_SECRET must be at least 32 bytes." });
    }
    if (setupSecret && req.body?.setupSecret !== setupSecret) {
      return res.status(403).json({ message: "Invalid setup secret" });
    }

    const name = String(req.body?.name || process.env.SUPERADMIN_NAME || "Super Admin").trim();
    const email = String(req.body?.email || process.env.SUPERADMIN_EMAIL || "").trim().toLowerCase();
    const password = String(req.body?.password || process.env.SUPERADMIN_PASSWORD || "");

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const user = await SystemUser.create({
      name,
      email,
      password,
      role: "superadmin",
      status: "active",
      lastLoginAt: new Date(),
      lastWebActivityAt: req.get("X-Platform") === "mobile" ? null : new Date(),
    });

    res.status(201).json({ user: publicUser(user), token: signSystemToken(user, req.get("X-Platform")) });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Email already exists" });
    }
    console.error("bootstrap superadmin error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/login", loginIpLimit, loginAccountLimit, async (req, res) => {
  try {
    const login = String(req.body?.email || req.body?.loginId || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!login || !password) {
      return res.status(400).json({ message: "login id and password are required" });
    }

    const user = await SystemUser.findOne({
      $or: [{ email: login }, { loginId: login }],
    }).select("+password");
    if (!user) return res.status(400).json({ message: "Invalid credentials" });
    if (user.role === "system_admin") {
      return res.status(410).json({ message: "Business accounts now sign in with a mobile OTP." });
    }

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(400).json({ message: "Invalid credentials" });
    if (user.status === "suspended") {
      return res.status(403).json({ message: "Account suspended" });
    }

    if (user.role === "superadmin") {
      if (!passRateLimits(req, res, [loginCodeSendIpLimit, loginCodeSendAccountLimit])) return;

      await LoginEmailChallenge.updateMany(
        { userId: user._id, usedAt: null },
        { $set: { usedAt: new Date() } }
      );

      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const challengeId = new mongoose.Types.ObjectId();
      const challenge = await LoginEmailChallenge.create({
        _id: challengeId,
        userId: user._id,
        sessionVersion: Number(user.sessionVersion || 0),
        clientPlatform: String(req.get("X-Platform") || "web").toLowerCase() === "mobile" ? "mobile" : "web",
        codeHash: hashLoginCode(challengeId, code),
        expiresAt,
      });

      const delivered = await deliverSuperadminLoginCode(user, code);
      if (!delivered) {
        return res.status(503).json({ message: "Unable to send the verification code. Check the server email settings or contact support." });
      }

      return res.json({
        requiresEmailCode: true,
        challengeId: String(challenge._id),
        email: maskedEmail(user.email),
        expiresInMinutes: 10,
      });
    }

    user.lastLoginAt = new Date();
    if (String(req.get("X-Platform") || "web").toLowerCase() !== "mobile") {
      user.lastWebActivityAt = user.lastLoginAt;
    }
    await user.save();

    let organization = user.organizationId
      ? await Organization.findById(user.organizationId).lean()
      : null;
    if (organization) {
      const orgDoc = await Organization.findById(organization._id);
      const lifecycle = await refreshSubscriptionStateForOrganization(orgDoc);
      organization = lifecycle.organization.toObject ? lifecycle.organization.toObject() : lifecycle.organization;
    }

    res.json({
      token: signSystemToken(user, req.get("X-Platform")),
      user: publicUser(user),
      organization,
    });
  } catch (err) {
    console.error("system login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/login/request-email-code", loginIpLimit, loginAccountLimit, async (req, res) => {
  try {
    return await startEmailLoginChallenge(req, res);
  } catch (err) {
    console.error("email login request error:", err?.message || err);
    return res.status(500).json({ message: "Unable to send the verification code. Please try again." });
  }
});

router.post("/auth/login/request-phone-code", phoneLoginRequestIpLimit, phoneLoginRequestPhoneLimit, async (req, res) => {
  try {
    const phone = normalizeBusinessPhone(req.body?.phone);
    if (!phone) return res.status(400).json({ message: "Enter a valid 10-digit mobile number." });
    if (!passRateLimits(req, res, [loginCodeSendIpLimit])) return;

    const matchingUsers = await findUsersByPhone(phone);
    if (matchingUsers.some((user) => user.role === "superadmin")) {
      return res.status(400).json({ message: "Use the superadmin email sign-in option." });
    }
    if (matchingUsers.filter((user) => user.role === "system_admin").length > 1) {
      return res.status(409).json({ message: "This mobile number is linked to multiple accounts. Contact support." });
    }

    const now = new Date();
    const activeChallenge = await BusinessPhoneLoginChallenge.findOne({
      phone,
      usedAt: null,
      expiresAt: { $gt: now },
    }).sort({ createdAt: -1 });
    if (activeChallenge) {
      const resendAvailableAt = activeChallenge.resendAvailableAt || activeChallenge.codeExpiresAt || activeChallenge.expiresAt;
      if (resendAvailableAt > now) {
        const retryAfterSeconds = Math.ceil((resendAvailableAt.getTime() - now.getTime()) / 1000);
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          message: "Please wait until the 5-minute OTP timer ends before requesting another code.",
          resendAvailableAt,
        });
      }
    }

    await BusinessPhoneLoginChallenge.updateMany(
      { phone, usedAt: null },
      { $set: { usedAt: now } }
    );
    const { challenge, code } = await sendPhoneLoginCode(phone);
    let delivery;
    try {
      delivery = await sendBusinessLoginOtp({ to: phone, code });
    } catch (error) {
      await BusinessPhoneLoginChallenge.updateOne(
        { _id: challenge._id, usedAt: null },
        { $set: { usedAt: new Date() } }
      );
      console.error("business login SMS delivery failed:", error?.message || error);
      return res.status(503).json({ message: "Unable to send the OTP. Check the SMS provider configuration and try again." });
    }
    if (!delivery?.sent) {
      await BusinessPhoneLoginChallenge.updateOne(
        { _id: challenge._id, usedAt: null },
        { $set: { usedAt: new Date() } }
      );
      return res.status(503).json({ message: "SMS delivery is not configured. Please contact support." });
    }

    return res.json({
      challengeId: String(challenge._id),
      phone: maskedPhone(phone),
      expiresInMinutes: 5,
      resendAvailableAt: challenge.resendAvailableAt,
    });
  } catch (error) {
    console.error("phone login request error:", error?.message || error);
    return res.status(500).json({ message: "Unable to send the OTP. Please try again." });
  }
});

router.post("/auth/login/verify-phone-code", phoneLoginVerifyIpLimit, phoneLoginVerifyChallengeLimit, async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || "").trim();
    const code = String(req.body?.code || "").trim();
    if (!mongoose.Types.ObjectId.isValid(challengeId) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: "The OTP is invalid or expired. Request a new code and try again." });
    }

    const challenge = await BusinessPhoneLoginChallenge.findOne({
      _id: challengeId,
      usedAt: null,
      attempts: { $lt: 3 },
      $or: [
        { codeExpiresAt: { $gt: new Date() } },
        { codeExpiresAt: null, expiresAt: { $gt: new Date() } },
      ],
    });
    if (!challenge) {
      const exhaustedChallenge = await BusinessPhoneLoginChallenge.findOne({
        _id: challengeId,
        usedAt: null,
        attempts: { $gte: 3 },
      }).select("resendAvailableAt codeExpiresAt expiresAt");
      if (exhaustedChallenge) {
        return res.status(429).json({ message: "Too many incorrect OTP attempts. You can request a new code when the 5-minute timer ends." });
      }
      return res.status(400).json({ message: "The OTP is invalid or expired. Request a new code and try again." });
    }

    const expectedHash = hashPhoneLoginCode(challenge._id, code);
    const matches = crypto.timingSafeEqual(
      Buffer.from(challenge.codeHash, "hex"),
      Buffer.from(expectedHash, "hex")
    );
    if (!matches) {
      const updatedChallenge = await BusinessPhoneLoginChallenge.findOneAndUpdate(
        { _id: challenge._id, codeHash: challenge.codeHash, usedAt: null, attempts: { $lt: 3 } },
        { $inc: { attempts: 1 } },
        { new: true }
      );
      return res.status(updatedChallenge?.attempts >= 3 ? 429 : 400).json({
        message: updatedChallenge?.attempts >= 3
          ? "Too many incorrect OTP attempts. You can request a new code when the 5-minute timer ends."
          : "The OTP is incorrect. Check the code and try again.",
      });
    }

    const consumed = await BusinessPhoneLoginChallenge.findOneAndUpdate(
      {
        _id: challenge._id,
        codeHash: expectedHash,
        usedAt: null,
        attempts: { $lt: 3 },
        $or: [
          { codeExpiresAt: { $gt: new Date() } },
          { codeExpiresAt: null, expiresAt: { $gt: new Date() } },
        ],
      },
      { $set: { usedAt: new Date() }, $inc: { attempts: 1 } },
      { new: true }
    );
    if (!consumed) return res.status(400).json({ message: "Sign-in request expired. Please start again." });

    const matchingUsers = await findUsersByPhone(consumed.phone);
    if (matchingUsers.some((user) => user.role === "superadmin")) {
      return res.status(403).json({ message: "Use the superadmin email sign-in option." });
    }
    const businessUsers = matchingUsers.filter((user) => user.role === "system_admin");
    if (businessUsers.length > 1) {
      return res.status(409).json({ message: "This mobile number is linked to multiple accounts. Contact support." });
    }

    let user = businessUsers[0];
    let organization;
    if (user?.status === "suspended") return res.status(403).json({ message: "Account suspended." });
    if (!user) {
      const created = await createPhoneTrialAccount(consumed.phone);
      user = created.user;
      organization = created.organization;
    } else {
      organization = user.organizationId
        ? await Organization.findById(user.organizationId)
        : null;
      if (!organization) return res.status(403).json({ message: "Organization account not found. Contact support." });
    }

    const now = new Date();
    user.lastLoginAt = now;
    if (String(req.get("X-Platform") || "web").toLowerCase() !== "mobile") user.lastWebActivityAt = now;
    await user.save();

    return res.json({
      token: signSystemToken(user, req.get("X-Platform")),
      user: publicUser(user),
      organization,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "This mobile number already has an account. Please request a fresh OTP." });
    }
    console.error("phone login verification error:", error?.message || error);
    return res.status(500).json({ message: "Unable to verify the OTP. Please try again." });
  }
});

router.post("/auth/login/resend-phone-code", phoneLoginResendIpLimit, phoneLoginResendChallengeLimit, async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(challengeId)) {
      return res.status(400).json({ message: "Sign-in request expired. Start again." });
    }
    const challenge = await BusinessPhoneLoginChallenge.findOne({
      _id: challengeId,
      usedAt: null,
      expiresAt: { $gt: new Date() },
      resendCount: { $lt: 2 },
    });
    if (!challenge) return res.status(400).json({ message: "Sign-in request expired. Start again." });
    const now = new Date();
    const resendAvailableAt = challenge.resendAvailableAt || challenge.codeExpiresAt || challenge.expiresAt;
    if (resendAvailableAt > now) {
      const retryAfterSeconds = Math.ceil((resendAvailableAt.getTime() - now.getTime()) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        message: "Please wait until the 5-minute OTP timer ends before requesting another code.",
        resendAvailableAt,
      });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    challenge.codeHash = hashPhoneLoginCode(challenge._id, code);
    challenge.codeExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    challenge.resendAvailableAt = new Date(now.getTime() + 5 * 60 * 1000);
    challenge.attempts = 0;
    challenge.resendCount += 1;
    await challenge.save();
    let delivery;
    try {
      delivery = await sendBusinessLoginOtp({ to: challenge.phone, code });
    } catch (error) {
      challenge.usedAt = new Date();
      await challenge.save();
      console.error("business login SMS resend failed:", error?.message || error);
      return res.status(503).json({ message: "Unable to send the OTP. Check the SMS provider configuration and try again." });
    }
    if (!delivery?.sent) {
      challenge.usedAt = new Date();
      await challenge.save();
      return res.status(503).json({ message: "Unable to send the OTP. Check the SMS provider configuration and try again." });
    }
    return res.json({
      phone: maskedPhone(challenge.phone),
      expiresInMinutes: 5,
      resendAvailableAt: challenge.resendAvailableAt,
    });
  } catch (error) {
    console.error("phone login resend error:", error?.message || error);
    return res.status(500).json({ message: "Unable to resend the OTP. Please try again." });
  }
});

router.post("/auth/login/verify-email", loginCodeVerifyIpLimit, loginCodeVerifyChallengeLimit, async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || "").trim();
    const code = String(req.body?.code || "").trim();
    if (!mongoose.Types.ObjectId.isValid(challengeId) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: "The code is invalid or expired. Request a new code and try again." });
    }

    const now = new Date();
    const challenge = await LoginEmailChallenge.findOne({
      _id: challengeId,
      usedAt: null,
      emailVerifiedAt: null,
      expiresAt: { $gt: now },
      attempts: { $lt: 5 },
    });
    if (!challenge) {
      return res.status(400).json({ message: "The code is invalid or expired. Request a new code and try again." });
    }

    const expectedHash = hashLoginCode(challenge._id, code);
    const matches = crypto.timingSafeEqual(
      Buffer.from(challenge.codeHash, "hex"),
      Buffer.from(expectedHash, "hex")
    );
    if (!matches) {
      await LoginEmailChallenge.updateOne(
        { _id: challenge._id, usedAt: null, expiresAt: { $gt: now }, attempts: { $lt: 5 } },
        { $inc: { attempts: 1 } }
      );
      return res.status(400).json({ message: "The code is incorrect or expired." });
    }

    const verifiedChallenge = await LoginEmailChallenge.findOneAndUpdate(
      {
        _id: challenge._id,
        codeHash: expectedHash,
        usedAt: null,
        expiresAt: { $gt: now },
        attempts: { $lt: 5 },
      },
      { $set: { emailVerifiedAt: now }, $inc: { attempts: 1 } },
      { new: true }
    );
    if (!verifiedChallenge) {
      return res.status(400).json({ message: "The code is invalid or expired. Request a new code and try again." });
    }

    const user = await SystemUser.findById(verifiedChallenge.userId).select("+securityPin");
    if (!user) {
      return res.status(400).json({ message: "Unable to complete sign-in. Please start again." });
    }
    if (Number(user.sessionVersion || 0) !== Number(verifiedChallenge.sessionVersion)) {
      return res.status(400).json({ message: "Your account changed during sign-in. Please start again." });
    }
    if (user.status === "suspended") {
      return res.status(403).json({ message: "Account suspended" });
    }

    if (user.role === "superadmin") {
      return res.json({
        requiresSecurityPin: Boolean(user.securityPin),
        requiresSecurityPinSetup: !user.securityPin,
        challengeId: String(verifiedChallenge._id),
      });
    }
    return completeLoginFromChallenge(verifiedChallenge, user, res);
  } catch (err) {
    console.error("email login verification error:", err?.message || err);
    res.status(500).json({ message: "Unable to verify the code. Please try again." });
  }
});

router.post("/auth/login/verify-security-pin", loginPinVerifyIpLimit, loginPinVerifyChallengeLimit, async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || "").trim();
    const pin = String(req.body?.pin || "").trim();
    if (!mongoose.Types.ObjectId.isValid(challengeId) || !/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ message: "Enter a valid security PIN." });
    }
    const now = new Date();
    const challenge = await LoginEmailChallenge.findOne({ _id: challengeId, usedAt: null, emailVerifiedAt: { $ne: null }, expiresAt: { $gt: now } });
    if (!challenge) return res.status(400).json({ message: "Sign-in request expired. Please start again." });
    const user = await SystemUser.findById(challenge.userId).select("+securityPin");
    if (!user || user.role !== "superadmin" || user.status === "suspended" || Number(user.sessionVersion || 0) !== Number(challenge.sessionVersion)) {
      return res.status(400).json({ message: "Sign-in request expired. Please start again." });
    }
    if (!user.securityPin) return res.status(428).json({ message: "Set up your security PIN to finish signing in." });
    if (user.securityPinLockedUntil && user.securityPinLockedUntil > now) {
      return res.status(429).json({ message: "Security PIN is temporarily locked. Try again in 15 minutes." });
    }
    if (!(await user.compareSecurityPin(pin))) {
      const attempts = Number(user.securityPinLoginAttempts || 0) + 1;
      user.securityPinLoginAttempts = attempts >= 5 ? 0 : attempts;
      user.securityPinLockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await user.save();
      return res.status(attempts >= 5 ? 429 : 400).json({ message: attempts >= 5 ? "Too many incorrect PIN attempts. Try again in 15 minutes." : "Incorrect security PIN." });
    }
    user.securityPinLoginAttempts = 0;
    user.securityPinLockedUntil = null;
    return completeLoginFromChallenge(challenge, user, res);
  } catch (err) {
    console.error("security PIN login verification error:", err?.message || err);
    return res.status(500).json({ message: "Unable to verify the security PIN. Please try again." });
  }
});

router.post("/auth/login/setup-security-pin", loginPinVerifyIpLimit, loginPinVerifyChallengeLimit, async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || "").trim();
    const pin = String(req.body?.pin || "").trim();
    if (!mongoose.Types.ObjectId.isValid(challengeId) || !/^\d{4,8}$/.test(pin)) return res.status(400).json({ message: "PIN must contain 4 to 8 digits." });
    const now = new Date();
    const challenge = await LoginEmailChallenge.findOne({ _id: challengeId, usedAt: null, emailVerifiedAt: { $ne: null }, expiresAt: { $gt: now } });
    if (!challenge) return res.status(400).json({ message: "Sign-in request expired. Please start again." });
    const user = await SystemUser.findById(challenge.userId).select("+securityPin");
    if (!user || user.role !== "superadmin" || user.securityPin) return res.status(400).json({ message: "Security PIN setup is no longer available. Please sign in again." });
    user.securityPin = await bcrypt.hash(pin, 10);
    user.securityPinLoginAttempts = 0;
    user.securityPinLockedUntil = null;
    return completeLoginFromChallenge(challenge, user, res);
  } catch (err) {
    console.error("security PIN login setup error:", err?.message || err);
    return res.status(500).json({ message: "Unable to set the security PIN. Please try again." });
  }
});

router.post("/auth/login/reset-security-pin", loginPinVerifyIpLimit, loginPinVerifyChallengeLimit, async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || "").trim();
    const pin = String(req.body?.pin || "").trim();
    if (!mongoose.Types.ObjectId.isValid(challengeId) || !/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ message: "PIN must contain 4 to 8 digits." });
    }
    const now = new Date();
    const challenge = await LoginEmailChallenge.findOne({
      _id: challengeId,
      usedAt: null,
      emailVerifiedAt: { $ne: null },
      expiresAt: { $gt: now },
    });
    if (!challenge) return res.status(400).json({ message: "Sign-in request expired. Please start again." });
    const user = await SystemUser.findById(challenge.userId).select("+securityPin");
    if (!user || user.role !== "superadmin" || user.status === "suspended" || Number(user.sessionVersion || 0) !== Number(challenge.sessionVersion)) {
      return res.status(400).json({ message: "Sign-in request expired. Please start again." });
    }
    user.securityPin = await bcrypt.hash(pin, 10);
    user.securityPinLoginAttempts = 0;
    user.securityPinLockedUntil = null;
    return completeLoginFromChallenge(challenge, user, res);
  } catch (err) {
    console.error("security PIN login reset error:", err?.message || err);
    return res.status(500).json({ message: "Unable to reset the security PIN. Please try again." });
  }
});

router.post("/auth/login/resend-email-code", loginCodeResendIpLimit, loginCodeResendChallengeLimit, async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(challengeId)) {
      return res.status(400).json({ message: "Sign-in challenge is invalid or expired. Please sign in again." });
    }

    const challenge = await LoginEmailChallenge.findOne({
      _id: challengeId,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!challenge) {
      return res.status(400).json({ message: "Sign-in challenge is invalid or expired. Please sign in again." });
    }

    const user = await SystemUser.findById(challenge.userId);
    if (!user || user.status === "suspended") {
      return res.status(400).json({ message: "Sign-in challenge is invalid or expired. Please sign in again." });
    }
    if (Number(user.sessionVersion || 0) !== Number(challenge.sessionVersion)) {
      await LoginEmailChallenge.updateOne({ _id: challenge._id }, { $set: { usedAt: new Date() } });
      return res.status(400).json({ message: "Your account changed during sign-in. Please sign in again." });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const now = new Date();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const previousChallengeState = {
      codeHash: challenge.codeHash,
      expiresAt: challenge.expiresAt,
      attempts: challenge.attempts,
      emailVerifiedAt: challenge.emailVerifiedAt,
    };
    const nextCodeHash = hashLoginCode(challenge._id, code);
    const updatedChallenge = await LoginEmailChallenge.findOneAndUpdate(
      { _id: challenge._id, usedAt: null, expiresAt: { $gt: now }, resendCount: { $lt: 2 } },
      { $set: { codeHash: nextCodeHash, expiresAt, attempts: 0, emailVerifiedAt: null }, $inc: { resendCount: 1 } },
      { new: true }
    );
    if (!updatedChallenge) {
      return res.status(429).json({ message: "Code resend limit reached. Please sign in again later." });
    }

    const delivered = await deliverSuperadminLoginCode(user, code);
    if (!delivered) {
      await LoginEmailChallenge.updateOne(
        { _id: challenge._id, codeHash: nextCodeHash, resendCount: updatedChallenge.resendCount },
        { $set: previousChallengeState, $inc: { resendCount: -1 } }
      );
      return res.status(503).json({ message: "Unable to send the verification code. Check the server email settings or contact support." });
    }

    res.json({ email: maskedEmail(user.email), expiresInMinutes: 10 });
  } catch (err) {
    console.error("superadmin email code resend error:", err?.message || err);
    res.status(500).json({ message: "Unable to resend the code. Please try again." });
  }
});

router.post(
  "/admin/security/email-change/request",
  requireSystemAuth,
  requireRole("superadmin"),
  emailChangeStartIpLimit,
  emailChangeStartAccountLimit,
  async (req, res) => {
    try {
      const password = String(req.body?.password || "");
      const newEmail = String(req.body?.newEmail || "").trim().toLowerCase();
      if (!password || !(await req.systemUser.comparePassword(password))) {
        return res.status(403).json({ message: "Current password is incorrect." });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 254) {
        return res.status(400).json({ message: "Enter a valid new email address." });
      }
      if (newEmail === req.systemUser.email) {
        return res.status(400).json({ message: "This is already your current email address." });
      }
      if (await SystemUser.exists({ email: newEmail })) {
        return res.status(409).json({ message: "That email address is already in use." });
      }

      await SuperadminEmailChange.updateMany(
        { userId: req.systemUser._id, usedAt: null },
        { $set: { usedAt: new Date() } }
      );
      const challengeId = new mongoose.Types.ObjectId();
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const challenge = await SuperadminEmailChange.create({
        _id: challengeId,
        userId: req.systemUser._id,
        sessionVersion: Number(req.systemUser.sessionVersion || 0),
        currentEmail: req.systemUser.email,
        newEmail,
        codeHash: hashLoginCode(challengeId, code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      try {
        await sendSuperadminEmailChangeCode({
          to: newEmail,
          name: req.systemUser.name,
          code,
          newEmail,
          expiresMinutes: 10,
        });
      } catch (error) {
        await SuperadminEmailChange.updateOne({ _id: challenge._id, usedAt: null }, { $set: { usedAt: new Date() } });
        if (error?.code !== "SMTP_NOT_CONFIGURED") {
          console.error("superadmin email change code delivery failed:", error?.message || error);
        }
        return res.status(503).json({ message: "Unable to send a code to that address. Check the address or contact support." });
      }

      return res.json({
        challengeId: String(challenge._id),
        email: maskedEmail(newEmail),
        expiresInMinutes: 10,
      });
    } catch (err) {
      console.error("superadmin email change request error:", err?.message || err);
      return res.status(500).json({ message: "Unable to start the email change. Please try again." });
    }
  }
);

router.post(
  "/admin/security/email-change/verify",
  requireSystemAuth,
  requireRole("superadmin"),
  emailChangeVerifyIpLimit,
  emailChangeVerifyChallengeLimit,
  async (req, res) => {
    try {
      const challengeId = String(req.body?.challengeId || "").trim();
      const code = String(req.body?.code || "").trim();
      if (!mongoose.Types.ObjectId.isValid(challengeId) || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ message: "The code is invalid or expired. Request a new code and try again." });
      }

      const now = new Date();
      const challenge = await SuperadminEmailChange.findOne({
        _id: challengeId,
        userId: req.systemUser._id,
        usedAt: null,
        expiresAt: { $gt: now },
        attempts: { $lt: 5 },
      });
      if (!challenge || Number(req.systemUser.sessionVersion || 0) !== Number(challenge.sessionVersion)) {
        return res.status(400).json({ message: "The code is invalid or expired. Start the email change again." });
      }

      const expectedHash = hashLoginCode(challenge._id, code);
      const matches = crypto.timingSafeEqual(
        Buffer.from(challenge.codeHash, "hex"),
        Buffer.from(expectedHash, "hex")
      );
      if (!matches) {
        await SuperadminEmailChange.updateOne(
          { _id: challenge._id, userId: req.systemUser._id, usedAt: null, expiresAt: { $gt: now }, attempts: { $lt: 5 } },
          { $inc: { attempts: 1 } }
        );
        return res.status(400).json({ message: "The code is incorrect or expired." });
      }

      const consumed = await SuperadminEmailChange.findOneAndUpdate(
        { _id: challenge._id, userId: req.systemUser._id, codeHash: expectedHash, usedAt: null, expiresAt: { $gt: now }, attempts: { $lt: 5 } },
        { $set: { usedAt: now }, $inc: { attempts: 1 } },
        { new: true }
      );
      if (!consumed) {
        return res.status(400).json({ message: "The code is invalid or expired. Start the email change again." });
      }

      const updatedUser = await SystemUser.findOneAndUpdate(
        {
          _id: req.systemUser._id,
          role: "superadmin",
          email: consumed.currentEmail,
          sessionVersion: consumed.sessionVersion,
        },
        { $set: { email: consumed.newEmail }, $inc: { sessionVersion: 1 } },
        { new: true, runValidators: true }
      );
      if (!updatedUser) {
        return res.status(409).json({ message: "Your account changed during this request. Sign in again and retry." });
      }

      await LoginEmailChallenge.updateMany(
        { userId: updatedUser._id, usedAt: null },
        { $set: { usedAt: now } }
      );
      await SuperadminEmailChange.updateMany(
        { userId: updatedUser._id, _id: { $ne: challenge._id }, usedAt: null },
        { $set: { usedAt: now } }
      );
      try {
        await sendSuperadminEmailChangedNotice({ to: consumed.currentEmail, name: updatedUser.name, newEmail: updatedUser.email });
      } catch (error) {
        console.error("superadmin old-email notice failed:", error?.message || error);
      }

      return res.json({ ok: true, email: updatedUser.email, message: "Email updated. Sign in again with your new email." });
    } catch (err) {
      if (err?.code === 11000) {
        return res.status(409).json({ message: "That email address is already in use. Start again with another address." });
      }
      console.error("superadmin email change verification error:", err?.message || err);
      return res.status(500).json({ message: "Unable to verify the code. Please try again." });
    }
  }
);

router.post(
  "/admin/security/email-change/resend",
  requireSystemAuth,
  requireRole("superadmin"),
  emailChangeResendIpLimit,
  emailChangeResendChallengeLimit,
  async (req, res) => {
    try {
      const challengeId = String(req.body?.challengeId || "").trim();
      if (!mongoose.Types.ObjectId.isValid(challengeId)) {
        return res.status(400).json({ message: "Email change request is invalid or expired. Start again." });
      }
      const now = new Date();
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const challenge = await SuperadminEmailChange.findOneAndUpdate(
        {
          _id: challengeId,
          userId: req.systemUser._id,
          sessionVersion: Number(req.systemUser.sessionVersion || 0),
          usedAt: null,
          expiresAt: { $gt: now },
          resendCount: { $lt: 2 },
        },
        {
          $set: { codeHash: hashLoginCode(challengeId, code), expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0 },
          $inc: { resendCount: 1 },
        },
        { new: true }
      );
      if (!challenge) {
        return res.status(429).json({ message: "Code resend limit reached or request expired. Start again later." });
      }

      try {
        await sendSuperadminEmailChangeCode({
          to: challenge.newEmail,
          name: req.systemUser.name,
          code,
          newEmail: challenge.newEmail,
          expiresMinutes: 10,
        });
      } catch (error) {
        await SuperadminEmailChange.updateOne({ _id: challenge._id, usedAt: null }, { $set: { usedAt: new Date() } });
        if (error?.code !== "SMTP_NOT_CONFIGURED") {
          console.error("superadmin email change code resend failed:", error?.message || error);
        }
        return res.status(503).json({ message: "Unable to send the code. Please start the email change again later." });
      }

      return res.json({ email: maskedEmail(challenge.newEmail), expiresInMinutes: 10 });
    } catch (err) {
      console.error("superadmin email change resend error:", err?.message || err);
      return res.status(500).json({ message: "Unable to resend the code. Please try again." });
    }
  }
);

router.post("/auth/forgot-password", recoveryIpLimit, recoveryAccountLimit, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const genericMessage =
      "If an account exists for this email, password reset instructions have been sent.";

    if (!email) {
      return res.status(400).json({ message: "email is required" });
    }

    const user = await SystemUser.findOne({ email });
    if (!user) {
      return res.json({ ok: true, message: genericMessage });
    }

    await PasswordResetToken.updateMany(
      { userId: user._id, usedAt: null },
      { $set: { usedAt: new Date() } }
    );
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const resetUrl = publicResetUrl(req, token);

    await PasswordResetToken.create({
      userId: user._id,
      tokenHash: hashResetToken(token),
      expiresAt,
      requestedFromIp: req.ip || "",
      userAgent: req.get("User-Agent") || "",
    });

    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl,
      expiresMinutes: 15,
    });

    const response = {
      ok: true,
      message: genericMessage,
      expiresAt,
    };

    res.json(response);
  } catch (err) {
    console.error("forgot password error:", err);
    if (err.code === "SMTP_NOT_CONFIGURED") {
      return res.status(500).json({
        message: "Email service is not configured. Please add SMTP settings on the server.",
      });
    }
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/reset-password", resetIpLimit, resetTokenLimit, async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");

    if (!token || !password) {
      return res.status(400).json({ message: "token and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const tokenDoc = await PasswordResetToken.findOne({
      tokenHash: hashResetToken(token),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) {
      return res.status(400).json({ message: "Reset link is invalid or expired" });
    }

    const user = await SystemUser.findById(tokenDoc.userId).select("+password");
    if (!user) {
      return res.status(400).json({ message: "Reset link is invalid or expired" });
    }

    user.password = password;
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    await user.save();

    tokenDoc.usedAt = new Date();
    await tokenDoc.save();

    await PasswordResetToken.updateMany(
      { userId: user._id, usedAt: null },
      { $set: { usedAt: new Date() } }
    );
    await LoginEmailChallenge.updateMany(
      { userId: user._id, usedAt: null },
      { $set: { usedAt: new Date() } }
    );

    res.json({ ok: true, message: "Password reset successfully. Please sign in with your new password." });
  } catch (err) {
    console.error("reset password error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/me", requireSystemAuth, async (req, res) => {
  const subscription = req.organizationId
    ? await Subscription.findOne({ organizationId: req.organizationId })
        .sort({ createdAt: -1 })
        .populate("planId")
        .lean()
    : null;

  res.json({
    user: publicUser(req.systemUser),
    organization: req.organization,
    subscription,
  });
});

router.put("/app/profile", requireSystemAuth, requireRole("system_admin"), async (req, res) => {
  try {
    if (!req.organizationId || !req.organization) {
      return res.status(403).json({ message: "Organization required." });
    }

    const businessName = String(req.body?.businessName || "").trim();
    const ownerName = String(req.body?.ownerName || "").trim();
    if (!businessName || !ownerName) {
      return res.status(400).json({ message: "Business name and owner name are required." });
    }
    if (businessName.length > 120 || ownerName.length > 120) {
      return res.status(400).json({ message: "Business name and owner name must be 120 characters or fewer." });
    }

    req.organization.name = businessName;
    req.organization.ownerName = ownerName;
    req.systemUser.name = ownerName;
    await Promise.all([req.organization.save(), req.systemUser.save()]);
    return res.json({
      organization: req.organization,
      user: publicUser(req.systemUser),
    });
  } catch (error) {
    console.error("business profile update error:", error?.message || error);
    return res.status(500).json({ message: "Unable to update your business profile." });
  }
});

router.use("/app/owner-documents", requireSystemAuth, requireRole("system_admin"), requireActiveOrganization, require("./ownerDocuments"));

router.get("/app/bootstrap", requireSystemAuth, async (req, res) => {
  try {
    const [subscription, plans, latestTransaction] = await Promise.all([
      req.organizationId
        ? Subscription.findOne({ organizationId: req.organizationId })
            .sort({ createdAt: -1 })
            .populate("planId")
            .lean()
        : null,
      SubscriptionPlan.find({ isActive: true })
        .sort({ durationMonths: 1, createdAt: -1 })
        .lean(),
      req.organizationId
        ? BillingTransaction.findOne({ organizationId: req.organizationId })
            .sort({ createdAt: -1 })
            .lean()
        : null,
    ]);

    let organizationStatus = req.organization?.status || null;
    if (req.organization) {
      const lifecycle = await refreshSubscriptionStateForOrganization(req.organization);
      req.organization = lifecycle.organization;
      organizationStatus = req.organization?.status || null;
      if (subscription && lifecycle.subscription) {
        subscription.status = lifecycle.subscription.status;
        subscription.endDate = lifecycle.subscription.endDate;
      }
    }
    const subscriptionStatus = subscription?.status || null;
    const subscriptionAccess = getSubscriptionReadOnlyAccess(req.organization, subscription);
    const unitUsage = req.organization?.onboardingMode === "flexible" ? await getUnitUsage(req.organizationId) : null;
    const needsPropertySelection = req.systemUser.role === "system_admin" && req.organization?.onboardingMode === "flexible" && !(req.organization.selectedPropertyTypes || []).length && isSubscriptionUsable(req.organization, subscription);
    const needsUnitSetup =
      req.systemUser.role === "system_admin" &&
      isSubscriptionUsable(req.organization, subscription) &&
      needsUnitSetupFor(subscription, req.organization);
    const canUseSystem =
      req.systemUser.role === "superadmin" ||
      ((req.systemUser.status === "active" &&
        isSubscriptionUsable(req.organization, subscription) &&
        !needsUnitSetup) || subscriptionAccess.readOnly);
    const referralCode =
      req.systemUser.role === "system_admin" &&
      req.organizationId &&
      req.systemUser.status === "active" &&
      isSubscriptionUsable(req.organization, subscription)
        ? publicReferralCode(await ensureReferralCodeForOrganization(req.organizationId))
        : null;

    res.json({
      user: publicUser(req.systemUser),
      organization: req.organization || null,
      subscription,
      unitUsage,
      referralCode,
      latestTransaction,
      plans,
      access: {
        role: req.systemUser.role,
        canUseSystem,
        readOnly: subscriptionAccess.readOnly,
        readOnlyUntil: subscriptionAccess.readOnlyUntil,
        needsUnitSetup,
        needsPropertySelection,
        needsPayment:
          req.systemUser.role !== "superadmin" &&
          (organizationStatus === "pending_payment" ||
            subscriptionStatus === "pending_payment"),
        expired:
          req.systemUser.role !== "superadmin" &&
          (organizationStatus === "expired" || subscriptionStatus === "expired"),
        suspended:
          req.systemUser.status === "suspended" || organizationStatus === "suspended",
      },
    });
  } catch (err) {
    console.error("app bootstrap error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/onboarding/units",
  requireSystemAuth,
  requireRole("system_admin"),
  async (req, res) => {
    try {
      if (!req.organizationId || !req.organization) {
        return res.status(403).json({ message: "Organization required" });
      }

      const subscription = await Subscription.findOne({
        organizationId: req.organizationId,
      }).sort({ createdAt: -1 });

      if (!isSubscriptionUsable(req.organization, subscription)) {
        return res.status(402).json({
          message: req.organization.status === "expired" || subscription?.status === "expired"
            ? "Trial expired. Please purchase a plan."
            : "Active trial required",
          organizationStatus: req.organization.status,
          subscriptionStatus: subscription?.status || null,
          subscriptionEndDate: subscription?.endDate || null,
        });
      }

      if (!needsUnitSetupFor(subscription, req.organization)) {
        return res.status(400).json({ message: "Property units are already configured" });
      }

      const units = normalizeUnits(req.body?.units || req.body);
      if (!hasAnyUnit(units)) {
        return res.status(400).json({ message: "Enter at least one bed, room, or shop" });
      }

      subscription.units = units;
      await subscription.save();

      await ensureReservedUnits(req.organizationId, units);

      req.organization.unitAllocation = units;
      req.organization.businessType = businessTypeFromUnits(units);
      req.organization.features = {
        ...(req.organization.features?.toObject ? req.organization.features.toObject() : req.organization.features || {}),
        canteenEnabled: Boolean(req.body?.canteenEnabled) && units.beds > 0,
      };
      await req.organization.save();

      res.json({
        organization: req.organization,
        subscription,
        access: {
          canUseSystem: true,
          needsUnitSetup: false,
        },
      });
    } catch (err) {
      console.error("onboarding units error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.put("/onboarding/property-types", requireSystemAuth, requireRole("system_admin"), requireActiveOrganization, async (req, res) => {
  try {
    if (req.organization.onboardingMode !== "flexible") return res.status(400).json({ message: "Property types are managed by your existing unit allocation." });
    const types = req.body?.types;
    if (!Array.isArray(types) || !types.length || types.some((type) => !["bed", "room", "shop"].includes(type))) return res.status(400).json({ message: "Select at least one valid property type." });
    const usage = await getUnitUsage(req.organizationId);
    const allocation = req.organization.unitAllocation || {};
    const required = [["bed", "beds"], ["room", "rooms"], ["shop", "shops"]].filter(([, key]) => usage[key] > 0 || Number(allocation[key] || 0) > 0).map(([type]) => type);
    if (required.some((type) => !types.includes(type))) return res.status(400).json({ message: "Property types with existing units or allocated capacity must remain selected." });
    req.organization.selectedPropertyTypes = [...new Set(types)];
    req.organization.businessType = types.length === 1 ? ({ bed: "hostel", room: "rooms", shop: "shops" }[types[0]]) : "mixed";
    if (!req.organization.features) req.organization.features = {};
    if (types.includes("bed")) {
      req.organization.features.canteenEnabled = Boolean(req.body?.canteenEnabled);
    } else {
      req.organization.features.canteenEnabled = false;
    }
    await req.organization.save();
    res.json({ organization: req.organization });
  } catch (err) { res.status(500).json({ message: "Unable to save property types." }); }
});

router.put("/app/canteen-feature", requireSystemAuth, requireRole("system_admin"), requireActiveOrganization, async (req, res) => {
  try {
    const enabled = req.body?.canteenEnabled;
    if (typeof enabled !== "boolean") return res.status(400).json({ message: "Choose whether the canteen feature should be enabled." });
    const hasHostel = req.organization.onboardingMode === "flexible"
      ? (req.organization.selectedPropertyTypes || []).includes("bed")
      : Number(req.organization.unitAllocation?.beds || 0) > 0;
    if (enabled && !hasHostel) return res.status(400).json({ message: "Select the hostel property type before enabling canteen." });

    if (!req.organization.features) req.organization.features = {};
    req.organization.features.canteenEnabled = enabled;
    await req.organization.save();
    res.json({
      enabled,
      organization: req.organization,
      message: enabled ? "Canteen feature enabled." : "Canteen feature disabled. Your saved canteen settings have been kept.",
    });
  } catch (err) {
    console.error("canteen feature update error:", err);
    res.status(500).json({ message: "Unable to update canteen feature." });
  }
});

router.put("/onboarding/unit-counts", requireSystemAuth, requireRole("system_admin"), async (req, res) => {
  try {
    if (req.organization.onboardingMode !== "flexible") return res.status(400).json({ message: "This account uses the existing unit allocation." });
    const subscription = await Subscription.findOne({ organizationId: req.organizationId }).sort({ createdAt: -1 });
    if (!subscription || subscription.planId || Number(subscription.amount || 0) !== 0 || !["active", "expired"].includes(subscription.status)) return res.status(400).json({ message: "Use the subscription upgrade option to change your paid plan." });
    const raw = req.body?.units || {};
    if (["beds", "rooms", "shops"].some((key) => !Number.isInteger(Number(raw[key] ?? 0)) || Number(raw[key] ?? 0) < 0)) return res.status(400).json({ message: "Unit counts must be non-negative whole numbers." });
    const units = normalizeUnits(raw);
    const usage = await getUnitUsage(req.organizationId);
    if (!hasAnyUnit(units) || !allocationCoversUsage(units, usage)) return res.status(400).json({ message: "Counts must include all existing units and at least one unit." });
    const types = req.organization.selectedPropertyTypes || [];
    if ((units.beds && !types.includes("bed")) || (units.rooms && !types.includes("room")) || (units.shops && !types.includes("shop"))) return res.status(400).json({ message: "Select the property types before setting their unit counts." });
    subscription.units = units;
    await subscription.save();
    req.organization.unitAllocation = units;
    req.organization.unitCountsConfigured = true;
    await req.organization.save();
    res.json({ organization: req.organization, subscription, usage });
  } catch (err) { res.status(500).json({ message: "Unable to save unit counts." }); }
});

router.get(
  "/wallet",
  requireSystemAuth,
  requireRole("system_admin"),
  async (req, res) => {
    try {
      if (!req.organizationId) return res.status(403).json({ message: "Organization required" });
      const [wallet, referralCode] = await Promise.all([
        getWalletSummary(req.organizationId, req.query?.limit || 50),
        ensureReferralCodeForOrganization(req.organizationId),
      ]);
      res.json({
        ...wallet,
        referralCode: publicReferralCode(referralCode),
      });
    } catch (err) {
      console.error("wallet summary error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.get(
  "/admin/organizations/:id/wallet",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const organization = await Organization.findById(req.params.id).lean();
      if (!organization) return res.status(404).json({ message: "Organization not found" });
      const wallet = await getWalletSummary(organization._id, req.query?.limit || 50);
      res.json({ organization, ...wallet });
    } catch (err) {
      console.error("admin wallet summary error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/admin/organizations/:id/wallet/adjust",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const organization = await Organization.findById(req.params.id).lean();
      if (!organization) return res.status(404).json({ message: "Organization not found" });
      const direction = String(req.body?.direction || "").toLowerCase();
      if (!["credit", "debit"].includes(direction)) {
        return res.status(400).json({ message: "direction must be credit or debit" });
      }
      const entry = await addWalletEntry({
        organizationId: organization._id,
        type: direction === "credit" ? "manual_credit" : "manual_debit",
        direction,
        coins: req.body?.coins,
        description: req.body?.description || "Manual wallet adjustment",
        referenceType: "manual_adjustment",
        meta: { adjustedBy: String(req.systemUser._id) },
      });
      const wallet = await getWalletSummary(organization._id, 50);
      res.json({ entry, ...wallet });
    } catch (err) {
      console.error("wallet adjustment error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post("/subscription/unit-reduction-request", requireSystemAuth, async (req, res) => {
  try {
    if (req.systemUser.role === "superadmin") {
      return res.status(400).json({ message: "Superadmin cannot request a unit reduction" });
    }
    if (!req.organizationId || !req.organization) {
      return res.status(403).json({ message: "Organization required" });
    }

    const units = normalizeUnits(req.organization.unitAllocation || {});
    const requesterPhone = String(req.systemUser.phone || "").trim();
    const requesterContacts = [req.systemUser.email, requesterPhone].filter(Boolean).join(" / ");
    await notifySuperadmins({
      type: "system",
      title: "Unit reduction requested",
      message: `${req.organization.name || "An organization"} requested help reducing its registered units. Contact ${req.systemUser.name || "the account owner"}${requesterContacts ? ` at ${requesterContacts}` : ""}. Current allocation: ${units.beds} beds, ${units.rooms} rooms, ${units.shops} shops.`,
      priority: "high",
      entityType: "organization",
      entityId: req.organization._id,
      actionType: "unit_reduction_request",
      payload: {
        organizationId: String(req.organization._id),
        organizationName: req.organization.name || "",
        requesterName: req.systemUser.name || "",
        requesterEmail: req.systemUser.email || "",
        requesterPhone,
        units,
      },
    });

    res.json({ message: "Your request has been sent to our support team. They will review your occupied and vacant units and contact you using the phone or email registered to your account." });
  } catch (err) {
    console.error("unit reduction support request error:", err);
    res.status(500).json({ message: "Unable to send your request right now." });
  }
});

router.post("/subscription/renew-request", requireSystemAuth, async (req, res) => {
  try {
    if (req.systemUser.role === "superadmin") {
      return res.status(400).json({ message: "Superadmin does not need subscription renewal" });
    }
    if (!req.organizationId || !req.organization) {
      return res.status(403).json({ message: "Organization required" });
    }

    const currentSubscription = await Subscription.findOne({ organizationId: req.organizationId })
      .sort({ createdAt: -1 })
      .populate("planId");
    if (!currentSubscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    const requestedReferralCode = normalizeReferralCode(req.body?.referralCode);
    const firstPaidPurchase = !currentSubscription.planId &&
      Number(currentSubscription.amount || 0) === 0 &&
      ["active", "expired"].includes(currentSubscription.status);
    if (requestedReferralCode && !firstPaidPurchase && currentSubscription.status !== "pending_payment") {
      return res.status(400).json({ message: "Referral codes are available on the first paid plan purchase only." });
    }

    const pendingExisting = await Subscription.findOne({
      organizationId: req.organizationId,
      status: "pending_payment",
    }).sort({ createdAt: -1 });

    if (pendingExisting) {
      if (req.body?.repricePending === true) {
        const referralAllowed = await isFirstPaidPendingCheckout(pendingExisting);
        if (requestedReferralCode && !referralAllowed) {
          return res.status(400).json({ message: "Referral codes are available on the first paid plan purchase only." });
        }
        const referral = requestedReferralCode
          ? await getUsableReferralCode(requestedReferralCode, { excludeOwnerOrganizationId: req.organizationId })
          : null;
        const transactions = await ensurePendingPaymentCanBeRepriced(pendingExisting);
        const planPricing = calculatePendingSubscriptionPricing(pendingExisting, referral);
        const walletPricing = await applyWalletPricing(req.organizationId, planPricing.payableAmount, req.body?.useWallet === true);
        const pricing = { ...planPricing, ...walletPricing };
        const transaction = await BillingTransaction.create({
          organizationId: req.organizationId,
          subscriptionId: pendingExisting._id,
          merchantTransactionId: `RENREQ${Date.now()}${crypto.randomInt(1000, 9999)}`,
          provider: "phonepe",
          amount: pricing.payableAmount,
          pricing,
          currency: pendingExisting.currency || "INR",
          status: "created",
          requestPayload: {
            action: "renewal_request",
            requestedBy: String(req.systemUser._id),
            retryForSubscriptionId: String(pendingExisting._id),
            useWallet: req.body?.useWallet === true,
          },
        });
        pendingExisting.pricing = pricing;
        pendingExisting.amount = pricing.payableAmount;
        pendingExisting.latestTransactionId = transaction._id;
        await pendingExisting.save();
        await BillingTransaction.updateMany({
          _id: { $in: transactions.filter((item) => ["created", "pending"].includes(item.status)).map((item) => item._id) },
        }, { $set: { status: "cancelled" } });
        return res.json({ subscription: pendingExisting, transaction });
      }
      const transaction = await BillingTransaction.findOne({
        subscriptionId: pendingExisting._id,
        status: { $in: ["created", "pending"] },
      }).sort({ createdAt: -1 });
      if (transaction) {
        if (requestedReferralCode && requestedReferralCode !== String(transaction.pricing?.referralCode || "")) {
          return res.status(409).json({ message: "Review the referral code before creating a new payment attempt." });
        }
        return res.json({ subscription: pendingExisting, transaction });
      }

      const retryTransaction = await BillingTransaction.create({
        organizationId: req.organizationId,
        subscriptionId: pendingExisting._id,
        merchantTransactionId: `RENREQ${Date.now()}${crypto.randomInt(1000, 9999)}`,
        provider: "phonepe",
        amount: Number(pendingExisting.amount || 0),
        pricing: pendingExisting.pricing || {
          subtotal: Number(pendingExisting.amount || 0),
          payableAmount: Number(pendingExisting.amount || 0),
        },
        currency: pendingExisting.currency || "INR",
        status: "created",
        requestPayload: {
          action: "renewal_request",
          requestedBy: String(req.systemUser._id),
          retryForSubscriptionId: String(pendingExisting._id),
          useWallet: req.body?.useWallet === true,
        },
      });
      pendingExisting.latestTransactionId = retryTransaction._id;
      await pendingExisting.save();
      return res.json({ subscription: pendingExisting, transaction: retryTransaction });
    }
    if (requestedReferralCode && !firstPaidPurchase) {
      return res.status(400).json({ message: "Referral codes are available on the first paid plan purchase only." });
    }

    let plan = null;
    if (req.body?.planId) {
      plan = await SubscriptionPlan.findOne({ _id: req.body.planId, isActive: true });
      if (!plan) return res.status(404).json({ message: "Plan not found" });
    } else if (currentSubscription.planId?._id) {
      plan = await SubscriptionPlan.findOne({ _id: currentSubscription.planId._id, isActive: true });
    }
    if (requestedReferralCode && !plan) {
      return res.status(400).json({ message: "Select a plan before applying a referral code." });
    }

    const durationMonths = plan?.durationMonths || getDurationMonths(req.body) || currentSubscription.durationMonths || 12;
    const units = req.organization.onboardingMode === "flexible" && !req.organization.unitCountsConfigured && !currentSubscription.planId && Number(currentSubscription.amount || 0) === 0
      ? normalizeUnits(await getUnitUsage(req.organizationId))
      : normalizeUnits(currentSubscription.units || req.organization.unitAllocation || {});
    if (!hasAnyUnit(units)) return res.status(400).json({ message: "Add at least one unit before purchasing a plan." });
    const referral = requestedReferralCode
      ? await getUsableReferralCode(requestedReferralCode, { excludeOwnerOrganizationId: req.organizationId })
      : null;
    const planPricing = plan ? calculateSubscriptionPricing(plan, units, referral) : null;
    const originalAmount = planPricing ? planPricing.payableAmount : Number(currentSubscription.amount || 0);
    const walletPricing = await applyWalletPricing(req.organizationId, originalAmount, req.body?.useWallet === true);
    const amount = walletPricing.payableAmount;
    const currency = plan?.currency || currentSubscription.currency || "INR";
    const startDate = renewalStartDate(currentSubscription, req.body?.startDate);
    const endDate = addMonths(startDate, durationMonths);

    const subscription = await Subscription.create({
      organizationId: req.organizationId,
      planId: plan?._id || currentSubscription.planId?._id || currentSubscription.planId || undefined,
      status: "pending_payment",
      startDate,
      endDate,
      durationMonths,
      units,
      amount,
      pricing: {
        ...(planPricing || { subtotal: originalAmount }),
        ...walletPricing,
      },
      currency,
    });

    const transaction = await BillingTransaction.create({
      organizationId: req.organizationId,
      subscriptionId: subscription._id,
      merchantTransactionId: `RENREQ${Date.now()}${crypto.randomInt(1000, 9999)}`,
      provider: "phonepe",
      amount,
      pricing: {
        ...(planPricing || { subtotal: originalAmount }),
        ...walletPricing,
      },
      currency,
      status: "created",
      requestPayload: {
        action: "renewal_request",
        requestedBy: String(req.systemUser._id),
        previousSubscriptionId: String(currentSubscription._id),
        originalAmount,
        useWallet: req.body?.useWallet === true,
      },
    });

    subscription.latestTransactionId = transaction._id;
    await subscription.save();

    await Promise.allSettled([
      notifySuperadmins({
        type: "renewal_request",
        title: "Subscription renewal requested",
        message: `${req.organization.name} requested a ${durationMonths}-month renewal for ${amount} ${currency}.`,
        priority: "high",
        entityType: "subscription",
        entityId: subscription._id,
        actionType: "renewal_request",
        expiresAt: addDays(endDate, 30),
        payload: {
          organizationId: String(req.organizationId),
          subscriptionId: String(subscription._id),
          transactionId: String(transaction._id),
          amount,
          walletCoinsUsed: walletPricing.walletCoinsUsed,
          currency,
        },
      }),
      notifyOrganization(req.organizationId, {
        type: "renewal_request",
        title: "Renewal request created",
        message: `Your renewal request is ready. Complete payment to renew access until ${endDate.toLocaleDateString("en-IN")}.`,
        priority: "high",
        entityType: "subscription",
        entityId: subscription._id,
        actionType: "renewal_payment_required",
        expiresAt: addDays(endDate, 30),
        payload: {
          subscriptionId: String(subscription._id),
          transactionId: String(transaction._id),
          amount,
          walletCoinsUsed: walletPricing.walletCoinsUsed,
          currency,
        },
      }),
    ]);

    res.status(201).json({ subscription, transaction });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("renew request error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/subscription/upgrade-request",
  requireSystemAuth,
  requireRole("system_admin"),
  requireActiveOrganization,
  async (req, res) => {
    try {
      if (!req.organizationId || !req.organization) {
        return res.status(403).json({ message: "Organization required" });
      }

      const currentSubscription = await Subscription.findOne({
        organizationId: req.organizationId,
        status: "active",
      })
        .sort({ createdAt: -1 })
        .populate("planId");

      if (!currentSubscription || isPastDate(currentSubscription.endDate)) {
        return res.status(400).json({ message: "Active subscription required for package upgrade" });
      }

      // Handle trials before checking for any old payment attempt. A previous
      // unfinished checkout must never turn a later trial unit addition into a
      // paid upgrade.
      if (isTrialSubscription(currentSubscription)) {
        if (req.organization.onboardingMode === "flexible" && !req.organization.unitCountsConfigured) return res.status(400).json({ message: "Set your unit counts before adding trial capacity." });
        const trialAddedUnits = normalizeUnits(req.body?.units || req.body?.addUnits || {});
        if (!hasAnyUnit(trialAddedUnits)) {
          return res.status(400).json({ message: "Add at least one bed, room, or shop" });
        }
        const trialCurrentUnits = normalizeUnits(currentSubscription.units || req.organization.unitAllocation || {});
        const trialNewUnits = normalizeUnits(addUnits(trialCurrentUnits, trialAddedUnits));
        await BillingTransaction.updateMany(
          {
            organizationId: req.organizationId,
            status: { $in: ["created", "pending"] },
            "requestPayload.action": "subscription_upgrade",
          },
          { $set: { status: "cancelled" } }
        );
        currentSubscription.units = trialNewUnits;
        await currentSubscription.save();
        req.organization.unitAllocation = trialNewUnits;
        await req.organization.save();
        if (req.organization.onboardingMode !== "flexible") await ensureReservedUnits(req.organizationId, trialNewUnits);
        return res.json({
          message: "Trial unit capacity added for free. Paid upgrade pricing applies only after a paid subscription is active.",
          subscription: currentSubscription,
          trialUpgrade: true,
          upgrade: { currentUnits: trialCurrentUnits, addedUnits: trialAddedUnits, newUnits: trialNewUnits, amount: 0, currency: "INR" },
        });
      }

      const pendingExisting = await BillingTransaction.findOne({
        organizationId: req.organizationId,
        status: { $in: ["created", "pending"] },
        "requestPayload.action": "subscription_upgrade",
      }).sort({ createdAt: -1 });

      if (pendingExisting) {
        const payload = pendingExisting.requestPayload || {};
        return res.json({
          message: "An upgrade payment is already pending",
          subscription: currentSubscription,
          transaction: pendingExisting,
          upgrade: {
            currentUnits: normalizeUnits(payload.currentUnits || currentSubscription.units || req.organization.unitAllocation || {}),
            addedUnits: normalizeUnits(payload.addedUnits || {}),
            newUnits: normalizeUnits(payload.newUnits || {}),
            amount: pendingExisting.amount,
            currency: pendingExisting.currency,
            remainingDays: payload.remainingDays,
            remainingMonthFactor: payload.remainingMonthFactor,
            fromTrial: payload.fromTrial === true,
            walletCoinsUsed: Number(pendingExisting.pricing?.walletCoinsUsed || 0),
            originalAmount: Number(payload.originalAmount || pendingExisting.pricing?.subtotal || pendingExisting.amount || 0),
          },
        });
      }

      const addedUnits = normalizeUnits(req.body?.units || req.body?.addUnits || {});
      if (!hasAnyUnit(addedUnits)) {
        return res.status(400).json({ message: "Add at least one bed, room, or shop" });
      }

      const currentUnits = normalizeUnits(currentSubscription.units || req.organization.unitAllocation || {});
      const newUnits = normalizeUnits(addUnits(currentUnits, addedUnits));

      const plan = await findUpgradePricingPlan(currentSubscription);

      if (!plan) {
        return res.status(404).json({ message: "No active subscription plan is available for upgrade pricing" });
      }

      const quote = calculateUpgradeAmount(plan, addedUnits, currentSubscription);
      const walletPricing = await applyWalletPricing(req.organizationId, quote.amount, req.body?.useWallet === true);
      const amount = walletPricing.payableAmount;
      const currency = plan.currency || currentSubscription.currency || "INR";

      const transaction = await BillingTransaction.create({
        organizationId: req.organizationId,
        subscriptionId: currentSubscription._id,
        merchantTransactionId: `UPG${Date.now()}${crypto.randomInt(1000, 9999)}`,
        provider: "phonepe",
        amount,
        pricing: {
          subtotal: quote.amount,
          payableAmount: amount,
          ...walletPricing,
        },
        currency,
        status: "created",
        requestPayload: {
          action: "subscription_upgrade",
          fromTrial: isTrialSubscription(currentSubscription),
          requestedBy: String(req.systemUser._id),
          planId: String(plan._id),
          subscriptionId: String(currentSubscription._id),
          currentUnits,
          addedUnits,
          newUnits,
          remainingDays: quote.remainingDays,
          remainingMonthFactor: quote.remainingMonthFactor,
          monthlyAmount: quote.monthlyAmount,
          originalAmount: quote.amount,
          useWallet: req.body?.useWallet === true,
        },
      });

      await Promise.allSettled([
        resolveNotifications({
          organizationId: req.organizationId,
          actionType: "subscription_upgrade_success",
        }),
        notifyOrganization(req.organizationId, {
          type: "renewal_request",
          title: "Upgrade payment created",
          message: `Complete payment of ${amount} ${currency} to activate your package upgrade.`,
          priority: "normal",
          entityType: "subscription",
          entityId: currentSubscription._id,
          actionType: "subscription_upgrade_payment_required",
          expiresAt: addDays(currentSubscription.endDate, 30),
          payload: {
            subscriptionId: String(currentSubscription._id),
            transactionId: String(transaction._id),
            addedUnits,
            newUnits,
            amount,
            walletCoinsUsed: walletPricing.walletCoinsUsed,
            currency,
          },
        }),
      ]);

      res.status(201).json({
        subscription: currentSubscription,
        transaction,
        upgrade: {
          currentUnits,
          addedUnits,
          newUnits,
          amount,
          currency,
          remainingDays: quote.remainingDays,
          fromTrial: isTrialSubscription(currentSubscription),
          walletCoinsUsed: walletPricing.walletCoinsUsed,
          originalAmount: quote.amount,
        },
      });
    } catch (err) {
      console.error("upgrade request error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post("/register", registrationIpLimit, async (req, res) => {
  return res.status(410).json({ message: "Business registration is no longer available. Sign in with your mobile number." });
});

router.post("/referrals/quote", requireSystemAuth, async (req, res) => {
  try {
    if (!req.organizationId || !req.organization) {
      return res.status(403).json({ message: "Organization required" });
    }
    if (!normalizeReferralCode(req.body?.referralCode)) {
      return res.status(400).json({ message: "Enter a referral code." });
    }
    const currentSubscription = await Subscription.findOne({ organizationId: req.organizationId }).sort({ createdAt: -1 });
    const firstPaidPending = await isFirstPaidPendingCheckout(currentSubscription);
    const firstPaidTrial = currentSubscription && !currentSubscription.planId &&
      Number(currentSubscription.amount || 0) === 0 && ["active", "expired"].includes(currentSubscription.status);
    if (!firstPaidTrial && !firstPaidPending) {
      return res.status(400).json({ message: "Referral codes are available on the first paid plan purchase only." });
    }
    const referral = await getUsableReferralCode(req.body?.referralCode, { excludeOwnerOrganizationId: req.organizationId });
    if (firstPaidPending) {
      const pricing = calculatePendingSubscriptionPricing(currentSubscription, referral);
      return res.json({ referral: publicReferralCode(referral), pricing, units: normalizeUnits(currentSubscription.units) });
    }
    let plan = null;
    if (req.body?.planId) {
      plan = await SubscriptionPlan.findOne({ _id: req.body.planId, isActive: true });
      if (!plan) return res.status(404).json({ message: "Plan not found" });
    } else {
      const durationMonths = getDurationMonths(req.body);
      plan = await SubscriptionPlan.findOne({ durationMonths, isActive: true }).sort({ createdAt: -1 });
    }
    if (!plan) return res.status(404).json({ message: "Active subscription plan not found" });

    const units = req.organization.onboardingMode === "flexible" && !req.organization.unitCountsConfigured
      ? normalizeUnits(await getUnitUsage(req.organizationId))
      : normalizeUnits(currentSubscription.units || req.organization.unitAllocation || {});
    const pricing = calculateSubscriptionPricing(plan, units, referral);
    res.json({ referral: publicReferralCode(referral), pricing, units });
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message || "Invalid referral code" });
  }
});

router.get("/security/pin-status", requireSystemAuth, async (req, res) => {
  const user = await SystemUser.findById(req.systemUser._id).select("+securityPin");
  res.json({ configured: Boolean(user?.securityPin) });
});

router.post("/security/pin", requireSystemAuth, async (req, res) => {
  const pin = String(req.body?.pin || "").trim();
  const currentPin = String(req.body?.currentPin || "").trim();
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ message: "PIN must contain 4 to 8 digits." });
  const user = await SystemUser.findById(req.systemUser._id).select("+securityPin");
  if (!user) return res.status(404).json({ message: "User not found" });
  if (user.securityPin && !(await user.compareSecurityPin(currentPin))) return res.status(403).json({ message: "Current security PIN is incorrect." });
  user.securityPin = await bcrypt.hash(pin, 10);
  await user.save();
  res.json({ configured: true });
});

router.post("/security/pin/reset", requireSystemAuth, async (req, res) => {
  const pin = String(req.body?.pin || "").trim();
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ message: "PIN must contain 4 to 8 digits." });
  const user = await SystemUser.findById(req.systemUser._id).select("+password +securityPin");
  if (!user || !(await user.comparePassword(String(req.body?.password || "")))) return res.status(403).json({ message: "Your account password is incorrect." });
  user.securityPin = await bcrypt.hash(pin, 10);
  await user.save();
  res.json({ configured: true });
});

router.get("/admin/security/pin-status", requireSystemAuth, requireRole("superadmin"), async (req, res) => {
  const user = await SystemUser.findById(req.systemUser._id).select("+securityPin");
  res.json({ configured: Boolean(user?.securityPin) });
});

router.post("/admin/security/pin", requireSystemAuth, requireRole("superadmin"), async (req, res) => {
  const pin = String(req.body?.pin || "").trim();
  const currentPin = String(req.body?.currentPin || "").trim();
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ message: "PIN must contain 4 to 8 digits." });
  const user = await SystemUser.findById(req.systemUser._id).select("+securityPin");
  if (!user) return res.status(404).json({ message: "User not found" });
  if (user.securityPin && !(await user.compareSecurityPin(currentPin))) {
    return res.status(403).json({ message: "Current security PIN is incorrect." });
  }
  user.securityPin = await bcrypt.hash(pin, 10);
  await user.save();
  res.json({ configured: true, message: "Security PIN saved." });
});

router.post("/admin/security/pin/reset", requireSystemAuth, requireRole("superadmin"), async (req, res) => {
  const pin = String(req.body?.pin || "").trim();
  const password = String(req.body?.password || "");
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ message: "PIN must contain 4 to 8 digits." });
  const user = await SystemUser.findById(req.systemUser._id).select("+password +securityPin");
  if (!user || !(await user.comparePassword(password))) return res.status(403).json({ message: "Your account password is incorrect." });
  user.securityPin = await bcrypt.hash(pin, 10);
  await user.save();
  res.json({ configured: true, message: "Security PIN reset." });
});

router.get(
  "/admin/referrals",
  requireSystemAuth,
  requireRole("superadmin"),
  async (_req, res) => {
    const referrals = await ReferralCode.find()
      .sort({ createdAt: -1 })
      .populate("ownerOrganizationId", "name ownerName email phone")
      .lean();
    res.json(referrals);
  }
);

router.post(
  "/admin/referrals",
  requireSystemAuth,
  requireRole("superadmin"),
  async (_req, res) => {
    res.status(405).json({ message: "Referral codes are auto-generated after system admin activation" });
  }
);

router.patch(
  "/admin/referrals/:id",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const update = {};
      ["title", "ownerOrganizationId", "maxUses", "validFrom", "validUntil", "isActive", "notes"].forEach((key) => {
        if (req.body[key] !== undefined) update[key] = req.body[key];
      });
      if (req.body.code !== undefined) update.code = normalizeReferralCode(req.body.code);
      if (req.body.discountPercent !== undefined) update.discountPercent = normalizeDiscountPercent(req.body.discountPercent);
      if (update.maxUses !== undefined) update.maxUses = Math.max(0, Number(update.maxUses || 0));
      if (update.ownerOrganizationId === "") update.ownerOrganizationId = null;

      const referral = await ReferralCode.findByIdAndUpdate(
        req.params.id,
        { $set: update },
        { new: true, runValidators: true }
      );
      if (!referral) return res.status(404).json({ message: "Referral code not found" });
      res.json(referral);
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ message: "Referral code already exists" });
      console.error("update referral error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/admin/referrals/:id",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      if (!(await verifySuperadminSecurityPin(req, res))) return;
      const referral = await ReferralCode.findByIdAndDelete(req.params.id);
      if (!referral) return res.status(404).json({ message: "Referral code not found" });
      res.json({ message: "Referral code deleted successfully", deleted: true, referral });
    } catch (err) {
      console.error("delete referral error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.get(
  "/admin/system-users",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const users = await SystemUser.find({ role: "system_admin" })
        .select("_id organizationId name email phone role status lastLoginAt createdAt updatedAt")
        .sort({ createdAt: -1 })
        .lean();

      const organizationIds = [...new Set(users.map((user) => String(user.organizationId || "")).filter(Boolean))];
      const organizations = await Organization.find({ _id: { $in: organizationIds } })
        .select("_id name ownerName email phone status createdAt")
        .lean();
      const organizationById = new Map(organizations.map((organization) => [String(organization._id), organization]));

      res.json(users.map((user) => ({
        ...user,
        organization: organizationById.get(String(user.organizationId)) || null,
      })));
    } catch (err) {
      console.error("admin system users error:", err);
      res.status(500).json({ message: "Unable to load system-admin users." });
    }
  }
);

router.get(
  "/admin/organizations",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    await expireDueSubscriptions();

    const organizations = await Organization.find()
      .sort({ createdAt: -1 })
      .lean();

    const orgIds = organizations.map((org) => org._id);
    const subscriptions = await Subscription.find({ organizationId: { $in: orgIds } })
      .sort({ createdAt: -1 })
      .populate("planId")
      .lean();

    const latestByOrg = new Map();
    subscriptions.forEach((sub) => {
      const key = String(sub.organizationId);
      if (!latestByOrg.has(key)) latestByOrg.set(key, sub);
    });

    res.json(
      organizations.map((org) => ({
        ...org,
        subscription: latestByOrg.get(String(org._id)) || null,
      }))
    );
  }
);

router.get(
  "/admin/organizations/:id/vacant-units",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const organization = await Organization.findById(req.params.id).lean();
      if (!organization) return res.status(404).json({ message: "Organization not found" });

      const [rooms, tenants] = await Promise.all([
        Room.find({ organizationId: organization._id }).lean(),
        Form.find({ organizationId: organization._id }).lean(),
      ]);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isActiveToday = (tenant) => {
        if (!tenant?.leaveDate) return true;
        const leaveDate = new Date(tenant.leaveDate);
        if (Number.isNaN(leaveDate.getTime())) return true;
        leaveDate.setHours(0, 0, 0, 0);
        return leaveDate > today;
      };
      const activeTenants = tenants.filter(isActiveToday);
      const roomTenants = (room, bedNo = "") => activeTenants.filter((tenant) =>
        String(tenant.roomId || "") === String(room._id) &&
        (!bedNo || String(tenant.bedNo || "").trim().toLowerCase() === String(bedNo).trim().toLowerCase())
      );
      const supportUnitName = (room) => {
        const name = String(room.category || "").trim();
        return room.isPlaceholder || !name || /^unassigned$/i.test(name) ? "Unit" : name;
      };
      const rows = [];
      rooms.forEach((room) => {
        if (room.propertyType === "bed") {
          (room.beds || []).forEach((bed) => {
            const occupants = roomTenants(room, bed.bedNo);
            rows.push({
              id: `${room._id}:bed:${bed.bedNo}`,
              unitId: String(room._id),
              kind: "bed",
              propertyType: "bed",
              bedNo: bed.bedNo,
              label: `${supportUnitName(room)} | ${room.isPlaceholder ? "Details pending" : room.roomNo || "Room"} | Bed ${bed.bedNo}`,
              isPlaceholder: Boolean(room.isPlaceholder),
              occupancy: occupants.length ? "occupied" : "vacant",
              occupants: occupants.map((tenant) => ({ id: String(tenant._id), name: tenant.name || "Tenant", phone: tenant.phoneNo || tenant.mobile || "" })),
            });
          });
          return;
        }
        const occupants = roomTenants(room);
        rows.push({
          id: `${room._id}:unit`,
          unitId: String(room._id),
          kind: "unit",
          propertyType: room.propertyType,
          label: `${supportUnitName(room)} | ${room.isPlaceholder ? "Details pending" : room.roomNo || "Unit"}`,
          isPlaceholder: Boolean(room.isPlaceholder),
          occupancy: occupants.length ? "occupied" : "vacant",
          occupants: occupants.map((tenant) => ({ id: String(tenant._id), name: tenant.name || "Tenant", phone: tenant.phoneNo || tenant.mobile || "" })),
        });
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ message: "Unable to load support units", error: err.message });
    }
  }
);

router.delete(
  "/admin/organizations/:id/vacant-units/:unitId",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      if (!(await verifySuperadminSecurityPin(req, res))) return;
      const organization = await Organization.findById(req.params.id);
      if (!organization) return res.status(404).json({ message: "Organization not found" });
      const room = await Room.findOne({ _id: req.params.unitId, organizationId: organization._id });
      if (!room) return res.status(404).json({ message: "Unit not found" });

      const reason = String(req.body?.reason || "Customer requested a unit reduction").trim().slice(0, 300);
      const allTenants = await Form.find({ organizationId: organization._id });
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const effectiveDate = today.toISOString().slice(0, 10);
      const isActiveToday = (tenant) => {
        if (!tenant?.leaveDate) return true;
        const leaveDate = new Date(tenant.leaveDate);
        if (Number.isNaN(leaveDate.getTime())) return true;
        leaveDate.setHours(0, 0, 0, 0);
        return leaveDate > today;
      };
      const tenantsForUnit = (bedNo = "") => allTenants.filter((tenant) =>
        isActiveToday(tenant) &&
        String(tenant.roomId || "") === String(room._id) &&
        (!bedNo || String(tenant.bedNo || "").trim().toLowerCase() === String(bedNo).trim().toLowerCase())
      );
      const kind = String(req.body?.kind || "");
      const bedNo = String(req.body?.bedNo || "").trim();
      let removed = null;
      let decrement = { beds: 0, rooms: 0, shops: 0 };

      if (kind === "bed") {
        if (room.propertyType !== "bed" || !bedNo) return res.status(400).json({ message: "Select a hostel bed to remove" });
        const bed = (room.beds || []).find((item) => String(item.bedNo || "").trim().toLowerCase() === bedNo.toLowerCase());
        if (!bed) return res.status(404).json({ message: "Bed not found" });
        const affectedTenants = tenantsForUnit(bedNo);
        if (affectedTenants.length) {
          await Form.updateMany(
            { _id: { $in: affectedTenants.map((tenant) => tenant._id) } },
            { $set: {
              leaveDate: effectiveDate,
              unitRemoval: {
                removedAt: new Date(), effectiveDate, propertyType: "bed", unitId: String(room._id),
                roomNo: String(room.roomNo || ""), bedNo, label: `${room.category || "Unit"} | ${room.roomNo || "Room"} | Bed ${bedNo}`,
                reason, removedBy: req.systemUser.name || "Superadmin",
              },
            } }
          );
        }
        room.beds = (room.beds || []).filter((item) => String(item.bedNo || "").trim().toLowerCase() !== bedNo.toLowerCase());
        await room.save();
        removed = { type: "bed", bedNo, roomNo: room.roomNo, affectedTenants: affectedTenants.map((tenant) => ({ id: String(tenant._id), name: tenant.name })) };
        decrement.beds = 1;
      } else {
        if (room.propertyType === "bed") return res.status(400).json({ message: "Remove hostel beds individually" });
        const affectedTenants = tenantsForUnit();
        if (affectedTenants.length) {
          await Form.updateMany(
            { _id: { $in: affectedTenants.map((tenant) => tenant._id) } },
            { $set: {
              leaveDate: effectiveDate,
              unitRemoval: {
                removedAt: new Date(), effectiveDate, propertyType: room.propertyType, unitId: String(room._id),
                roomNo: String(room.roomNo || ""), bedNo: "", label: `${room.category || "Unit"} | ${room.roomNo || "Unit"}`,
                reason, removedBy: req.systemUser.name || "Superadmin",
              },
            } }
          );
        }
        await Room.deleteOne({ _id: room._id });
        removed = { type: room.propertyType, roomNo: room.roomNo, affectedTenants: affectedTenants.map((tenant) => ({ id: String(tenant._id), name: tenant.name })) };
        decrement[room.propertyType === "shop" ? "shops" : "rooms"] = 1;
      }

      const latestSubscription = await Subscription.findOne({ organizationId: organization._id }).sort({ createdAt: -1 });
      const currentUnits = normalizeUnits(latestSubscription?.units || organization.unitAllocation || {});
      const newUnits = normalizeUnits({ beds: currentUnits.beds - decrement.beds, rooms: currentUnits.rooms - decrement.rooms, shops: currentUnits.shops - decrement.shops });
      organization.unitAllocation = newUnits;
      await organization.save();
      if (latestSubscription) {
        latestSubscription.units = newUnits;
        await latestSubscription.save();
      }
      await AuditLog.create({ organizationId: organization._id, entityType: "unit", entityId: room._id, action: "delete", actorId: String(req.systemUser._id), actorName: req.systemUser.name || "Superadmin", actorEmail: req.systemUser.email || "", actorRole: "superadmin", reason, before: { propertyType: room.propertyType, roomNo: room.roomNo, bedNo: bedNo || null }, after: { units: newUnits }, changes: { removed, decrement } });
      const affectedCount = removed?.affectedTenants?.length || 0;
      await notifyOrganization(organization._id, { type: "system", title: "Unit count updated", message: affectedCount ? `An occupied unit was removed by support. Its tenants were moved to former records today; their history remains available from ${effectiveDate}.` : "A vacant unit was removed by support. Your subscription amount will reflect the updated unit count.", priority: "normal", entityType: "organization", entityId: organization._id, actionType: "unit_reduction", payload: { removed, units: newUnits, reason, effectiveDate } });
      res.json({ message: affectedCount ? "Occupied unit removed. Tenant history was kept and the subscription count was updated." : "Vacant unit removed and subscription count updated", units: newUnits, removed, effectiveDate });
    } catch (err) {
      res.status(500).json({ message: "Unable to remove unit", error: err.message });
    }
  }
);

router.patch(
  "/admin/organizations/:id/status",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    if (!(await verifySuperadminSecurityPin(req, res))) return;
    const status = String(req.body?.status || "");
    const allowed = new Set(["pending_payment", "active", "suspended", "expired", "cancelled"]);
    if (!allowed.has(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const organization = await Organization.findById(req.params.id);
    if (!organization) return res.status(404).json({ message: "Organization not found" });

    organization.status = status;
    if (status === "active" && !organization.activatedAt) organization.activatedAt = new Date();
    if (status === "suspended") organization.suspendedAt = new Date();
    await organization.save();

    const statusUpdate = { $set: { status: userStatusForOrganization(status) } };
    if (status === "suspended") statusUpdate.$inc = { sessionVersion: 1 };
    await SystemUser.updateMany({ organizationId: organization._id }, statusUpdate);

    if (status === "active") {
      await resolveNotifications({
        audience: "superadmin",
        entityType: "organization",
        entityId: organization._id,
        actionType: "registration",
      });
    }

    res.json(organization);
  }
);

router.post(
  "/admin/subscriptions/:id/activate",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    if (!(await verifySuperadminSecurityPin(req, res))) return;
    const subscription = await Subscription.findById(req.params.id);
    if (!subscription) return res.status(404).json({ message: "Subscription not found" });

    const startDate = req.body?.startDate ? new Date(req.body.startDate) : new Date();
    subscription.status = "active";
    subscription.startDate = startDate;
    subscription.endDate = addMonths(startDate, subscription.durationMonths);
    await subscription.save();

    await Organization.findByIdAndUpdate(subscription.organizationId, {
      $set: { status: "active", activatedAt: startDate },
    });
    await SystemUser.updateMany(
      { organizationId: subscription.organizationId },
      { $set: { status: "active" } }
    );

    const transaction = await BillingTransaction.findById(subscription.latestTransactionId);
    if (transaction) {
      await grantReferralRewardFromTransaction(transaction);
      await debitWalletUsageFromTransaction(transaction, "renewal_discount_used");
    }
    await ensureReferralCodeForOrganization(subscription.organizationId);

    await resolveSubscriptionNotifications(subscription);
    await resolveNotifications({
      audience: "superadmin",
      entityType: "organization",
      entityId: subscription.organizationId,
      actionType: "registration",
    });

    await notifyOrganization(subscription.organizationId, {
      type: "payment_confirmation",
      title: "Subscription activated",
      message: `Your subscription is active until ${subscription.endDate.toLocaleDateString("en-IN")}.`,
      priority: "high",
      entityType: "subscription",
      entityId: subscription._id,
      actionType: "subscription_payment_success",
      expiresAt: addDays(new Date(), 7),
      payload: {
        subscriptionId: String(subscription._id),
        startDate,
        endDate: subscription.endDate,
      },
    });

    res.json(subscription);
  }
);

router.get("/plans", async (_req, res) => {
  const plans = await SubscriptionPlan.find({ isActive: true }).sort({
    durationMonths: 1,
    baseAmount: 1,
  });
  res.json(plans);
});

router.get(
  "/admin/plans",
  requireSystemAuth,
  requireRole("superadmin"),
  async (_req, res) => {
    const plans = await SubscriptionPlan.find().sort({
      durationMonths: 1,
      baseAmount: 1,
      createdAt: -1,
    });
    res.json(plans);
  }
);

router.post(
  "/admin/plans",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const durationMonths = getDurationMonths(req.body);
      const name =
        String(req.body?.name || "").trim() ||
        `${Math.round(durationMonths / 12)} Year Plan`;
      const requestedCode = String(req.body?.code || "").trim().toLowerCase();
      const code = requestedCode || await uniquePlanCode(name);

      const plan = await SubscriptionPlan.create({
        name,
        code,
        durationMonths,
        unitPricing: req.body?.unitPricing || {
          bedMonthly: req.body?.bedMonthly || 0,
          roomMonthly: req.body?.roomMonthly || 0,
          shopMonthly: req.body?.shopMonthly || 0,
        },
        baseAmount: req.body?.baseAmount || 0,
        discountPercent: normalizeDiscountPercent(req.body?.discountPercent),
        currency: req.body?.currency || "INR",
        description: req.body?.description || "",
        isActive: req.body?.isActive !== false,
      });

      res.status(201).json(plan);
    } catch (err) {
      if (err?.code === 11000) {
        return res.status(409).json({ message: "Plan code already exists" });
      }
      console.error("create plan error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.patch(
  "/admin/plans/:id",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    const allowed = [
      "name",
      "durationMonths",
      "unitPricing",
      "baseAmount",
      "discountPercent",
      "currency",
      "description",
      "isActive",
    ];
    const update = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    });
    if (update.discountPercent !== undefined) {
      update.discountPercent = normalizeDiscountPercent(update.discountPercent);
    }

    const plan = await SubscriptionPlan.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!plan) return res.status(404).json({ message: "Plan not found" });
    res.json(plan);
  }
);

router.delete(
  "/admin/plans/:id",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      if (!(await verifySuperadminSecurityPin(req, res))) return;
      const plan = await SubscriptionPlan.findByIdAndDelete(req.params.id);
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      res.json({ message: "Plan deleted successfully", deleted: true, plan });
    } catch (err) {
      console.error("delete plan error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.get(
  "/admin/dashboard",
  requireSystemAuth,
  requireRole("superadmin"),
  async (_req, res) => {
    await expireDueSubscriptions();

    // The dashboard chart must be based on payment records, not placeholder
    // values. Start at the first day of the month five months ago so the
    // response always contains the latest six calendar months.
    const trendStart = new Date();
    trendStart.setHours(0, 0, 0, 0);
    trendStart.setDate(1);
    trendStart.setMonth(trendStart.getMonth() - 5);

    const [
      totalOrganizations,
      activeOrganizations,
      pendingOrganizations,
      suspendedOrganizations,
      expiredOrganizations,
      activeSubscriptions,
      pendingSubscriptions,
      expiredSubscriptions,
      successfulPayments,
      pendingPayments,
      latestOrganizations,
      monthlyRevenue,
    ] = await Promise.all([
      Organization.countDocuments(),
      Organization.countDocuments({ status: "active" }),
      Organization.countDocuments({ status: "pending_payment" }),
      Organization.countDocuments({ status: "suspended" }),
      Organization.countDocuments({ status: "expired" }),
      Subscription.countDocuments({ status: "active" }),
      Subscription.countDocuments({ status: "pending_payment" }),
      Subscription.countDocuments({ status: "expired" }),
      BillingTransaction.aggregate([
        { $match: { status: "success" } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      BillingTransaction.aggregate([
        {
          $match: {
            $expr: {
              $in: [
                { $toLower: { $ifNull: ["$status", ""] } },
                ["created", "pending", "pending_payment"],
              ],
            },
          },
        },
        { $count: "count" },
      ]),
      Subscription.countDocuments({
        status: "pending_payment",
        $or: [
          { latestTransactionId: null },
          { latestTransactionId: { $exists: false } },
        ],
      }),
      Organization.find()
        .sort({ createdAt: -1 })
        .limit(8)
        .select("name ownerName email phone status createdAt")
        .lean(),
      BillingTransaction.aggregate([
        { $match: { status: "success" } },
        { $addFields: { trendDate: { $ifNull: ["$paidAt", "$createdAt"] } } },
        { $match: { trendDate: { $gte: trendStart } } },
        {
          $group: {
            _id: {
              year: { $year: "$trendDate" },
              month: { $month: "$trendDate" },
            },
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const revenueTrend = Array.from({ length: 6 }, (_, offset) => {
      const date = new Date(trendStart.getFullYear(), trendStart.getMonth() + offset, 1);
      const match = monthlyRevenue.find((item) => item._id.year === date.getFullYear() && item._id.month === date.getMonth() + 1);
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        label: date.toLocaleString("en-US", { month: "short" }),
        amount: match?.amount || 0,
        count: match?.count || 0,
      };
    });

    res.json({
      organizations: {
        total: totalOrganizations,
        active: activeOrganizations,
        pendingPayment: pendingOrganizations,
        suspended: suspendedOrganizations,
        expired: expiredOrganizations,
      },
      subscriptions: {
        active: activeSubscriptions,
        pendingPayment: pendingSubscriptions,
        expired: expiredSubscriptions,
      },
      revenue: {
        successfulAmount: successfulPayments[0]?.total || 0,
        successfulCount: successfulPayments[0]?.count || 0,
        pendingTransactions: (pendingPayments[0]?.count || 0) + pendingSubscriptions,
        trend: revenueTrend,
      },
      latestOrganizations,
    });
  }
);

router.get(
  "/admin/migration/unassigned-counts",
  requireSystemAuth,
  requireRole("superadmin"),
  async (_req, res) => {
    try {
      const entries = await Promise.all(
        Object.entries(MIGRATION_MODELS).map(async ([key, Model]) => [
          key,
          await Model.countDocuments(unassignedOrganizationQuery()),
        ])
      );

      res.json(Object.fromEntries(entries));
    } catch (err) {
      console.error("migration count error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/admin/subscription-reminders/run",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const reminderDays = Array.isArray(req.body?.reminderDays)
        ? req.body.reminderDays.map(Number).filter((value) => Number.isFinite(value) && value >= 0)
        : undefined;
      const result = await sendSubscriptionExpiryReminders({
        now: req.body?.now,
        reminderDays,
      });
      res.json(result);
    } catch (err) {
      console.error("manual subscription reminder error:", err);
      res.status(500).json({ message: "Unable to run subscription reminders" });
    }
  }
);

router.post(
  "/admin/migration/assign-organization",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const organizationId = req.body?.organizationId;
      const dryRun = req.body?.dryRun !== false;
      const only = Array.isArray(req.body?.collections) ? req.body.collections : null;

      if (!organizationId) {
        return res.status(400).json({ message: "organizationId is required" });
      }

      if (only) {
        const unknown = only.filter((key) => !MIGRATION_MODELS[key]);
        if (unknown.length) {
          return res.status(400).json({
            message: "Unknown migration collection",
            unknown,
            allowed: Object.keys(MIGRATION_MODELS),
          });
        }
      }

      const organization = await Organization.findById(organizationId).lean();
      if (!organization) return res.status(404).json({ message: "Organization not found" });

      const selectedEntries = Object.entries(MIGRATION_MODELS).filter(([key]) => {
        return !only || only.includes(key);
      });

      const result = {};
      for (const [key, Model] of selectedEntries) {
        const query = unassignedOrganizationQuery();
        const count = await Model.countDocuments(query);

        if (dryRun) {
          result[key] = { matched: count, modified: 0 };
          continue;
        }

        const update = await Model.updateMany(query, { $set: { organizationId } });
        result[key] = {
          matched: update.matchedCount ?? count,
          modified: update.modifiedCount ?? 0,
        };
      }

      res.json({
        dryRun,
        organization: {
          id: String(organization._id),
          name: organization.name,
        },
        result,
      });
    } catch (err) {
      console.error("migration assign error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.get(
  "/settings/hostel-rules",
  requireSystemAuth,
  requireRole("system_admin"),
  requireActiveOrganization,
  async (req, res) => {
    const rules = req.organization?.hostelRules || {};
    res.json({
      title: rules.title || "Hostel Rules & Regulations",
      content: rules.content || "",
      updatedAt: rules.updatedAt || null,
    });
  }
);

router.put(
  "/settings/hostel-rules",
  requireSystemAuth,
  requireRole("system_admin"),
  requireActiveOrganization,
  async (req, res) => {
    try {
      const title = String(req.body?.title || "Hostel Rules & Regulations").trim();
      const content = String(req.body?.content || "").trim();

      if (title.length > 120 || content.length > 12000) {
        return res.status(400).json({ message: "Rules title or content is too long." });
      }

      req.organization.hostelRules = {
        title: title || "Hostel Rules & Regulations",
        content,
        updatedAt: new Date(),
      };
      await req.organization.save();

      res.json({
        message: "Hostel rules saved.",
        title: req.organization.hostelRules.title,
        content: req.organization.hostelRules.content,
        updatedAt: req.organization.hostelRules.updatedAt,
      });
    } catch (err) {
      console.error("save hostel rules error:", err);
      res.status(500).json({ message: "Unable to save hostel rules." });
    }
  }
);

router.get(
  "/dashboard",
  requireSystemAuth,
  requireRole("system_admin", "superadmin"),
  requireActiveOrganization,
  async (req, res) => {
    if (!req.organizationId && req.systemUser.role !== "superadmin") {
      return res.status(403).json({ message: "Organization required" });
    }

    const orgQuery = req.organizationId ? { organizationId: req.organizationId } : {};
    const activeTenantQuery = {
      ...orgQuery,
      $or: [{ leaveDate: { $exists: false } }, { leaveDate: null }, { leaveDate: "" }],
    };

    const [
      rooms,
      tenants,
      activeTenants,
      reportedPayments,
      confirmedPayments,
      otherExpenses,
      lightBills,
      subscription,
      unitQuota,
      referralCode,
    ] = await Promise.all([
      Room.countDocuments(orgQuery),
      Form.countDocuments(orgQuery),
      Form.countDocuments(activeTenantQuery),
      Payment.countDocuments({ ...orgQuery, status: "reported" }),
      Payment.aggregate([
        { $match: { ...orgQuery, status: "confirmed" } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      OtherExpense.aggregate([
        { $match: orgQuery },
        { $group: { _id: null, total: { $sum: "$mainAmount" }, count: { $sum: 1 } } },
      ]),
      LightBillEntry.aggregate([
        { $match: orgQuery },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      req.organizationId
        ? Subscription.findOne({ organizationId: req.organizationId })
            .sort({ createdAt: -1 })
            .populate("planId")
            .lean()
        : null,
      req.organizationId
        ? getUnitQuota(req.organizationId).catch(() => null)
        : null,
      req.organizationId
        ? ensureReferralCodeForOrganization(req.organizationId)
        : null,
    ]);

    res.json({
      organization: req.organization || null,
      subscription,
      referralCode: publicReferralCode(referralCode),
      units: unitQuota,
      totals: {
        rooms,
        beds: unitQuota?.usage?.beds || 0,
        rentalRooms: unitQuota?.usage?.rooms || 0,
        shops: unitQuota?.usage?.shops || 0,
        tenants,
        activeTenants,
        pendingPaymentReports: reportedPayments,
        confirmedPaymentAmount: confirmedPayments[0]?.total || 0,
        confirmedPaymentCount: confirmedPayments[0]?.count || 0,
        otherExpenseAmount: otherExpenses[0]?.total || 0,
        otherExpenseCount: otherExpenses[0]?.count || 0,
        lightBillAmount: lightBills[0]?.total || 0,
        lightBillCount: lightBills[0]?.count || 0,
      },
    });
  }
);

module.exports = router;
