const jwt = require("jsonwebtoken");
const SystemUser = require("../models/SystemUser");
const Organization = require("../models/Organization");
const {
  getLatestSubscription,
  isSubscriptionUsable,
  refreshSubscriptionStateForOrganization,
} = require("../services/subscriptionLifecycle");

const SYSTEM_ADMIN_TOKEN_EXPIRES_IN = process.env.SAAS_JWT_EXPIRES_IN || "7d";
const SUPERADMIN_TOKEN_EXPIRES_IN = process.env.SAAS_SUPERADMIN_JWT_EXPIRES_IN || "12h";
const SUPERADMIN_IDLE_TIMEOUT_MINUTES = Number(process.env.SAAS_SUPERADMIN_IDLE_TIMEOUT_MINUTES || 30);
const SYSTEM_ADMIN_IDLE_TIMEOUT_MINUTES = Number(process.env.SAAS_SYSTEM_ADMIN_IDLE_TIMEOUT_MINUTES || 120);
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function getJwtSecret() {
  const secret = process.env.SAAS_JWT_SECRET || (!IS_PRODUCTION && (
    process.env.JWT_SECRET || process.env.JWT_TOKEN
  ));

  if (!secret) {
    throw new Error("SAAS_JWT_SECRET must be configured before SaaS authentication can be used.");
  }
  if (IS_PRODUCTION && Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SAAS_JWT_SECRET must be at least 32 bytes in production.");
  }
  return secret;
}

function validateSaasJwtSecret() {
  getJwtSecret();
}

function signSystemToken(user, clientPlatform = "web") {
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      organizationId: user.organizationId ? String(user.organizationId) : null,
      sessionVersion: Number(user.sessionVersion || 0),
      clientPlatform: String(clientPlatform || "web").toLowerCase() === "mobile" ? "mobile" : "web",
      tokenType: "system",
    },
    getJwtSecret(),
    { expiresIn: user.role === "superadmin" ? SUPERADMIN_TOKEN_EXPIRES_IN : SYSTEM_ADMIN_TOKEN_EXPIRES_IN }
  );
}

function readBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

async function validateSessionActivity(user, payload, req, res) {
  const clientPlatform = payload.clientPlatform || (req.get("X-Platform") || "web").toLowerCase();
  if (clientPlatform === "mobile") return true;

  const configuredMinutes = user.role === "superadmin"
    ? SUPERADMIN_IDLE_TIMEOUT_MINUTES
    : SYSTEM_ADMIN_IDLE_TIMEOUT_MINUTES;
  const idleTimeoutMs = (Number.isFinite(configuredMinutes) && configuredMinutes > 0
    ? configuredMinutes
    : user.role === "superadmin" ? 30 : 120) * 60 * 1000;
  const now = new Date();
  const lastActivity = user.lastWebActivityAt instanceof Date
    ? user.lastWebActivityAt
    : payload.iat ? new Date(payload.iat * 1000) : now;
  const hasRecentUserActivity = req.get("X-User-Activity") === "true";

  if (now.getTime() - lastActivity.getTime() >= idleTimeoutMs) {
    res.status(401).json({
      code: "SESSION_IDLE_TIMEOUT",
      message: "Session expired due to inactivity. Please sign in again.",
    });
    return false;
  }

  if (hasRecentUserActivity && (!user.lastWebActivityAt || now.getTime() - lastActivity.getTime() >= ACTIVITY_WRITE_INTERVAL_MS)) {
    const filter = { _id: user._id };
    if (user.lastWebActivityAt) {
      filter.lastWebActivityAt = user.lastWebActivityAt;
    } else {
      filter.$or = [{ lastWebActivityAt: null }, { lastWebActivityAt: { $exists: false } }];
    }
    await SystemUser.updateOne(filter, { $set: { lastWebActivityAt: now } });
    user.lastWebActivityAt = now;
  }

  return true;
}

async function requireSystemAuth(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) return res.status(401).json({ message: "Missing auth token" });

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.tokenType !== "system") {
      return res.status(401).json({ message: "Invalid token type" });
    }

    const user = await SystemUser.findById(payload.sub).select("+password");
    if (!user) return res.status(401).json({ message: "User not found" });
    if (Number(payload.sessionVersion ?? 0) !== Number(user.sessionVersion || 0)) {
      return res.status(401).json({ message: "Session expired. Please sign in again." });
    }
    if (user.status === "suspended") {
      return res.status(403).json({ message: "Account suspended" });
    }
    if (!(await validateSessionActivity(user, payload, req, res))) return;

    let organization = null;
    if (user.organizationId) {
      organization = await Organization.findById(user.organizationId);
      if (!organization) {
        return res.status(403).json({ message: "Organization not found" });
      }
      const lifecycle = await refreshSubscriptionStateForOrganization(organization);
      organization = lifecycle.organization;
      if (organization.status === "suspended") {
        return res.status(403).json({ message: "Organization suspended" });
      }
    }

    req.systemUser = user;
    req.organization = organization;
    req.organizationId = organization ? organization._id : null;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

async function attachSystemAuthIfPresent(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) return next();

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.tokenType !== "system") {
      return res.status(401).json({ message: "Invalid token type" });
    }

    const user = await SystemUser.findById(payload.sub).select("+password");
    if (!user) return res.status(401).json({ message: "User not found" });
    if (Number(payload.sessionVersion ?? 0) !== Number(user.sessionVersion || 0)) {
      return res.status(401).json({ message: "Session expired. Please sign in again." });
    }
    if (user.status === "suspended") {
      return res.status(403).json({ message: "Account suspended" });
    }
    if (!(await validateSessionActivity(user, payload, req, res))) return;

    let organization = null;
    if (user.organizationId) {
      organization = await Organization.findById(user.organizationId);
      if (!organization) {
        return res.status(403).json({ message: "Organization not found" });
      }
      const lifecycle = await refreshSubscriptionStateForOrganization(organization);
      organization = lifecycle.organization;
      if (organization.status === "suspended") {
        return res.status(403).json({ message: "Organization suspended" });
      }
      if (organization.status === "expired") {
        return res.status(402).json({
          message: "Subscription expired",
          organizationStatus: organization.status,
          subscriptionStatus: lifecycle.subscription?.status || "expired",
          subscriptionEndDate: lifecycle.subscription?.endDate || null,
        });
      }
    }

    req.systemUser = user;
    req.organization = organization;
    req.organizationId = organization ? organization._id : null;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireRole(...allowedRoles) {
  return function roleGuard(req, res, next) {
    if (!req.systemUser) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (!allowedRoles.includes(req.systemUser.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
}

async function requireActiveOrganization(req, res, next) {
  try {
    if (req.systemUser?.role === "superadmin") return next();
    if (!req.organization) {
      return res.status(403).json({ message: "Organization required" });
    }

    const subscription = await getLatestSubscription(req.organization._id);
    if (!isSubscriptionUsable(req.organization, subscription)) {
      return res.status(402).json({
        message: req.organization.status === "expired" || subscription?.status === "expired"
          ? "Subscription expired"
          : "Subscription payment required",
        organizationStatus: req.organization.status,
        subscriptionStatus: subscription?.status || null,
        subscriptionEndDate: subscription?.endDate || null,
      });
    }
    next();
  } catch (err) {
    return res.status(500).json({ message: "Unable to verify subscription status" });
  }
}

module.exports = {
  getJwtSecret,
  validateSaasJwtSecret,
  signSystemToken,
  validateSessionActivity,
  requireSystemAuth,
  attachSystemAuthIfPresent,
  requireRole,
  requireActiveOrganization,
};
