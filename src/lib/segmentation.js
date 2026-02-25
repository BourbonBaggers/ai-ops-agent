/**
 * Segmentation helper for per-contact candidate selection at send time.
 *
 * Rules:
 *   Cold rep (order_count === 0):
 *     80% probability → top candidate
 *     20% probability → mid candidate
 *
 *   Activated rep (order_count > 0):
 *     50% probability → mid candidate
 *     50% probability → bottom candidate
 *
 * This is intentionally simple. No scoring models. The operator manually
 * sets order_count on each contact via PATCH /admin/contacts/:id.
 *
 * @param {object} contact  - Contact row (must have order_count field)
 * @param {object[]} candidates - Array of candidate objects with funnel_stage field
 * @param {function} [randFn]   - Optional RNG override for testing (default: Math.random)
 * @returns {object|null} The selected candidate, or null if pool is empty
 */
export function selectCandidateForContact(contact, candidates, randFn = Math.random) {
  const top = candidates.find((c) => c.funnel_stage === "top") ?? null;
  const mid = candidates.find((c) => c.funnel_stage === "mid") ?? null;
  const bottom = candidates.find((c) => c.funnel_stage === "bottom") ?? null;

  const isCold = (contact.order_count ?? 0) === 0;
  const r = randFn();

  if (isCold) {
    // 80% top, 20% mid
    return (r < 0.8 ? top : mid) ?? top ?? mid ?? bottom;
  } else {
    // 50% mid, 50% bottom
    return (r < 0.5 ? mid : bottom) ?? mid ?? bottom ?? top;
  }
}
