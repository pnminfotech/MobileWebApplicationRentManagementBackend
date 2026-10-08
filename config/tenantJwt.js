const IS_PRODUCTION = process.env.NODE_ENV === "production";

function getTenantJwtSecret() {
  const secret = process.env.TENANT_JWT_SECRET || (!IS_PRODUCTION && (
    process.env.JWT_SECRET || process.env.JWT_TOKEN || "dev_secret"
  ));

  if (!secret) {
    throw new Error("TENANT_JWT_SECRET must be configured before tenant authentication can be used.");
  }
  if (IS_PRODUCTION && Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("TENANT_JWT_SECRET must be at least 32 bytes in production.");
  }
  return secret;
}

function validateTenantJwtSecret() {
  getTenantJwtSecret();
}

module.exports = { getTenantJwtSecret, validateTenantJwtSecret };
