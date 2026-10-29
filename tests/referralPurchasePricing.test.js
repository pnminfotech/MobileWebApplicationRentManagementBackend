const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateSubscriptionPricing, calculatePendingSubscriptionPricing } = require("../utils/saas");

const plan = {
  durationMonths: 6,
  baseAmount: 0,
  unitPricing: { bedMonthly: 20, roomMonthly: 30, shopMonthly: 30 },
  discountPercent: 5,
};

test("referral discount applies after the plan discount and preserves the reward snapshot", () => {
  const pricing = calculateSubscriptionPricing(
    plan,
    { beds: 2, rooms: 2, shops: 0 },
    { code: "FRIEND123", ownerOrganizationId: "owner-id", discountPercent: 10, rewardCoins: 100 }
  );

  assert.equal(pricing.subtotal, 600);
  assert.equal(pricing.planDiscountAmount, 30);
  assert.equal(pricing.referralDiscountAmount, 57);
  assert.equal(pricing.payableAmount, 513);
  assert.equal(pricing.referralCode, "FRIEND123");
  assert.equal(pricing.referralOwnerOrganizationId, "owner-id");
  assert.equal(pricing.referralRewardCoins, 100);
});

test("a code with no buyer discount keeps the correct payable amount", () => {
  const pricing = calculateSubscriptionPricing(
    plan,
    { beds: 2, rooms: 2, shops: 0 },
    { code: "FRIEND123", discountPercent: 0, rewardCoins: 100 }
  );

  assert.equal(pricing.referralDiscountAmount, 0);
  assert.equal(pricing.payableAmount, 570);
});

test("an interrupted checkout can replace its referral without losing the original plan discount", () => {
  const pending = {
    amount: 470,
    pricing: { subtotal: 600, planDiscountAmount: 30, referralDiscountAmount: 50, walletCoinsUsed: 50 },
  };
  const pricing = calculatePendingSubscriptionPricing(pending, {
    code: "NEWCODE", discountPercent: 10, rewardCoins: 100,
  });

  assert.equal(pricing.subtotal, 600);
  assert.equal(pricing.planDiscountAmount, 30);
  assert.equal(pricing.referralDiscountAmount, 57);
  assert.equal(pricing.payableAmount, 513);
  assert.equal(calculatePendingSubscriptionPricing(pending).payableAmount, 570);
});
