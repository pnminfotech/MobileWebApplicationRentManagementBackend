// models/Room.js
const mongoose = require("mongoose");
const { uniqueRoomBeds } = require("../utils/roomBeds");

const BedSchema = new mongoose.Schema(
  {
    bedNo: { type: String, required: true },
    bedCategory: { type: String, default: "" }, // ✅ NEW field
    price: { type: Number, default: null },     // optional
  },
  { _id: false }
);

const RoomSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    propertyType: {
      type: String,
      enum: ["bed", "room", "shop"],
      default: "bed",
    },
    category: { type: String, required: true }, // e.g. Fuge Building, Boys, Girls
    roomCategory: { type: String, default: "" },
    hasWing: { type: Boolean, default: false },
    wingName: { type: String, default: "" },
    floorNo: { type: String, required: true },  // e.g. Ground, 1, 2nd, Basement
    flatType: { type: String, default: "" },
    roomNo: { type: String, required: true },
    meterNo: { type: String, default: "" },
    lastMeterReading: { type: Number, default: null },
    beds: { type: [BedSchema], default: [] },
    isPlaceholder: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, optimisticConcurrency: true }
);

RoomSchema.path("beds").validate(
  (beds) => Array.isArray(beds) && uniqueRoomBeds(beds).length === beds.length,
  "Bed numbers must be unique within a room"
);

RoomSchema.index({
  organizationId: 1,
  propertyType: 1,
  category: 1,
  floorNo: 1,
  roomNo: 1,
  wingName: 1,
});

module.exports = mongoose.model("Room", RoomSchema);
