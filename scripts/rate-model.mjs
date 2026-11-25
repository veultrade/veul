// Margin model for payback tiers and referral (Stockup). Pure arithmetic, no network.
// Run: node scripts/rate-model.mjs
// All inputs below are assumptions, written down so they can be argued with.

const FEE = 0.5; // % of every trade

// Volume-weighted tier mix: share of monthly volume coming from traders in each tier.
// Meme trading is concentrated, so the top tiers carry a large share of volume.
const MIX = { Base: 0.3, Silver: 0.25, Gold: 0.25, Black: 0.2 };
const REFERRED_SHARE = 0.3; // share of volume from referred traders
const VOLUME_PER_USER = 2000; // USD per active trader per month (assumption)

// Fixed monthly costs in USD. Privy: free to 499 MAU, $299 to 2,499, $499 to 9,999 (third-party figures, check privy.io).
const privy = (users) => (users < 500 ? 0 : users < 2500 ? 299 : users < 10000 ? 499 : 1500);
const FIXED = { cloudflare: 5, supabase: 25, alchemy: 0, domain: 2 };
const PER_USER = 0.05; // claim and payout gas per active user per month

const PLANS = {
  "Draft (in the app now)": { tiers: { Base: 0.25, Silver: 0.28, Gold: 0.32, Black: 0.35 }, referral: 0.05 },
  "Flat 0.25, no tiers": { tiers: { Base: 0.25, Silver: 0.25, Gold: 0.25, Black: 0.25 }, referral: 0.05 },
  "Proposed (cap at 0.30)": { tiers: { Base: 0.25, Silver: 0.27, Gold: 0.29, Black: 0.3 }, referral: 0.05 },
};

const VOLUMES = [500_000, 2_000_000, 6_000_000, 20_000_000];
const usd = (n) => (n < 0 ? "-$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");

for (const [name, plan] of Object.entries(PLANS)) {
  const payback = Object.entries(MIX).reduce((sum, [tier, share]) => sum + share * plan.tiers[tier], 0);
  const giveback = payback + REFERRED_SHARE * plan.referral;
  const kept = FEE - giveback;
  const worst = FEE - plan.tiers.Black - plan.referral;
  console.log(`\n## ${name}`);
  console.log(`blended payback ${payback.toFixed(3)}%, with referral ${giveback.toFixed(3)}%, kept ${kept.toFixed(3)}%, worst case (Black + referred) kept ${worst.toFixed(2)}%`);
  for (const volume of VOLUMES) {
    const users = Math.round(volume / VOLUME_PER_USER);
    const costs = Object.values(FIXED).reduce((a, b) => a + b, 0) + privy(users) + users * PER_USER;
    const revenue = (volume * kept) / 100;
    console.log(`  volume ${usd(volume)}/mo, ~${users} users: kept ${usd(revenue)}, costs ${usd(costs)}, profit ${usd(revenue - costs)}, paid back to traders ${usd((volume * giveback) / 100)}`);
  }
}

// Break-even monthly volume for each plan with the Privy step at 500 users.
console.log("\n## Wash-trading check (self-referral, Black tier)");
for (const [name, plan] of Object.entries(PLANS)) {
  const back = plan.tiers.Black + plan.referral;
  console.log(`  ${name}: trader pays ${FEE}% + pool fee (0.3–1%), gets ${back.toFixed(2)}% back -> loses at least ${(FEE - back).toFixed(2)}% + pool fee per trade`);
}
