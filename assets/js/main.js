/*
  Simplified sidebar behavior for the Editorial-style layout.
  No libraries or frameworks required.
*/
(() => {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const toggle = document.createElement('button');
  toggle.className = 'toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Toggle sidebar');
  toggle.setAttribute('aria-controls', 'sidebar');
  toggle.innerHTML = '<span aria-hidden="true">☰</span><span class="sr-only">Toggle sidebar</span>';
  sidebar.appendChild(toggle);

  const mobileLayout = window.matchMedia('(max-width: 1280px)');

  function setCollapsed(collapsed) {
    sidebar.classList.toggle('inactive', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  // Editorial starts with the sidebar open on wide screens and closed on smaller screens.
  setCollapsed(mobileLayout.matches);

  toggle.addEventListener('click', () => {
    setCollapsed(!sidebar.classList.contains('inactive'));
  });

  function handleBreakpointChange(event) {
    setCollapsed(event.matches);
  }

  if (mobileLayout.addEventListener) {
    mobileLayout.addEventListener('change', handleBreakpointChange);
  } else {
    mobileLayout.addListener(handleBreakpointChange);
  }

  // Expand/collapse nested sidebar menu groups.
  sidebar.querySelectorAll('#menu .opener').forEach((opener) => {
    opener.addEventListener('click', () => {
      const item = opener.closest('li');
      const open = item.classList.toggle('open');
      opener.setAttribute('aria-expanded', String(open));
    });
  });

  // Close the mobile sidebar after following a navigation link.
  sidebar.querySelectorAll('#menu a').forEach((link) => {
    link.addEventListener('click', () => {
      if (mobileLayout.matches && link.getAttribute('href') !== '#') {
        setCollapsed(true);
      }
    });
  });

  // Escape closes the sidebar on smaller screens.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && mobileLayout.matches) setCollapsed(true);
  });
})();

/*
  Client-side static-site search.
  Searches every same-site HTML page linked from the sidebar.
  Works on GitHub Pages or through a local web server.
*/
(() => {
  const searchSection = document.getElementById('search');
  if (!searchSection) return;

  const form = searchSection.querySelector('form');
  const input = searchSection.querySelector('input[type="search"], input[type="text"]');
  const menu = document.getElementById('menu');
  if (!form || !input || !menu) return;

  // Add accessible combobox attributes without requiring HTML changes.
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'search-results');
  input.setAttribute('autocomplete', 'off');

  let resultsBox = document.getElementById('search-results');
  if (!resultsBox) {
    resultsBox = document.createElement('div');
    resultsBox.id = 'search-results';
    resultsBox.className = 'search-results';
    resultsBox.setAttribute('role', 'listbox');
    resultsBox.setAttribute('aria-label', 'Search results');
    resultsBox.hidden = true;
    form.insertAdjacentElement('afterend', resultsBox);
  }

  let pageIndexPromise = null;
  let pageIndex = [];
  let activeResult = -1;
  let debounceTimer = null;
  let requestNumber = 0;

  const normalize = (value) => String(value || '')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  function extractPage(doc, url) {
    const main = doc.querySelector('main#main, main, #main') || doc.body;
    const content = main.cloneNode(true);
    content.querySelectorAll('script, style, nav, #sidebar, #header, #footer, .search-results').forEach((node) => node.remove());

    const heading = content.querySelector('h1');
    const title = (heading && heading.textContent.trim()) ||
      (doc.querySelector('title') && doc.querySelector('title').textContent.trim()) ||
      url.pathname.split('/').pop().replace(/\.html?$/i, '').replace(/[-_]/g, ' ');

    // Join common content blocks with spaces so adjacent tags do not merge words.
    const blocks = Array.from(content.querySelectorAll('h1, h2, h3, h4, p, li, td, th, blockquote, figcaption, pre'));
    const blockText = blocks.map((node) => node.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    const bodyText = (blockText || content.textContent).replace(/\s+/g, ' ').trim();
    const description = doc.querySelector('meta[name="description"]');
    const searchableText = [description ? description.content : '', bodyText].filter(Boolean).join(' ');

    return {
      title,
      url: url.href,
      text: searchableText,
      normalizedTitle: normalize(title),
      normalizedText: normalize(searchableText)
    };
  }

  function discoverPageUrls() {
    const found = new Map();
    const current = new URL(window.location.href);
    current.hash = '';
    current.search = '';
    if (current.pathname.endsWith('/')) current.pathname += 'index.html';

    // Include the current page, even if it is not linked to itself in the sidebar.
    found.set(current.href, current);

    menu.querySelectorAll('a[href]').forEach((link) => {
      const rawHref = link.getAttribute('href');
      if (!rawHref || rawHref.trim() === '' || rawHref.trim() === '#' || rawHref.trim().startsWith('#')) return;

      try {
        const url = new URL(rawHref, document.baseURI);
        if (url.origin !== window.location.origin) return;
        if (!/\.html?$/i.test(url.pathname)) return;
        url.hash = '';
        url.search = '';
        found.set(url.href, url);
      } catch (_error) {
        // Ignore malformed or unsupported navigation links.
      }
    });

    return Array.from(found.values());
  }

  async function fetchPage(url) {
    const currentUrl = new URL(window.location.href);
    currentUrl.hash = '';
    currentUrl.search = '';

    if (url.href === currentUrl.href) {
      return extractPage(document, url);
    }

    try {
      const response = await fetch(url.href, { credentials: 'same-origin' });
      if (!response.ok) return null;
      const html = await response.text();
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      return extractPage(parsed, url);
    } catch (_error) {
      return null;
    }
  }

  async function buildPageIndex() {
    if (pageIndexPromise) return pageIndexPromise;

    pageIndexPromise = (async () => {
      const urls = discoverPageUrls();
      const pages = [];
      const concurrency = 6;
      let next = 0;

      async function worker() {
        while (next < urls.length) {
          const index = next++;
          const page = await fetchPage(urls[index]);
          if (page && (page.title || page.text)) pages.push(page);
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
      pageIndex = pages;
      return pageIndex;
    })();

    return pageIndexPromise;
  }

  function makeSnippet(text, queryTerms) {
    if (!text) return 'Open this page';
    const lower = text.toLocaleLowerCase();
    let position = -1;

    for (const term of queryTerms) {
      const match = lower.indexOf(term);
      if (match !== -1 && (position === -1 || match < position)) position = match;
    }

    if (position === -1) position = 0;
    const start = Math.max(0, position - 55);
    const end = Math.min(text.length, start + 155);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
  }

  function rankPage(page, query, terms) {
    let score = 0;
    const title = page.normalizedTitle;
    const text = page.normalizedText;

    if (title === query) score += 100;
    else if (title.startsWith(query)) score += 65;
    else if (title.includes(query)) score += 45;

    if (text.includes(query)) score += 20;

    let matchedTerms = 0;
    terms.forEach((term) => {
      if (title.includes(term)) {
        score += 12;
        matchedTerms++;
      } else if (text.includes(term)) {
        score += 4;
        matchedTerms++;
      }
    });

    return matchedTerms === terms.length ? score : 0;
  }

  function hideResults() {
    resultsBox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeResult = -1;
  }

  function showMessage(message) {
    resultsBox.replaceChildren();
    const item = document.createElement('div');
    item.className = 'search-message';
    item.textContent = message;
    resultsBox.appendChild(item);
    resultsBox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    activeResult = -1;
  }

  function renderResults(matches, query) {
    resultsBox.replaceChildren();
    activeResult = -1;

    if (!matches.length) {
      showMessage(`No pages found for “${query}”.`);
      return;
    }

    const terms = normalize(query).split(' ').filter(Boolean);
    matches.slice(0, 8).forEach((match, index) => {
      const link = document.createElement('a');
      link.className = 'search-result';
      link.href = match.page.url;
      link.id = `search-result-${index}`;
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', 'false');

      const title = document.createElement('span');
      title.className = 'search-result-title';
      title.textContent = match.page.title;

      const snippet = document.createElement('span');
      snippet.className = 'search-result-snippet';
      snippet.textContent = makeSnippet(match.page.text, terms);

      link.append(title, snippet);
      resultsBox.appendChild(link);
    });

    if (matches.length > 8) {
      const more = document.createElement('div');
      more.className = 'search-message search-more';
      more.textContent = `Showing 8 of ${matches.length} matching pages.`;
      resultsBox.appendChild(more);
    }

    resultsBox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  async function runSearch(query, thisRequest) {
    const normalizedQuery = normalize(query);
    const terms = normalizedQuery.split(' ').filter(Boolean);

    if (terms.length === 0 || normalizedQuery.length < 2) {
      hideResults();
      return;
    }

    if (window.location.protocol === 'file:') {
      showMessage('Search works on GitHub Pages or when the site is opened through a local web server.');
      return;
    }

    showMessage('Searching pages…');

    const pages = await buildPageIndex();
    if (thisRequest !== requestNumber) return;

    const matches = pages
      .map((page) => ({ page, score: rankPage(page, normalizedQuery, terms) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title));

    renderResults(matches, query.trim());
  }

  input.addEventListener('input', () => {
    window.clearTimeout(debounceTimer);
    const query = input.value;
    const thisRequest = ++requestNumber;

    if (normalize(query).length < 2) {
      hideResults();
      return;
    }

    debounceTimer = window.setTimeout(() => runSearch(query, thisRequest), 250);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    window.clearTimeout(debounceTimer);
    const thisRequest = ++requestNumber;
    runSearch(input.value, thisRequest);
  });

  input.addEventListener('keydown', (event) => {
    const links = Array.from(resultsBox.querySelectorAll('.search-result'));
    if (resultsBox.hidden || links.length === 0) {
      if (event.key === 'Escape') hideResults();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (activeResult === -1) activeResult = direction > 0 ? 0 : links.length - 1;
      else activeResult = (activeResult + direction + links.length) % links.length;
      links.forEach((link, index) => {
        const selected = index === activeResult;
        link.setAttribute('aria-selected', String(selected));
        if (selected) input.setAttribute('aria-activedescendant', link.id);
      });
    } else if (event.key === 'Enter' && activeResult >= 0) {
      event.preventDefault();
      links[activeResult].click();
    } else if (event.key === 'Escape') {
      hideResults();
    }
  });

  document.addEventListener('click', (event) => {
    if (!searchSection.contains(event.target)) hideResults();
  });
})();
