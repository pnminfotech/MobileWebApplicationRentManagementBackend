// config/db.js  (COMMONJS VERSION)
const mongoose = require("mongoose");
const Form = require("../models/formModels");

async function dropObsoleteBedUniqueIndexes() {
  try {
    const indexes = await Form.collection.indexes();
    const obsolete = indexes.filter((idx) => {
      if (!idx.unique || !idx.key) return false;

      const keys = Object.keys(idx.key).sort();
      const isRoomBed = keys.length === 2 && keys[0] === "bedNo" && keys[1] === "roomNo";
      const isCategoryRoomBed =
        keys.length === 3 &&
        keys[0] === "bedNo" &&
        keys[1] === "category" &&
        keys[2] === "roomNo";

      return isRoomBed || isCategoryRoomBed;
    });

    for (const idx of obsolete) {
      await Form.collection.dropIndex(idx.name);
      console.log(`Dropped obsolete Form bed unique index: ${idx.name}`);
    }
  } catch (err) {
    console.error("Failed to clean obsolete Form bed indexes:", err.message);
  }
}

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI missing in .env");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      retryWrites: true,
    });
    console.log("DB Connected");
    // Create the scoped constraint first, then remove the obsolete global one.
    // If the new index cannot be built, keep the old index and fail startup.
    await Form.collection.createIndex({ organizationId: 1, srNo: 1 }, { unique: true, name: "organization_srno_unique" });
    const formIndexes = await Form.collection.indexes();
    for (const index of formIndexes) {
      if (index.unique && Object.keys(index.key || {}).length === 1 && index.key.srNo === 1) {
        await Form.collection.dropIndex(index.name);
        console.log(`Replaced global tenant serial index: ${index.name}`);
      }
    }
    await dropObsoleteBedUniqueIndexes();
  } catch (err) {
    console.error("DB connect failed:", err.message);
    throw err;
  }
}

module.exports = { connectDB };
