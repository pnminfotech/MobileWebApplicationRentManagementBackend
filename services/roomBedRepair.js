const Room = require("../models/Room");
const { uniqueRoomBeds } = require("../utils/roomBeds");

// Repairs older rooms that were saved before duplicate bed numbers were rejected.
// The first stored entry for each bed number is kept.
async function repairDuplicateRoomBeds(filter) {
  const rooms = await Room.find(filter).select("beds __v").lean();

  for (const room of rooms) {
    let current = room;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const uniqueBeds = uniqueRoomBeds(current.beds || []);
      if (uniqueBeds.length === (current.beds || []).length) break;

      const result = await Room.updateOne(
        { ...filter, _id: current._id, __v: current.__v },
        { $set: { beds: uniqueBeds }, $inc: { __v: 1 } }
      );
      if (result.modifiedCount === 1) break;

      current = await Room.findOne({ ...filter, _id: current._id }).select("beds __v").lean();
      if (!current) break;
      if (attempt === 2) throw new Error(`Unable to repair duplicate beds in room ${room._id}`);
    }
  }
}

module.exports = { repairDuplicateRoomBeds };
