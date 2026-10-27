// Whisper Wheels store settings. Edit here, then publish.
// The price the customer is actually charged is set on your Whop plan;
// keep `price` below identical to it so the site never shows a different number.
window.WW_SHOP = {
  // Whop → your product → Pricing → copy the plan ID (starts with "plan_").
  // While this is empty the site shows "preorders opening shortly" + an email signup instead of checkout.
  whopPlanId: "plan_F5v6fUW7QfOIm",

  price: 29.99,          // USD, per kit
  maxQty: 4,             // largest number of kits in one order (one kit = one bin)
  shippingNote: "Free shipping within the US",
  // Shown next to every Preorder button. Keep it honest: if you don't have a date yet, leave the default.
  shipNote: "Ships with our first production run. We'll email your estimated ship date once production is scheduled."
};
