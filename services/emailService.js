const nodemailer = require("nodemailer");

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!hasSmtpConfig()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendPasswordResetEmail({ to, name, resetUrl, expiresMinutes = 15 }) {
  const transporter = getTransporter();
  if (!transporter) {
    const error = new Error("SMTP is not configured");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const appName = process.env.APP_NAME || "Rent Management";

  await transporter.sendMail({
    from,
    to,
    subject: `${appName} password reset`,
    text: [
      `Hello ${name || "there"},`,
      "",
      `We received a request to reset your ${appName} password.`,
      `Open this link within ${expiresMinutes} minutes to set a new password:`,
      resetUrl,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17202A">
        <h2>${appName} password reset</h2>
        <p>Hello ${name || "there"},</p>
        <p>We received a request to reset your password.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:700">
            Reset password
          </a>
        </p>
        <p>This link expires in ${expiresMinutes} minutes.</p>
        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
}

async function sendSuperadminLoginCode({ to, name, code, expiresMinutes = 10 }) {
  const transporter = getTransporter();
  if (!transporter) {
    const error = new Error("SMTP is not configured");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const appName = process.env.APP_NAME || "Rent Management";

  await transporter.sendMail({
    from,
    to,
    subject: `${appName} superadmin sign-in code`,
    text: [
      `Hello ${name || "Superadmin"},`,
      "",
      `Your superadmin sign-in code is: ${code}`,
      `It expires in ${expiresMinutes} minutes and can only be used once.`,
      "",
      "If you did not try to sign in, change your password and secure your email account.",
    ].join("\n"),
  });
}

async function sendSuperadminEmailChangeCode({ to, name, code, newEmail, expiresMinutes = 10 }) {
  const transporter = getTransporter();
  if (!transporter) {
    const error = new Error("SMTP is not configured");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const appName = process.env.APP_NAME || "Rent Management";
  await transporter.sendMail({
    from,
    to,
    subject: `${appName} email change verification`,
    text: [
      `Hello ${name || "Superadmin"},`,
      "",
      `Your code to change the superadmin sign-in email to ${newEmail} is: ${code}`,
      `It expires in ${expiresMinutes} minutes and can only be used once.`,
      "",
      "If you did not request this change, ignore this email and secure your account.",
    ].join("\n"),
  });
}

async function sendSuperadminEmailChangedNotice({ to, name, newEmail }) {
  const transporter = getTransporter();
  if (!transporter) return;

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const appName = process.env.APP_NAME || "Rent Management";
  await transporter.sendMail({
    from,
    to,
    subject: `${appName} superadmin email changed`,
    text: [
      `Hello ${name || "Superadmin"},`,
      "",
      `The sign-in email for your superadmin account was changed to ${newEmail}.`,
      "All active sessions were signed out. If you did not make this change, reset your password and contact support immediately.",
    ].join("\n"),
  });
}

async function sendBasicEmail({ to, subject, text, html }) {
  const transporter = getTransporter();
  if (!transporter) {
    const error = new Error("SMTP is not configured");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  hasSmtpConfig,
  sendBasicEmail,
  sendPasswordResetEmail,
  sendSuperadminLoginCode,
  sendSuperadminEmailChangeCode,
  sendSuperadminEmailChangedNotice,
};
