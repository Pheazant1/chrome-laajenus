"use strict";

var ALLOWED_HOST = "luottoriskit.fi";

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== "fetchLuottoriskit") {
    return false;
  }

  var url;
  try {
    url = new URL(message.url);
  } catch (error) {
    sendResponse({ ok: false, error: "Virheellinen URL" });
    return false;
  }

  if (url.protocol !== "https:" || url.hostname !== ALLOWED_HOST) {
    sendResponse({ ok: false, error: "Sallimaton osoite: " + url.hostname });
    return false;
  }

  fetch(url.href, { credentials: "omit", redirect: "follow" })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.text();
    })
    .then(function (html) {
      sendResponse({ ok: true, html: html, url: url.href });
    })
    .catch(function (error) {
      sendResponse({ ok: false, error: String(error.message || error) });
    });

  // Keeps the message channel open for the async response.
  return true;
});
