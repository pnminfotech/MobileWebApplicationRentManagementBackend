const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const ImageKit = require("imagekit");
const Organization = require("../models/Organization");

const router = express.Router();
const documentKinds = new Set(["logo", "photo", "aadhaar", "pan"]);
const maxFileSize = 5 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFileSize, files: 1 } });

function imageKitClient() {
  const { IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT } = process.env;
  if (!IMAGEKIT_PUBLIC_KEY || !IMAGEKIT_PRIVATE_KEY || !IMAGEKIT_URL_ENDPOINT) return null;
  return new ImageKit({
    publicKey: IMAGEKIT_PUBLIC_KEY,
    privateKey: IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: IMAGEKIT_URL_ENDPOINT,
  });
}

function signedDocuments(organization, imagekit) {
  const stored = organization?.ownerDocuments || {};
  return Object.fromEntries([...documentKinds].map((kind) => {
    const item = stored[kind];
    return [kind, item?.filePath ? {
      url: imagekit.url({ path: item.filePath, signed: true, expireSeconds: 3600 }),
      originalName: item.originalName,
      mimeType: item.mimeType,
      uploadedAt: item.uploadedAt,
    } : null];
  }));
}

function validateKind(req, res, next) {
  if (!documentKinds.has(req.params.kind)) {
    return res.status(400).json({ message: "Choose owner photo, Aadhaar card, or PAN card." });
  }
  next();
}

function receiveFile(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "The file must be 5 MB or smaller."
      : "Could not read this file. Select one JPG, PNG, or PDF file.";
    return res.status(400).json({ message });
  });
}

router.get("/", async (req, res) => {
  try {
    const organization = await Organization.findById(req.organizationId).select("+ownerDocuments").lean();
    if (!organization) return res.status(404).json({ message: "Business not found." });
    const imagekit = imageKitClient();
    if (!imagekit && Object.values(organization.ownerDocuments || {}).some((item) => item?.filePath)) {
      return res.status(503).json({ message: "Document storage is unavailable." });
    }
    return res.json({ documents: imagekit ? signedDocuments(organization, imagekit) : { logo: null, photo: null, aadhaar: null, pan: null } });
  } catch (error) {
    console.error("Load owner documents failed:", error);
    return res.status(500).json({ message: "Could not load owner documents." });
  }
});

router.put("/:kind", validateKind, receiveFile, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Choose a file to upload." });
  const mimeType = String(req.file.mimetype || "").toLowerCase();
  const name = String(req.file.originalname || "");
  const isImage = ["image/jpeg", "image/png", "image/webp"].includes(mimeType) && /\.(jpe?g|png|webp)$/i.test(name);
  const isPdf = !["photo", "logo"].includes(req.params.kind) && mimeType === "application/pdf" && /\.pdf$/i.test(name) &&
    req.file.buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (!isImage && !isPdf) {
    return res.status(400).json({ message: ["photo", "logo"].includes(req.params.kind) ? "Choose a JPG, PNG, or WEBP image." : "Choose a JPG, PNG, or PDF file." });
  }
  const imagekit = imageKitClient();
  if (!imagekit) return res.status(503).json({ message: "Document storage is unavailable." });

  let uploaded;
  try {
    const storedFile = isPdf ? req.file.buffer : await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1800, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    uploaded = await imagekit.upload({
      file: storedFile,
      fileName: `${req.params.kind}-${Date.now()}.${isPdf ? "pdf" : "webp"}`,
      folder: `/rent-management-mobile-app/owner-documents/${req.organizationId}`,
      useUniqueFileName: true,
      isPrivateFile: true,
    });
    const current = await Organization.findById(req.organizationId).select("+ownerDocuments").lean();
    if (!current) {
      await imagekit.deleteFile(uploaded.fileId).catch(() => {});
      return res.status(404).json({ message: "Business not found." });
    }
    const previousFileId = current.ownerDocuments?.[req.params.kind]?.fileId;
    const record = {
      fileId: uploaded.fileId,
      filePath: uploaded.filePath,
      originalName: name.slice(0, 150),
      mimeType: isPdf ? "application/pdf" : "image/webp",
      uploadedAt: new Date(),
    };
    await Organization.updateOne(
      { _id: req.organizationId },
      { $set: { [`ownerDocuments.${req.params.kind}`]: record } }
    );
    if (previousFileId && previousFileId !== uploaded.fileId) {
      imagekit.deleteFile(previousFileId).catch((error) => console.error("Old owner document cleanup failed:", error));
    }
    return res.json({ document: signedDocuments({ ownerDocuments: { [req.params.kind]: record } }, imagekit)[req.params.kind] });
  } catch (error) {
    if (uploaded?.fileId) imagekit.deleteFile(uploaded.fileId).catch(() => {});
    console.error("Save owner document failed:", error);
    return res.status(500).json({ message: "Could not save this owner document." });
  }
});

router.delete("/:kind", validateKind, async (req, res) => {
  try {
    const current = await Organization.findById(req.organizationId).select("+ownerDocuments").lean();
    if (!current) return res.status(404).json({ message: "Business not found." });
    const fileId = current.ownerDocuments?.[req.params.kind]?.fileId;
    if (!fileId) return res.json({ removed: true });
    await Organization.updateOne(
      { _id: req.organizationId },
      { $unset: { [`ownerDocuments.${req.params.kind}`]: 1 } }
    );
    const imagekit = imageKitClient();
    if (imagekit) imagekit.deleteFile(fileId).catch((error) => console.error("Owner document cleanup failed:", error));
    return res.json({ removed: true });
  } catch (error) {
    console.error("Remove owner document failed:", error);
    return res.status(500).json({ message: "Could not remove this owner document." });
  }
});

module.exports = router;
