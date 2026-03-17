// =============================================================================
// Empower Personal Dashboard Account Sorter — content.js
// =============================================================================
//
// PURPOSE:
//   Visually reorders account cards in the Empower sidebar by balance
//   (descending) using CSS `order` property. No data leaves the browser.
//
// HOW IT WORKS:
//   1. Finds account cards via [data-testid="click-account-card"] and
//      [data-testid="no-click-account-card"].
//   2. Reads balances from <span aria-hidden="true">$X,XXX</span> elements.
//   3. Tags each card's grandparent container (the transition div) with a
//      data-sorter-container attribute for CSS targeting.
//   4. Injects a <style> in <head> with `display: flex; flex-direction: column`
//      on the container and `order` values on each child.
//   5. A MutationObserver re-sorts when the sidebar DOM changes (e.g. balance
//      updates, section expand/collapse).
//
// DOM STRUCTURE (verified from live site HTML, March 2026):
//   #sidebar-container
//     > Assets section
//       > rounded card container (.sc:!rounded-xl)
//         > category header button (e.g. "Investments")
//         > transition div (.sc:transition-[height], style="height: 1020px")
//           > 68px wrapper div (.sc:h-[68px]) → button[data-testid="click-account-card"]
//           > 68px wrapper div (.sc:h-[68px]) → div[data-testid="no-click-account-card"]
//           > ... (15 cards × 68px = 1020px)
//
//   The parentElement.parentElement traversal from a card reaches the
//   transition div, which is the container we sort within.
//
// WHY `display: flex` + `order` IS SAFE HERE:
//   - The transition container has `style="height: 1020px"` set by the
//     framework. All 15 children are 68px (sc:h-[68px] with box-sizing:
//     border-box). 15 × 68 = 1020 in BOTH block and flex column layout
//     (no margin collapse difference — children use borders, not margins).
//     So `display: flex; flex-direction: column` produces an identical layout.
//   - The framework manages height via inline style. Our CSS sets display via
//     a stylesheet with !important, but does NOT touch height — so there is
//     no conflict.
//   - When categories collapse/expand, the framework animates height from
//     1020px to 0px and back. The child nodes are PRESERVED (not destroyed
//     and recreated) — confirmed by inspecting the DOM in both states.
//     The data-sorter-container attribute survives collapse/expand.
//   - React does not monitor CSS class/stylesheet changes. Setting
//     `display: flex` via an injected <style> tag in <head> is invisible
//     to React's reconciliation.
//   - The data-sorter-container attribute is an attribute mutation, which
//     does NOT trigger our childList-only MutationObserver.
//   - The <style> element is in <head>, not <body>, so writing to
//     styleEl.textContent does NOT trigger the body-scoped observer.
//
// =============================================================================
// REJECTED ALTERNATIVES — DO NOT REVISIT THESE
// =============================================================================
//
// 1. CSS transform: translateY() approach
//    REJECTED: Hardcodes the 68px card height — breaks silently if Empower
//    changes card sizing. Cards move visually but tab order / screen reader
//    order stays original (accessibility regression). Fragile with
//    expand/collapse height animations. More complex code for no real benefit
//    since flex+order is safe (see above).
//
// 2. Physical DOM reordering (appendChild / insertBefore)
//    REJECTED: Catastrophic for React apps. Moving nodes that React manages
//    breaks virtual DOM reconciliation. React would "fix" the DOM back on
//    next render, creating an immediate rapid loop far worse than the
//    original bug. Never do this on a framework-managed DOM.
//
// 3. One-shot sort (no observer)
//    REJECTED: Too limited. Doesn't handle section expand/collapse (new cards
//    appear), balance updates mid-session, or SPA navigation. The extension
//    would feel broken.
//
// 4. Observing document.body (the v1.0 approach)
//    REJECTED: document.body catches ALL DOM mutations across the entire page
//    (chart animations, tooltip hovers, modal opens, performance graph
//    redraws, cookie banners). This caused the observer to fire continuously,
//    running sortAccounts once per second indefinitely. On a financial
//    platform with aggressive rate limiting and bot detection, this
//    continuous automated pattern got the user locked out for a week.
//    ALWAYS observe #sidebar-container instead.
//
// 5. Short debounce (1 second, the v1.0 approach)
//    REJECTED: The dashboard's loading spinners and balance fetches produce
//    bursts of mutations over 1-2 seconds. A 1s debounce means sortAccounts
//    fires mid-burst and then fires AGAIN when the burst settles. Use 3s+.
//
// 6. No run cap (the v1.0 approach)
//    REJECTED: Without a cap, the observer runs indefinitely. Even if each
//    run is a no-op after the first, the continuous DOM reads on a financial
//    platform can trigger rate limiting or bot detection. Always cap runs
//    and use stability detection.
//
// =============================================================================

(function() {
  'use strict';

  // Injected into <head>, NOT <body> — changes to this element do not trigger
  // our body/sidebar-scoped MutationObserver.
  const styleEl = document.createElement('style');
  styleEl.id = 'empower-sorter-styles';
  document.head.appendChild(styleEl);

  // ---------------------------------------------------------------------------
  // Balance parsing
  // ---------------------------------------------------------------------------

  // Extracts a numeric value from a currency string like "$1,273,656".
  // Returns -Infinity for unparseable values so they sort to the bottom.
  function parseCurrency(text) {
    if (!text || typeof text !== 'string') return -Infinity;
    if (!/\d/.test(text)) return -Infinity;

    const cleaned = text.replace(/[^0-9.-]+/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return -Infinity;

    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? -Infinity : parsed;
  }

  // Finds the balance value from a card element.
  // Targets <span aria-hidden="true">$X,XXX</span> — the visual balance.
  // (There's also a <span class="sc:sr-only"> with the same value for
  // screen readers, but we use aria-hidden="true" to avoid double-matching.)
  function getCardValue(card) {
    const spans = card.querySelectorAll('span[aria-hidden="true"]');
    for (let span of spans) {
      if (span.textContent && /[$€£¥₩]/.test(span.textContent)) {
        const val = parseCurrency(span.textContent);
        if (val !== -Infinity) return val;
      }
    }
    return -Infinity;
  }

  // ---------------------------------------------------------------------------
  // Sort logic
  // ---------------------------------------------------------------------------

  function sortAccounts() {
    // Find all account cards (both clickable and non-clickable variants)
    const accountCards = document.querySelectorAll(
      '[data-testid="click-account-card"], [data-testid="no-click-account-card"]'
    );
    if (accountCards.length === 0) return;

    // Collect unique containers. Each card's DOM path is:
    //   card → 68px wrapper div (parentElement) → transition div (parentElement²)
    // The transition div is what we sort within.
    const containers = new Set();
    accountCards.forEach(card => {
      if (card.parentElement && card.parentElement.parentElement) {
        containers.add(card.parentElement.parentElement);
      }
    });

    let cssRules = '';
    let containerIndex = 0;

    containers.forEach(container => {
      const rows = Array.from(container.children);
      if (rows.length <= 1) {
        containerIndex++;
        return;
      }

      // Build list of sortable rows with their balance values
      const validRows = [];
      rows.forEach((row, index) => {
        const card = row.querySelector(
          '[data-testid="click-account-card"], [data-testid="no-click-account-card"]'
        );
        if (card) {
            validRows.push({ value: getCardValue(card), originalIndex: index + 1 });
        }
      });

      if (validRows.length <= 1) {
        containerIndex++;
        return;
      }

      // Tag the container for CSS targeting. This is an attribute mutation,
      // which does NOT trigger our childList-only MutationObserver.
      // Guard prevents unnecessary writes when the attribute already matches.
      if (container.dataset.sorterContainer !== String(containerIndex)) {
          container.dataset.sorterContainer = containerIndex;
      }

      // Sort descending by balance
      const sortedRows = [...validRows].sort((a, b) => b.value - a.value);

      // Apply flex layout to enable CSS `order` property.
      // See "WHY display: flex IS SAFE" in the header comment.
      cssRules += `[data-sorter-container="${containerIndex}"] { display: flex !important; flex-direction: column !important; }\n`;

      // Assign order values. Cards get their sorted position; non-card
      // children (if any) keep their original position.
      const minIndex = Math.min(...validRows.map(v => v.originalIndex));

      rows.forEach((row, index) => {
          const nthChild = index + 1;
          let targetOrder = nthChild;

          const validItem = validRows.find(v => v.originalIndex === nthChild);
          if (validItem) {
              const sortedPos = sortedRows.findIndex(s => s.originalIndex === nthChild);
              targetOrder = minIndex + sortedPos;
          }

          cssRules += `[data-sorter-container="${containerIndex}"] > :nth-child(${nthChild}) { order: ${targetOrder} !important; }\n`;
      });

      containerIndex++;
    });

    // Only write to the style element if the CSS actually changed.
    // This prevents unnecessary DOM writes (though writes to <head> don't
    // trigger our <body>-scoped observer anyway).
    if (styleEl.textContent !== cssRules) {
        styleEl.textContent = cssRules;
    }
  }

  // ---------------------------------------------------------------------------
  // MutationObserver with safety limits
  // ---------------------------------------------------------------------------
  //
  // CRITICAL: The v1.0 observer had no run cap, observed document.body, and
  // used a 1-second debounce. This caused sortAccounts to run once per second
  // indefinitely, which triggered Empower's bot detection and locked the user
  // out for a week. The fixes below are load-bearing — do not remove them.

  const MAX_RUNS = 5;       // Hard cap: max 5 sorts per session
  const DEBOUNCE_MS = 3000; // Wait 3s for DOM mutations to settle
  let runCount = 0;
  let lastCss = null;        // For stability detection
  let debounceTimer = null;
  let observer = null;

  // Observe #sidebar-container if available (covers only the account list),
  // falling back to document.body for safety. Scoping to the sidebar
  // eliminates 90%+ of false triggers from charts, tooltips, modals, etc.
  function startObserving() {
    const target = document.getElementById('sidebar-container') || document.body;
    observer.observe(target, { childList: true, subtree: true });
  }

  function handleMutations() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // Safety: hard cap on total runs
      if (runCount >= MAX_RUNS) {
        observer.disconnect();
        return;
      }

      // Disconnect during sort to prevent self-triggering
      // (though our writes shouldn't trigger childList anyway)
      observer.disconnect();
      sortAccounts();
      runCount++;

      // Stability detection: if two consecutive runs produce identical CSS,
      // the sort order is stable and we can stop observing. This is the
      // normal exit path — typically fires after 2 runs.
      const currentCss = styleEl.textContent;
      if (lastCss !== null && currentCss === lastCss) {
        return; // Stable — stay disconnected
      }
      lastCss = currentCss;

      // Continue observing if we haven't hit the cap
      if (runCount < MAX_RUNS) {
        startObserving();
      }
    }, DEBOUNCE_MS);
  }

  observer = new MutationObserver(handleMutations);

  // Re-arm when the user tabs back to the page. This handles the case where
  // balances updated while the tab was hidden. Resets the run counter so the
  // extension can re-sort with fresh data.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runCount = 0;
      lastCss = null;
      observer.disconnect();
      startObserving();
    }
  });

  startObserving();

})();
