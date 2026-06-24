(function () {
  "use strict";

  const EDITABLE_SELECTOR = [
    "input:not([type])",
    "input[type='email']",
    "input[type='number']",
    "input[type='password']",
    "input[type='search']",
    "input[type='tel']",
    "input[type='text']",
    "input[type='url']",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable='false'])"
  ].join(",");
  const BLOCKED_SHORTCUT_KEYS = new Set(["a", "c", "x"]);

  function protectionEnabled() {
    return document.documentElement.hasAttribute("data-content-protection");
  }

  function isEditableTarget(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    return Boolean(element?.closest(EDITABLE_SELECTOR));
  }

  function blockProtectedEvent(event) {
    if (!protectionEnabled() || isEditableTarget(event.target)) return;
    event.preventDefault();
  }

  function blockProtectedShortcut(event) {
    if (!protectionEnabled() || isEditableTarget(event.target)) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (!BLOCKED_SHORTCUT_KEYS.has(String(event.key).toLowerCase())) return;
    event.preventDefault();
  }

  ["copy", "cut", "selectstart", "contextmenu"].forEach((eventName) => {
    document.addEventListener(eventName, blockProtectedEvent, true);
  });
  document.addEventListener("keydown", blockProtectedShortcut, true);
}());
