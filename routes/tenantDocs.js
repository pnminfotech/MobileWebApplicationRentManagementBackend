// routes/tenantDocs.js
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const ImageKit = require("imagekit");

const Form = require("../models/Form"); // ✅ confirm correct model path
const Invite = require("../models/Invite");
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const { scopedQuery, scopedCreate, scopedUpdate } = require("../utils/organizationScope");

const router = express.Router();

router.use(attachSystemAuthIfPresent);

/* ================== ImageKit ================== */
function hasImageKitConfig() {
  return (
    !!process.env.IMAGEKIT_PUBLIC_KEY &&
    !!process.env.IMAGEKIT_PRIVATE_KEY &&
    !!process.env.IMAGEKIT_URL_ENDPOINT
  );
}

function getImageKit() {
  if (!hasImageKitConfig()) return null;

  return new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  });
}

/* ================== Multer (memory) ================== */
const MAX_IMAGE_UPLOAD_SIZE = 2 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_UPLOAD_SIZE, files: 10 },
});

/* ================== Helpers ================== */
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

function isAllowedImageFile(file) {
  if (!file) return false;

  const mime = String(file.mimetype || "").toLowerCase();
  const name = String(file.originalname || "");
  const dotIndex = name.lastIndexOf(".");
  const ext = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";

  return ALLOWED_IMAGE_MIME_TYPES.has(mime) && ALLOWED_IMAGE_EXTENSIONS.has(ext);
}

async function compressUnder10KB(buf) {
  return sharp(buf)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
}

function cleanMoney(v) {
  const n = Number(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function cleanPhone(v) {
  const s = String(v ?? "").replace(/\D/g, "").slice(0, 10);
  return s || undefined;
}

// ✅ ignore empty fields + disallow rents edits here
function buildPatch(body) {
  const patch = {};

  for (const [k, v] of Object.entries(body || {})) {
    if (["formId", "inv", "srNo"].includes(k)) continue;
    if (v === undefined || v === null) continue;
    if (v === "" || v === "undefined") continue;
    patch[k] = v;
  }

  delete patch.rents;
  delete patch.rentPaid;
  delete patch.month;
  delete patch.date;

  // money
  ["baseRent", "rentAmount", "depositAmount"].forEach((f) => {
    if (patch[f] !== undefined) {
      const n = cleanMoney(patch[f]);
      if (n === undefined) delete patch[f];
      else patch[f] = n;
    }
  });

  // phone
  ["phoneNo", "relative1Phone", "relative2Phone"].forEach((f) => {
    if (patch[f] !== undefined) {
      const p = cleanPhone(patch[f]);
      if (!p) delete patch[f];
      else patch[f] = p;
    }
  });

  return patch;
}

/* ================== Route ================== */
router.post(
  "/with-docs",
  authAdmin,
  upload.fields([
    { name: "documents", maxCount: 10 },
    { name: "selfAadhar", maxCount: 10 },
    { name: "parentAadhar", maxCount: 10 },
    { name: "photo", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const canUseImagekit = hasImageKitConfig();
      const imagekit = canUseImagekit ? getImageKit() : null;

      let { formId, inv } = req.body;

      // ✅ If formId missing but invite token present → fetch usedByFormId
      let inviteDoc = null;
      if ((!formId || formId === "undefined") && inv) {
        const now = new Date();
        inviteDoc = await Invite.findOne({
          token: inv,
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        });

        if (!inviteDoc?.usedByFormId) {
          return res.status(400).json({ message: "Invalid/expired invite link" });
        }

        formId = String(inviteDoc.usedByFormId);
      }

      const updateData = buildPatch(req.body);

      // ✅ If invite exists → lock prefilled fields
      if (inv) {
        if (!inviteDoc) {
          const now = new Date();
          inviteDoc = await Invite.findOne({
            token: inv,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
          });
        }
        const lockedKeys = Object.keys(inviteDoc?.prefill || {});
        lockedKeys.forEach((k) => delete updateData[k]);
      }

      if (inv && (!formId || formId === "undefined")) {
        return res.status(400).json({ message: "Invalid/expired invite link" });
      }

      // ✅ Upload files to ImageKit and push into documents[]
      const genericFiles = req.files?.documents || [];
      const legacyFiles = [
        ...(req.files?.selfAadhar || []).map((file) => ({ file, relation: "Self Aadhaar Card" })),
        ...(req.files?.parentAadhar || []).map((file) => ({ file, relation: "Parent Aadhaar Card" })),
        ...(req.files?.photo || []).map((file) => ({ file, relation: "Tenant Photo" })),
      ];
      const rawRelations = req.body?.relations;
      const relations = Array.isArray(rawRelations) ? rawRelations : rawRelations ? [rawRelations] : [];
      const genericEntries = genericFiles.map((file, index) => ({ file, relation: String(relations[index] || "Document").trim() || "Document" }));
      const allEntries = [...genericEntries, ...legacyFiles];
      const allFiles = allEntries.map((entry) => entry.file);
      if (!allFiles.length && !req.body?.removeFileIds) {
        return res.status(400).json({
          message: "Select documents to upload or remove.",
        });
      }
      const invalidFiles = allFiles.filter((file) => !isAllowedImageFile(file));
      if (invalidFiles.length) {
        return res.status(400).json({
          message: "Only JPG, JPEG, and PNG files are allowed.",
          invalidFiles: invalidFiles.map((file) => file.originalname || "unknown"),
        });
      }

      const docsToAdd = [];

      async function uploadOne(file, relationLabel) {
        if (!file) return;

        if (!canUseImagekit) {
          docsToAdd.push({
            fileName: file.originalname,
            relation: relationLabel,
            url: null,
            fileId: null,
            filePath: null,
            contentType: file.mimetype,
            size: file.size,
            note: "ImageKit not configured",
          });
          return;
        }

        const safeBase = (file.originalname || "doc").replace(/[^\w.\-]/g, "_");

        // if image -> compress to webp
        let uploadBuffer = file.buffer;
        let contentType = file.mimetype;
        let uploadName = `${Date.now()}_${safeBase}`;

        if (/^image\//i.test(file.mimetype)) {
          uploadBuffer = await compressUnder10KB(file.buffer);
          contentType = "image/webp";
          uploadName = `${Date.now()}_${safeBase}.webp`;
        }

        const up = await imagekit.upload({
          file: uploadBuffer,
          fileName: uploadName,
          folder: "/rent-management-mobile-app/tenant_docs",
          useUniqueFileName: true,
        });

        // ✅ EXACTLY HERE your doc.url becomes:
        // "https://ik.imagekit.io/<id>/rent-management-mobile-app/tenant_docs/....webp"
        docsToAdd.push({
          fileName: file.originalname,
          relation: relationLabel,
          url: up.url,           // ✅ ImageKit direct URL
          fileId: up.fileId,     // ✅ ImageKit fileId (string)
          filePath: up.filePath, // ✅ ImageKit filePath (string)
          contentType,
          size: uploadBuffer.length,
        });
      }

      await Promise.all(allEntries.map(({ file, relation }) => uploadOne(file, relation)));

      let removeFileIds = req.body?.removeFileIds || [];
      if (typeof removeFileIds === "string") {
        try { removeFileIds = JSON.parse(removeFileIds); } catch { removeFileIds = [removeFileIds]; }
      }
      if (!Array.isArray(removeFileIds)) removeFileIds = [];
      removeFileIds = [...new Set(removeFileIds.map((id) => String(id || "").trim()).filter(Boolean))];
      if (inv && removeFileIds.length) {
        return res.status(403).json({ message: "Tenant invite links cannot remove existing documents." });
      }

      let savedForm;

      // ✅ UPDATE
      if (formId && formId !== "undefined") {
        savedForm = await Form.findOne(scopedQuery(req, { _id: formId }));
        if (!savedForm) return res.status(404).json({ message: "Form not found" });

        const existingDocuments = Array.isArray(savedForm.documents) ? savedForm.documents : [];
        const documentIdentity = (document) => String(document.fileId || document._id || "");
        const ownedRemoveIds = new Set(existingDocuments
          .filter((document) => removeFileIds.includes(documentIdentity(document)))
          .map(documentIdentity));
        if (ownedRemoveIds.size !== removeFileIds.length) {
          return res.status(400).json({ message: "One or more documents to remove were not found for this tenant." });
        }

        Object.assign(savedForm, scopedUpdate(req, updateData));
        savedForm.documents = [
          ...existingDocuments.filter((document) => !ownedRemoveIds.has(documentIdentity(document))),
          ...docsToAdd,
        ];
        await savedForm.save({ validateModifiedOnly: true });

        const imagekitFileIds = existingDocuments
          .filter((document) => ownedRemoveIds.has(documentIdentity(document)) && document.fileId)
          .map((document) => String(document.fileId));
        if (imagekitFileIds.length && imagekit) {
          const deletionResults = await Promise.allSettled(imagekitFileIds.map((fileId) => imagekit.deleteFile(fileId)));
          const failedImageKitDeletes = deletionResults.filter((result) => result.status === "rejected").length;
          if (failedImageKitDeletes) {
            console.error(`ImageKit cleanup failed for ${failedImageKitDeletes} document(s) after tenant record update.`);
          }
        }

        if (inv) {
          await Invite.updateOne(
            { token: inv, usedAt: null },
            { $set: { usedAt: new Date(), usedByFormId: savedForm._id } }
          );
        }

        return res.status(200).json({
          message: "Tenant details updated successfully",
          formId: savedForm._id,
          data: savedForm,
          imagekit: canUseImagekit,
        });
      }

      // ✅ CREATE (admin direct)
      const lastForm = await Form.findOne(scopedQuery(req)).sort({ srNo: -1 });
      const srNo = lastForm ? lastForm.srNo + 1 : 1;

      savedForm = await Form.create(scopedCreate(req, {
        ...updateData,
        srNo,
        documents: docsToAdd,
      }));

      return res.status(201).json({
        message: "Form saved successfully",
        formId: savedForm._id,
        data: savedForm,
        imagekit: canUseImagekit,
      });
    } catch (error) {
      console.error("Error in /with-docs:", error);
      res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;
