module.exports = function requireLegacyDataAccess(req, res, next) {
  if (req.systemUser) {
    return res.status(403).json({
      message: "This legacy data area is unavailable to organization accounts until organization-level access is implemented.",
    });
  }

  if (!req.admin) {
    return res.status(401).json({ message: "Authentication required" });
  }

  next();
};
