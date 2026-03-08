(function() {
  'use strict';

  const styleEl = document.createElement('style');
  styleEl.id = 'empower-sorter-styles';
  document.head.appendChild(styleEl);

  function parseCurrency(text) {
    if (!text || typeof text !== 'string') return -Infinity;
    if (!/\d/.test(text)) return -Infinity;

    const cleaned = text.replace(/[^0-9.-]+/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return -Infinity;

    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? -Infinity : parsed;
  }

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

  function sortAccounts() {
    const accountCards = document.querySelectorAll('[data-testid="click-account-card"], [data-testid="no-click-account-card"]');
    if (accountCards.length === 0) return;

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

      const validRows = [];
      rows.forEach((row, index) => {
        const card = row.querySelector('[data-testid="click-account-card"], [data-testid="no-click-account-card"]');
        if (card) {
            validRows.push({ value: getCardValue(card), originalIndex: index + 1 });
        }
      });

      if (validRows.length <= 1) {
        containerIndex++;
        return;
      }

      if (container.dataset.sorterContainer !== String(containerIndex)) {
          container.dataset.sorterContainer = containerIndex;
      }

      const sortedRows = [...validRows].sort((a, b) => b.value - a.value);
      cssRules += `[data-sorter-container="${containerIndex}"] { display: flex !important; flex-direction: column !important; }\n`;

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

    if (styleEl.textContent !== cssRules) {
        styleEl.textContent = cssRules;
    }
  }

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      observer.disconnect();
      sortAccounts();
      observer.observe(document.body, { childList: true, subtree: true });
    }, 1000);
  });

  observer.observe(document.body, { childList: true, subtree: true });

})();
