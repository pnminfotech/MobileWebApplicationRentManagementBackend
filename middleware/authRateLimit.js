const crypto = require("crypto");

const MAX_BUCKETS = 20000;
const buckets = new Map();

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function pruneExpired(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function createAuthRateLimit({ name, windowMs, max, keyFromRequest, countSuccessfulRequests = false }) {
  return function authRateLimit(req, res, next) {
    const identity = keyFromRequest(req);
    if (!identity) return next();

    const now = Date.now();
    const key = `${name}:${digest(identity)}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= MAX_BUCKETS) pruneExpired(now);
      if (buckets.size >= MAX_BUCKETS) {
        return res.status(503).json({ message: "Authentication is temporarily unavailable. Please try again later." });
      }
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count >= max) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ message: "Too many attempts. Please try again later." });
    }

    // Reserve an attempt before the handler runs so concurrent requests cannot
    // all pass the same remaining slot. Successful requests release the slot;
    // failed authentication attempts remain counted until the window expires.
    bucket.count += 1;
    res.once("finish", () => {
      if (res.statusCode < 400 && !countSuccessfulRequests) {
        const current = buckets.get(key);
        if (current === bucket) current.count = Math.max(0, current.count - 1);
      }
    });

    next();
  };
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function accountIdentifier(req) {
  return String(req.body?.email || req.body?.loginId || "").trim().toLowerCase();
}

function resetTokenIdentifier(req) {
  const token = String(req.body?.token || "").trim();
  return token ? digest(token) : "";
}

function challengeIdentifier(req) {
  return String(req.body?.challengeId || "").trim();
}

module.exports = {
  createAuthRateLimit,
  requestIp,
  accountIdentifier,
  resetTokenIdentifier,
  challengeIdentifier,
};
