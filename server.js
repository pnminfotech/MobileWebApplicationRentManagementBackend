// server.js (CommonJS)
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const { connectDB } = require("./config/db");
const { validateSaasJwtSecret } = require("./middleware/saasAuth");
const { startSubscriptionReminderJob } = require("./services/subscriptionReminderService");
const { startRentReminderSmsJob } = require("./services/rentReminderSmsService");

// Routers
const formRoutes = require("./routes/formRoutes");
const maintenanceRoutes = require("./routes/MaintRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const projectRoutes = require("./routes/Project");
const roomRoutes = require("./routes/roomRoutes");
const commercialRoutes = require("./routes/commercialRoutes");
const lightBillRoutes = require("./routes/lightBillRoutes");
const otherExpenseRoutes = require("./routes/otherExpenseRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const formWithDocsRoutes = require("./routes/formWithDocs");
const documentRoutes = require("./routes/documentRoutes");
const tenantRoutes = require("./routes/tenant");
const paymentRoutes = require("./routes/payments");
const leaveRoutes = require("./routes/leaveRoutes");
const adminNotificationsRouter = require("./routes/adminattendenceNotifications");
const adminLeaveRoutes = require("./routes/adminLeaveRoutes");
const tenantDocsRoutes = require("./routes/tenantDocs");
const invitesRouter = require("./routes/invites");
const saasRoutes = require("./routes/saas");
const saasPaymentRoutes = require("./routes/saasPayments");
const auditLogRoutes = require("./routes/auditLogRoutes");
const assistantRoutes = require("./routes/assistant");

const app = express();

// Trust forwarding headers only from a local reverse proxy such as Nginx.
// This lets authentication throttles use the real client IP without trusting
// spoofed X-Forwarded-For values from direct public requests.
app.set("trust proxy", "loopback");

// Never start a production API that would issue or accept SaaS JWTs with a
// missing, short, or development fallback secret.
if (process.env.NODE_ENV === "production") {
  validateSaasJwtSecret();
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://pnminfotech.com",
  "https://www.pnminfotech.com",
];

const envAllowedOrigins = String(
  process.env.CORS_ALLOWED_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    process.env.FRONTEND_ORIGIN ||
    ""
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...envAllowedOrigins])];

const corsOptions = {
  origin(origin, callback) {
    const isPrivateLanOrigin = /^https?:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)[^/]+(?::\d+)?$/i.test(
      String(origin || "")
    );
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      (process.env.NODE_ENV !== "production" && isPrivateLanOrigin)
    ) {
      return callback(null, true);
    }
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Origin",
    "X-Idempotency-Key",
    "X-Invite-Token",
    "X-Platform",
    "X-App-Version",
    "X-User-Activity",
  ],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || "10mb" }));

app.use("/api/tenant-docs", tenantDocsRoutes);
app.use("/api/saas", saasRoutes);
app.use("/api/saas/payments", saasPaymentRoutes);
app.use("/api/assistant", assistantRoutes);
app.get("/api/phonepe/checkout/:transactionId", saasPaymentRoutes.handlePhonePeCheckoutPage);
app.post("/api/phonepe/webhook", saasPaymentRoutes.handlePhonePeWebhook);
app.all("/api/phonepe/return", saasPaymentRoutes.handlePhonePeReturn);

app.get("/.well-known/appspecific/com.chrome.devtools.json", (_req, res) =>
  res.sendStatus(204)
);

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, env: process.env.NODE_ENV || "dev" })
);

// Routes
app.use("/api", require("./routes/notifications"));
app.use("/api/uploads", uploadRoutes);
app.use("/api", formRoutes);
app.use("/api", formWithDocsRoutes); // ✅ no trailing slash
app.use("/api", projectRoutes);

app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/commercial-units", commercialRoutes);
app.use("/api/light-bill", lightBillRoutes);
app.use("/api/other-expense", otherExpenseRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/tenant", tenantRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api", require("./routes/invoices"));
app.use("/api/invites", invitesRouter);
app.use("/api/tenant/leaves", leaveRoutes);

app.use("/api/staff-expenses", require("./routes/staffExpenseRoutes"));
app.use("/api/canteen-attendance", require("./routes/canteenAttendanceRoutes"));
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/admin", adminLeaveRoutes);
app.use("/api", require("./routes/tenantAttendance"));
app.use("/api/admin", adminNotificationsRouter);

const PORT = process.env.PORT || 8000;

async function startServer() {
  await connectDB();
  startSubscriptionReminderJob();
  startRentReminderSmsJob();
  app.listen(PORT, () => {
    console.log(`✅ Server running: http://localhost:${PORT}`);
    console.log(`✅ Health:        http://localhost:${PORT}/api/health`);
  });
}

startServer().catch((error) => {
  console.error("Backend startup failed:", error?.message || error);
  process.exit(1);
});
