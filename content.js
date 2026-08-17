"use strict";

(function () {
  var BOX_ID = "luottoriskit-preview-box";

  // Matched to the site palette: bg-forest header, border-mist edges, text-steel labels.
  var FOREST = "#1b3028";
  var MIST = "#e3e8e5";
  var STEEL = "#6b7c72";
  var CHARCOAL = "#1a2420";

  // Metrics to pull from the Luottoriskit page, in display order. Labels there
  // carry extra text ("Liikevaihto 2024", "Liiketulos-% (EBIT-%)"), so each entry
  // matches on a prefix. The word boundaries keep "Nettovelka" from also matching
  // "Nettovelkaantumisaste".
  var WANTED = [
    { label: "Liikevaihto", test: /^liikevaihto(\s|$)/ },
    { label: "Liiketulos-%", test: /^liiketulos\s*-?\s*%/ },
    { label: "Nettovelka", test: /^nettovelka(\s|$)/ },
    { label: "Quick ratio", test: /^quick\s*ratio(\s|$)/ }
  ];

  var NO_VALUE = "Ei tietoa";

  // The grid that wraps the page content. The box goes in as its first child.
  var CONTAINER_SELECTOR = "div.mx-auto.grid.max-w-7xl";

  // The site is a single page app, so route changes do not reload the page and
  // do not re-run this script. Poll instead of relying on load events.
  var WATCH_INTERVAL_MS = 500;

  var lastPath = null;
  var requestToken = 0;
  var cache = {};

  function isCompanyPath(path) {
    return /^\/yritys\/[^\/]+/.test(path);
  }

  function getCompanyIdFromUrl() {
    var match = window.location.pathname.match(/\/yritys\/([^\/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
  }

  // 18523029 becomes 1852302-9. A trailing K marks a group (konserni) page.
  function toDashedYtunnus(rawId) {
    var digits = rawId.replace(/\D/g, "");
    if (digits.length < 2) {
      return null;
    }
    return digits.slice(0, -1) + "-" + digits.slice(-1);
  }

  function toSlug(name) {
    return name
      .toLowerCase()
      .replace(/å/g, "")
      .replace(/ä/g, "a")
      .replace(/ö/g, "o")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getCompanyName() {
    var heading = document.querySelector("h1");
    return heading ? heading.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function buildLuottoriskitUrl(dashedId, slug, isKonserni) {
    var url = "https://luottoriskit.fi/fi/yritykset/" + dashedId + "/" + slug + "/";
    if (isKonserni) {
      url += "konserni/";
    }
    return url;
  }

  function normalizeLabel(text) {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
  }

  function cleanValue(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  // The source labels name the fiscal year, which differs per metric. Keep it.
  function withYear(label, sourceLabel) {
    var year = sourceLabel.match(/\b(?:19|20)\d{2}\b/);
    return year ? label + " " + year[0] : label;
  }

  function findValueElement(labelEl) {
    var sibling = labelEl.nextElementSibling;
    while (sibling) {
      if (String(sibling.className || "").indexOf("metric-value") !== -1) {
        return sibling;
      }
      sibling = sibling.nextElementSibling;
    }

    // Fall back to the closest ancestor that also holds the value.
    var parent = labelEl.parentElement;
    var depth = 0;
    while (parent && depth < 3) {
      var value = parent.querySelector('[class*="metric-value"]');
      if (value) {
        return value;
      }
      parent = parent.parentElement;
      depth += 1;
    }

    return null;
  }

  function extractMetrics(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var labels = doc.querySelectorAll('[class*="metric-label"]');

    var results = WANTED.map(function (metric) {
      return { label: metric.label, value: NO_VALUE, found: false };
    });

    Array.prototype.forEach.call(labels, function (labelEl) {
      var sourceLabel = normalizeLabel(labelEl.textContent || "");
      if (!sourceLabel) {
        return;
      }

      for (var i = 0; i < WANTED.length; i += 1) {
        if (results[i].found || !WANTED[i].test.test(sourceLabel)) {
          continue;
        }
        var valueEl = findValueElement(labelEl);
        if (!valueEl) {
          continue;
        }
        results[i].label = withYear(WANTED[i].label, sourceLabel);
        results[i].value = cleanValue(valueEl.textContent || "") || NO_VALUE;
        results[i].found = true;
        break;
      }
    });

    return results;
  }

  // The page ships a loading skeleton that uses the same container classes, so
  // pick the copy that already holds the Y-tunnus info cards.
  function findContainer() {
    var containers = document.querySelectorAll(CONTAINER_SELECTOR);
    for (var i = 0; i < containers.length; i += 1) {
      if (findYtunnusTerm(containers[i])) {
        return containers[i];
      }
    }
    return null;
  }

  function findYtunnusTerm(container) {
    var terms = container.querySelectorAll("dt");
    for (var i = 0; i < terms.length; i += 1) {
      if (/y-?tunnus/i.test(terms[i].textContent || "")) {
        return terms[i];
      }
    }
    return null;
  }

  // After a route change the old company can still be on screen for a frame or
  // two. Reading the rendered Y-tunnus proves the DOM caught up with the URL.
  function getRenderedYtunnus(container) {
    var term = findYtunnusTerm(container);
    var value = term ? term.nextElementSibling : null;
    return value ? cleanValue(value.textContent || "") : null;
  }

  function createBox() {
    var box = document.createElement("div");
    box.id = BOX_ID;
    box.style.cssText = [
      "grid-column: 1 / -1",
      "margin: 0",
      "border: 1px solid " + MIST,
      "border-radius: 24px",
      "overflow: hidden",
      "background: #ffffff",
      "font-family: inherit"
    ].join(";");

    var header = document.createElement("div");
    header.style.cssText = [
      "background: " + FOREST,
      "color: #ffffff",
      "padding: 14px 20px",
      "font-size: 15px",
      "font-weight: 500",
      "letter-spacing: 0.01em"
    ].join(";");
    header.textContent = "Taloudelliset avainluvut";
    box.appendChild(header);

    var body = document.createElement("div");
    body.setAttribute("data-role", "body");
    box.appendChild(body);

    var footer = document.createElement("div");
    footer.style.cssText = [
      "padding: 10px 20px 12px",
      "font-size: 12px",
      "color: " + STEEL,
      "border-top: 1px solid " + MIST
    ].join(";");
    box.appendChild(footer);

    var attribution = document.createElement("a");
    attribution.textContent = "Tiedot: Luottoriskit.fi";
    attribution.style.cssText = "color: " + STEEL + "; text-decoration: none";
    attribution.target = "_blank";
    attribution.rel = "noopener noreferrer";
    footer.appendChild(attribution);

    return box;
  }

  function renderMessage(box, message) {
    var body = box.querySelector('[data-role="body"]');
    body.textContent = "";
    body.style.cssText = "padding: 18px 20px; font-size: 14px; color: " + STEEL;
    body.textContent = message;
  }

  // Hairline separators via a 1px grid gap over a mist background, matching the
  // info cards above.
  function renderMetrics(box, metrics) {
    var body = box.querySelector('[data-role="body"]');
    body.textContent = "";
    body.style.cssText = [
      "display: grid",
      "grid-template-columns: repeat(auto-fit, minmax(170px, 1fr))",
      "gap: 1px",
      "background: " + MIST
    ].join(";");

    metrics.forEach(function (metric) {
      var cell = document.createElement("div");
      cell.style.cssText = "background: #ffffff; padding: 16px 20px";

      var label = document.createElement("div");
      label.style.cssText = [
        "font-size: 11px",
        "font-weight: 600",
        "text-transform: uppercase",
        "letter-spacing: 0.12em",
        "color: " + STEEL
      ].join(";");
      label.textContent = metric.label;

      var value = document.createElement("div");
      value.style.cssText = "margin-top: 8px; font-size: 18px; font-weight: 500; color: " + CHARCOAL;
      value.textContent = metric.value;

      cell.appendChild(label);
      cell.appendChild(value);
      body.appendChild(cell);
    });
  }

  function removeBox() {
    var existing = document.getElementById(BOX_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function showResult(box, metrics) {
    var hasAnyValue = metrics.some(function (metric) {
      return metric.found;
    });

    if (hasAnyValue) {
      renderMetrics(box, metrics);
    } else {
      renderMessage(box, "Avainlukuja ei loytynyt Luottoriskit.fi:sta.");
    }
  }

  function attempt() {
    var rawId = getCompanyIdFromUrl();
    if (!rawId) {
      return;
    }

    var dashedId = toDashedYtunnus(rawId);
    if (!dashedId) {
      return;
    }

    var container = findContainer();
    if (!container) {
      return;
    }

    // Wait until the page shows the company the URL asks for.
    var rendered = getRenderedYtunnus(container);
    if (rendered && rendered !== dashedId) {
      return;
    }

    var slug = toSlug(getCompanyName());
    if (!slug) {
      return;
    }

    var targetUrl = buildLuottoriskitUrl(dashedId, slug, /K$/i.test(rawId));

    var box = createBox();
    box.querySelector("a").href = targetUrl;
    container.insertBefore(box, container.firstChild);

    if (cache[targetUrl]) {
      showResult(box, cache[targetUrl]);
      return;
    }

    renderMessage(box, "Haetaan avainlukuja...");

    var token = requestToken;
    chrome.runtime.sendMessage({ type: "fetchLuottoriskit", url: targetUrl }, function (response) {
      // A route change happened while the fetch was in flight.
      if (token !== requestToken || !box.isConnected) {
        return;
      }
      if (chrome.runtime.lastError) {
        renderMessage(box, "Avainlukujen haku epaonnistui.");
        return;
      }
      if (!response || !response.ok) {
        renderMessage(box, "Avainlukuja ei loytynyt Luottoriskit.fi:sta.");
        return;
      }

      var metrics = extractMetrics(response.html);
      cache[targetUrl] = metrics;
      showResult(box, metrics);
    });
  }

  function tick() {
    var path = window.location.pathname;

    if (path !== lastPath) {
      lastPath = path;
      requestToken += 1;
      removeBox();
    }

    if (!isCompanyPath(path)) {
      return;
    }

    // Also covers the box being dropped by a re-render.
    if (document.getElementById(BOX_ID)) {
      return;
    }

    attempt();
  }

  tick();
  setInterval(tick, WATCH_INTERVAL_MS);
})();
