function bedNumberKey(bed) {
  return String(bed?.bedNo ?? "").trim().toLowerCase();
}

function uniqueRoomBeds(beds = []) {
  const seen = new Set();
  const list = Array.isArray(beds) ? beds : [];
  return list.filter((bed) => {
    const key = bedNumberKey(bed);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { bedNumberKey, uniqueRoomBeds };
