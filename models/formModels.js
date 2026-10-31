// const mongoose = require('mongoose');

// const formSchema = new mongoose.Schema(
//   {
//     // Sr No (Unique)
//     srNo: { type: Number, unique: true, required: true },

//     // Basic info
//     name: { type: String, required: true },
//     joiningDate: { type: Date, required: true },
//     roomNo: { type: String },
//     depositAmount: { type: Number, required: true },

//     // Main address
//     address: { type: String, required: true },

//     // Phone as string (keeps leading zeros)
//     phoneNo: { type: String, required: true },

//     // Relative 1
//     relative1Name: { type: String, default: "" },
//     relative1Address: { type: String, default: "" },
//     relative1Phone: { type: String, default: "" },

//     // Relative 2
//     relative2Name: { type: String, default: "" },
//     relative2Address: { type: String, default: "" },
//     relative2Phone: { type: String, default: "" },

//     floorNo: { type: String },
//     bedNo: { type: String },
//     companyAddress: { type: String },

//     baseRent: { type: Number },

//     // ✅ Rents array — FIXED: month is now optional (was required)
//     rents: {
//       type: [
//         {
//           rentAmount: { type: Number, default: 0 }, // paid amount
//           date: { type: Date },                     // actual payment date

//           // IMPORTANT FIX ↓↓↓
//           month: { type: String, default: null },   // Was required:true → now safe

//           paymentMode: {
//             type: String,
//             enum: ["Cash", "Online"],
//             default: "Cash",
//           },
//         },
//       ],
//       default: [],
//     },

//     // Leave date (string used by your frontend logic)
//     leaveDate: { type: String },

//     // Documents
//     documents: [
//       {
//         fileName: { type: String },

//         // Legacy disk link
//         url: { type: String },

//         // New DB fields
//         fileId: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentFile" },
//         contentType: { type: String },
//         size: { type: Number },
//         relation: {
//           type: String,
//           enum: ["Self", "Father", "Mother", "Husband", "Sister", "Brother"],
//           default: "Self",
//         },
//       },
//     ],
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model('Form', formSchema);


const mongoose = require("mongoose");

const formSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    srNo: { type: Number, required: true },

    name: { type: String, required: true },
    joiningDate: { type: Date, required: true },
    joiningDateChangeUsed: { type: Boolean, default: false },
    propertyType: {
      type: String,
      enum: ["bed", "room", "shop"],
      default: "bed",
      index: true,
    },
    category: { type: String },
    hasWing: { type: Boolean, default: false },
    wingName: { type: String, default: "" },
    roomId: { type: String },
    roomNo: { type: String },
    depositAmount: { type: Number, required: true },

    // main address stays
    address: { type: String, required: false },
    pincode: { type: String },
    city: { type: String },
    state: { type: String },
    houseNo: { type: String },
    nearbyPlace: { type: String },
    relativeAddress1: { type: String },

    phoneNo: { type: Number, required: true },
    intakeStatus: {
      type: String,
      enum: ["submitted", "pending_tenant"],
      default: "submitted",
      index: true,
    },
    pendingAssignmentOrigin: {
      type: String,
      enum: ["", "quick_add", "returning_tenant"],
      default: "",
    },

    // ⛔ removed address text fields for relatives as per your request
    // relativeAddress1: { type: String },
    // relativeAddress2: { type: String },

    // ✅ relative contact triplets (relation + name + phone)
    relative1Relation: {
      type: String,
      enum: ["Self", "Sister", "Brother", "Father", "Husband", "Mother"],
      default: "Self",
    },
    relative1Name: { type: String, default: "" },
    relative1Phone: { type: String, default: "" },

    relative2Relation: {
      type: String,
      enum: ["Self", "Sister", "Brother", "Father", "Husband", "Mother"],
      default: "Self",
    },
    relative2Name: { type: String, default: "" },
    relative2Phone: { type: String, default: "" },

    floorNo: { type: String },
    bedNo: { type: String },
    familyMembers: { type: Number, default: 0 },
    familyMale: { type: Number, default: 0 },
    familyFemale: { type: Number, default: 0 },
    familyChildren: { type: Number, default: 0 },
    otherFamilyMembers: {
      type: [{ name: { type: String, default: "" }, age: { type: String, default: "" }, occupation: { type: String, default: "" }, phone: { type: String, default: "" } }],
      default: [],
    },
    passportNo: { type: String, default: "" },
    panCardNo: { type: String, default: "" },
    aadhaarCardNo: { type: String, default: "" },
    natureOfWork: { type: String, default: "" },
    previousAddress: { type: String, default: "" },
    officeName: { type: String, default: "" },
    officeAddress: { type: String, default: "" },
    officeMobileNo: { type: String, default: "" },
    hasCanteen: { type: Boolean, default: false },
    canteenPlanType: {
      type: String,
      enum: ["", "full_package", "per_meal", "meal_package"],
      default: "",
    },
    canteenStartDate: { type: Date },
    canteenMonthlyAmount: { type: Number, default: 0 },
    canteenIncludedMeals: {
      type: [String],
      enum: ["breakfast", "lunch", "dinner"],
      default: [],
    },
    canteenMealPrices: {
      breakfast: { type: Number, default: 0, min: 0 },
      lunch: { type: Number, default: 0, min: 0 },
      dinner: { type: Number, default: 0, min: 0 },
    },
    canteenStatusHistory: {
      type: [{ enabled: { type: Boolean, required: true }, effectiveFrom: { type: Date, required: true } }],
      default: [],
    },
    shopName: { type: String },
    shopBusiness: { type: String },
    companyAddress: { type: String },
    dateOfJoiningCollege: { type: Date,  },
    dob: { type: Date },

    baseRent: { type: Number },
    // Quick-added tenant rent can differ from the assigned unit's default price.
    tenantRentOverride: { type: Boolean, default: false },
    firstRentStatus: {
  type: String,
  enum: ["ADVANCE_PAID", "NOT_PAID"],
  default: "NOT_PAID",
},
firstRentMonth: { type: String }, // e.g. "Jan-26"

    rentHistory: {
      type: [
        {
          effectiveFrom: { type: Date },
          roomNo: { type: String },
          bedNo: { type: String },
          baseRent: { type: Number },
          rentAmount: { type: Number },
          previousRoomNo: { type: String },
          previousBedNo: { type: String },
          previousBaseRent: { type: Number },
          previousRentAmount: { type: Number },
          source: { type: String },
        },
      ],
      default: [],
    },

    rents: [
      {
        rentAmount: { type: Number, required: true },
        discountAmount: { type: Number, default: 0 },
        canteenAmount: { type: Number, default: 0 },
        lightBillAmount: { type: Number, default: 0 },
        totalAmount: { type: Number, default: 0 },
        date: { type: Date, required: true }, // payment date
        month: { type: String, required: true }, // "Dec-25"
        paymentMode: {
          type: String,
          enum: ["Cash", "Online"],
          // default: "Cash",
          required: true,
        },
        utr: { type: String, default: "" },
        note: { type: String, default: "" },
        receiptUrl: { type: String, default: "" },
        payments: {
          type: [
            {
              amount: { type: Number, required: true },
              rentAmount: { type: Number, default: 0 },
              discountAmount: { type: Number, default: 0 },
              canteenAmount: { type: Number, default: 0 },
              lightBillAmount: { type: Number, default: 0 },
              extraAmount: { type: Number, default: 0 },
              date: { type: Date, required: true },
              paymentMode: {
                type: String,
                enum: ["Cash", "Online"],
                required: true,
              },
              utr: { type: String, default: "" },
              note: { type: String, default: "" },
              receiptUrl: { type: String, default: "" },
            },
          ],
          default: [],
        },
      },
    ],

    paymentAudit: {
      type: [
        {
          action: { type: String, default: "edit" },
          changedAt: { type: Date, default: Date.now },
          changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SystemUser", default: null },
          previous: { type: mongoose.Schema.Types.Mixed },
          next: { type: mongoose.Schema.Types.Mixed },
        },
      ],
      default: [],
    },

    leaveDate: { type: String },
    unitRemoval: {
      removedAt: { type: Date, default: null },
      effectiveDate: { type: String, default: "" },
      propertyType: { type: String, default: "" },
      unitId: { type: String, default: "" },
      roomNo: { type: String, default: "" },
      bedNo: { type: String, default: "" },
      label: { type: String, default: "" },
      reason: { type: String, default: "" },
      removedBy: { type: String, default: "" },
    },
    leaveSettlement: {
      deductFromDeposit: { type: Boolean, default: false },
      selectedMonths: [{ type: String }],
      deductions: [
        {
          month: { type: String },
          amount: { type: Number, default: 0 },
          days: { type: Number, default: 0 },
          dailyRent: { type: Number, default: 0 },
          cycleRange: { type: String, default: "" },
        },
      ],
      grossDeposit: { type: Number, default: 0 },
      totalDeduction: { type: Number, default: 0 },
      refundableDeposit: { type: Number, default: 0 },
      amountDueFromTenant: { type: Number, default: 0 },
      note: { type: String, default: "" },
    },

    // ✅ Updated: supports both legacy disk URLs and DB-backed files
  documents: [
  {
    fileName: { type: String },

    // ✅ ImageKit direct URL
    url: { type: String },

    // ✅ ImageKit fileId is STRING (not ObjectId)
    fileId: { type: String },

    // ✅ Optional but useful (ImageKit filePath)
    filePath: { type: String },

    contentType: { type: String },
    size: { type: Number },

    // keep relation simple (or keep your enum if you want)
    relation: { type: String, default: "Document" },
    photoTransform: {
      rotate: { type: Number, default: 0 },
      flipX: { type: Boolean, default: false },
      flipY: { type: Boolean, default: false },
    },
  },
],

  },
  { timestamps: true }
);

formSchema.index({ organizationId: 1, roomNo: 1, bedNo: 1, leaveDate: 1 });
formSchema.index({ organizationId: 1, srNo: 1 }, { unique: true, name: "organization_srno_unique" });
formSchema.index({ organizationId: 1, createdAt: -1 });

// Keep a separate stay record so unit history survives tenant moves and removal.
const { syncUnitStay } = require("../services/unitHistory");
const historyFields = new Set([
  "roomId", "roomNo", "bedNo", "propertyType", "category", "wingName", "floorNo",
  "intakeStatus", "leaveDate", "shiftEffectiveFrom", "name", "phoneNo", "baseRent", "depositAmount", "joiningDate",
  "address", "houseNo", "nearbyPlace", "city", "state", "pincode", "firstRentStatus", "shopName", "shopBusiness", "familyMembers",
  "familyMale", "familyFemale", "familyChildren", "otherFamilyMembers", "passportNo", "panCardNo", "aadhaarCardNo", "natureOfWork", "previousAddress", "officeName", "officeAddress", "officeMobileNo",
  "dob", "relative1Relation", "relative1Name", "relative1Phone", "relative2Relation", "relative2Name", "relative2Phone", "companyAddress", "hasCanteen",
  "srNo", "dateOfJoiningCollege", "relativeAddress1", "relativeAddress2", "canteenPlanType", "canteenStartDate", "canteenMonthlyAmount", "canteenIncludedMeals", "canteenMealPrices",
]);
const trackUpdate = (update = {}) => Object.entries(update).some(([key, value]) => {
  if (key.startsWith("$") && value && typeof value === "object") {
    return Object.keys(value).some((field) => historyFields.has(field.split(".")[0]));
  }
  return historyFields.has(key.split(".")[0]);
});
const reportHistoryError = (error) => console.error("Unable to update unit history:", error.message);

formSchema.pre("save", async function () {
  this.$locals.trackUnitHistory = this.isNew || [...historyFields].some((field) => this.isModified(field));
  delete this.$locals.unitHistoryBefore;
  if (!this.$locals.trackUnitHistory || this.isNew) return;
  try {
    let query = this.constructor.findById(this._id).lean();
    if (this.$session()) query = query.session(this.$session());
    this.$locals.unitHistoryBefore = await query;
  } catch (error) { reportHistoryError(error); }
});
formSchema.post("save", async function (doc) {
  if (!doc.$locals.trackUnitHistory) return;
  try { await syncUnitStay(doc.$locals.unitHistoryBefore || null, doc.toObject(), doc.$session()); }
  catch (error) { reportHistoryError(error); }
});
formSchema.pre("findOneAndUpdate", async function () {
  if (!trackUpdate(this.getUpdate())) return;
  try {
    let query = this.model.findOne(this.getQuery()).lean();
    if (this.getOptions().session) query = query.session(this.getOptions().session);
    this._unitHistoryBefore = await query;
    this._trackUnitHistory = true;
  } catch (error) { reportHistoryError(error); }
});
formSchema.post("findOneAndUpdate", async function (doc) {
  if (!doc || !this._trackUnitHistory) return;
  try {
    let query = this.model.findById(doc._id).lean();
    if (this.getOptions().session) query = query.session(this.getOptions().session);
    const updated = await query;
    if (updated) await syncUnitStay(this._unitHistoryBefore, updated, this.getOptions().session);
  } catch (error) { reportHistoryError(error); }
});
formSchema.pre("deleteOne", { document: false, query: true }, async function () {
  try {
    let query = this.model.findOne(this.getQuery()).lean();
    if (this.getOptions().session) query = query.session(this.getOptions().session);
    this._unitHistoryBefore = await query;
  }
  catch (error) { reportHistoryError(error); }
});
formSchema.post("deleteOne", { document: false, query: true }, async function (result) {
  if (!result?.deletedCount || !this._unitHistoryBefore) return;
  try { await syncUnitStay(this._unitHistoryBefore, null, this.getOptions().session); }
  catch (error) { reportHistoryError(error); }
});
formSchema.post("findOneAndDelete", async function (doc) {
  if (!doc) return;
  try { await syncUnitStay(typeof doc.toObject === "function" ? doc.toObject() : doc, null, this.getOptions().session); }
  catch (error) { reportHistoryError(error); }
});

module.exports = mongoose.models.Form || mongoose.model("Form", formSchema);
