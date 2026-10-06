const SystemUser = require("../models/SystemUser");

async function requireSystemSecurityPin(req, res, next) {
  if (req.systemUser?.role !== "system_admin") return next();
  const pin = String(req.body?.securityPin || "").trim();
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ message: "Enter your 4 to 8 digit security PIN." });
  try {
    const user = await SystemUser.findById(req.systemUser._id).select("+securityPin");
    if (!user?.securityPin) return res.status(428).json({ message: "Set up your security PIN before deleting data." });
    if (!(await user.compareSecurityPin(pin))) return res.status(403).json({ message: "Incorrect security PIN." });
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireSystemSecurityPin };
