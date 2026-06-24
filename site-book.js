(() => {
  "use strict";

  const SECTION_ORDER = ["home", "letter", "map", "characters", "gallery", "archive", "settings", "reader"];
  const SECTION_HASHES = new Set(["home", "letter", "map", "characters", "gallery", "archive", "settings"]);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let sourceRoot = null;
  let stage = null;
  let bookRoot = null;
  let homePanel = null;
  let homePanelContent = null;
  let pageFlip = null;
  let pages = [];
  let placements = [];
  let placementByNode = new WeakMap();
  let sectionStarts = new Map();
  let ready = false;
  let rebuilding = false;
  let readerEditing = false;
  let currentSection = "home";
  let repaginateTimer = 0;
  let resizeTimer = 0;
  let suppressFlipHistory = false;
  let bookMounted = false;
  let flipSoundStarted = false;
  let pendingRebuildReason = "";
  let requestedSectionAfterRebuild = "";
  let requestedOffsetAfterRebuild = null;
  let requestedHeadingAfterRebuild = "";
  const dynamicGrids = new Map();
  let archivePrimaryGrid = null;
  let archiveSecondaryGrid = null;

  function sourceView(name) {
    return sourceRoot?.querySelector(`.view[data-view-name="${name}"]`) || null;
  }

  function finishBoot() {
    document.documentElement.classList.remove("book-booting");
  }

  function romanNumeral(number) {
    const numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
    return numerals[number - 1] || String(number || "");
  }

  function setBookDimensions() {
    const headerHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) || 78;
    const footerHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--footer-height")) || 56;
    const availableHeight = Math.max(520, window.innerHeight - headerHeight - footerHeight - 28);
    const portrait = window.innerWidth < 900;
    const availableWidth = portrait ? window.innerWidth - 18 : (window.innerWidth - 42) / 2;
    const pageWidth = Math.max(300, Math.min(720, availableWidth, availableHeight * .75));
    const pageHeight = Math.max(400, Math.min(960, pageWidth / .75, availableHeight));
    stage.style.setProperty("--book-page-width", `${Math.floor(pageWidth)}px`);
    stage.style.setProperty("--book-page-height", `${Math.floor(pageHeight)}px`);
  }

  function createPage(section, options = {}) {
    const page = document.createElement("section");
    page.className = [
      "book-page",
      `book-page-${section}`,
      options.hard ? "book-page-hard" : "",
      options.blank ? "book-page-blank" : "",
      options.tool ? "book-page-tool" : "",
      options.cover ? "book-page-cover" : "",
      options.className || ""
    ].filter(Boolean).join(" ");
    page.dataset.bookSection = section;
    if (options.hard) page.dataset.density = "hard";

    const content = document.createElement("div");
    content.className = ["book-page-content", options.contentClass || ""].filter(Boolean).join(" ");
    page.appendChild(content);
    bookRoot.appendChild(page);
    pages.push(page);
    if (!sectionStarts.has(section) && !options.blank) sectionStarts.set(section, pages.length - 1);
    return { page, content };
  }

  function createBlankPage() {
    const { content } = createPage("blank", { blank: true });
    content.innerHTML = '<span class="book-blank-ornament" aria-hidden="true"></span>';
  }

  function alignSectionToLeft() {
    if (pages.length % 2 === 0) createBlankPage();
  }

  function placeNode(node, target) {
    if (!node || !target) return;
    if (!placementByNode.has(node)) {
      const placeholder = document.createComment("site-book-placeholder");
      node.parentNode?.insertBefore(placeholder, node);
      const placement = { node, placeholder };
      placements.push(placement);
      placementByNode.set(node, placement);
    }
    target.appendChild(node);
  }

  function placeNodes(nodes, target) {
    [...nodes].forEach((node) => placeNode(node, target));
  }

  function restoreSource() {
    restoreAllDynamicGrids();
    for (let index = placements.length - 1; index >= 0; index -= 1) {
      const { node, placeholder } = placements[index];
      if (placeholder.parentNode) {
        placeholder.parentNode.insertBefore(node, placeholder);
        placeholder.remove();
      } else {
        node.remove();
      }
    }
    placements = [];
    placementByNode = new WeakMap();
  }

  function registerDynamicGrid(section, primary, continuations) {
    dynamicGrids.set(section, { primary, continuations });
  }

  function restoreDynamicGrid(section) {
    const entry = dynamicGrids.get(section);
    if (!entry?.primary) return;
    entry.continuations.forEach((grid) => {
      [...grid.children].forEach((item) => entry.primary.appendChild(item));
    });
    entry.continuations.length = 0;
  }

  function restoreAllDynamicGrids() {
    [...dynamicGrids.keys()].forEach(restoreDynamicGrid);
    dynamicGrids.clear();
  }

  function fits(content) {
    return content.scrollHeight <= content.clientHeight + 2;
  }

  function textNodesOf(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  }

  function sanitizeClone(element) {
    element.removeAttribute?.("id");
    element.removeAttribute?.("contenteditable");
    element.querySelectorAll?.("[id], [contenteditable]").forEach((node) => {
      node.removeAttribute("id");
      node.removeAttribute("contenteditable");
    });
    return element;
  }

  function cloneTextRange(element, start, end) {
    const texts = textNodesOf(element);
    const clone = element.cloneNode(false);
    if (!texts.length) return element.cloneNode(true);

    let cursor = 0;
    let startNode = texts[0];
    let startOffset = 0;
    let endNode = texts[texts.length - 1];
    let endOffset = endNode.nodeValue.length;

    for (const text of texts) {
      const next = cursor + text.nodeValue.length;
      if (start >= cursor && start <= next) {
        startNode = text;
        startOffset = Math.min(text.nodeValue.length, start - cursor);
      }
      if (end >= cursor && end <= next) {
        endNode = text;
        endOffset = Math.min(text.nodeValue.length, end - cursor);
        break;
      }
      cursor = next;
    }

    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    clone.appendChild(range.cloneContents());
    clone.classList.add("book-generated-clone");
    return sanitizeClone(clone);
  }

  function paginateNodes(section, nodes, options = {}) {
    const safeNodes = [...nodes].filter((node) => node.nodeType === Node.ELEMENT_NODE || String(node.textContent || "").trim());
    if (!safeNodes.length) {
      createPage(section, options);
      return;
    }

    let result = createPage(section, options);
    let count = 0;
    const nextPage = () => {
      result = createPage(section, options);
      count = 0;
    };

    safeNodes.forEach((node) => {
      if (options.clone) {
        const fullClone = sanitizeClone(node.cloneNode(true));
        fullClone.classList?.add("book-generated-clone");
        result.content.appendChild(fullClone);
        count += 1;
        if (fits(result.content)) return;
        fullClone.remove();
        count -= 1;
        if (count > 0) nextPage();

        const textLength = String(node.textContent || "").length;
        if (!options.splitText || textLength < 2) {
          result.content.appendChild(fullClone);
          if (!fits(result.content)) result.page.classList.add("book-page-overflow");
          count += 1;
          return;
        }

        let start = 0;
        while (start < textLength) {
          let low = start + 1;
          let high = textLength;
          let best = start;
          while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const trial = cloneTextRange(node, start, middle);
            result.content.appendChild(trial);
            if (fits(result.content)) {
              best = middle;
              low = middle + 1;
            } else {
              high = middle - 1;
            }
            trial.remove();
          }

          if (best === start) {
            if (count > 0) {
              nextPage();
              continue;
            }
            const emergencyEnd = Math.min(textLength, start + 120);
            result.content.appendChild(cloneTextRange(node, start, emergencyEnd));
            result.page.classList.add("book-page-overflow");
            start = emergencyEnd;
          } else {
            result.content.appendChild(cloneTextRange(node, start, best));
            start = best;
          }
          count += 1;
          if (start < textLength) nextPage();
        }
        return;
      }

      placeNode(node, result.content);
      count += 1;
      if (count > 1 && !fits(result.content)) {
        nextPage();
        placeNode(node, result.content);
        count = 1;
      }
      if (!fits(result.content)) result.page.classList.add("book-page-overflow");
    });
  }

  function createClonedNodePage(section, nodes, options = {}) {
    const result = createPage(section, options);
    [...nodes].filter(Boolean).forEach((node) => {
      const clone = sanitizeClone(node.cloneNode(true));
      clone.classList?.add("book-generated-clone");
      result.content.appendChild(clone);
    });
    if (!fits(result.content)) result.page.classList.add("book-page-item-oversize");
    return result;
  }

  function createGridPage(section, primaryGrid, options = {}, isFirst = false) {
    const result = createPage(section, {
      className: options.className || "book-card-sheet",
      contentClass: options.contentClass || "book-card-page-content"
    });
    const grid = isFirst ? primaryGrid : primaryGrid.cloneNode(false);
    if (!isFirst) {
      grid.removeAttribute("id");
      grid.classList.add("book-grid-continuation");
    }
    if (isFirst) placeNode(grid, result.content);
    else result.content.appendChild(grid);
    return { ...result, grid };
  }

  function paginateGrid(section, primaryGrid, options = {}) {
    if (!primaryGrid) return;
    const cards = [...primaryGrid.children];
    primaryGrid.replaceChildren();
    const continuations = [];
    let result = createGridPage(section, primaryGrid, options, true);
    let count = 0;

    cards.forEach((card) => {
      result.grid.appendChild(card);
      count += 1;
      if (fits(result.content)) return;
      if (count === 1) {
        result.page.classList.add("book-page-card-oversize");
        return;
      }
      card.remove();
      result = createGridPage(section, primaryGrid, options, false);
      continuations.push(result.grid);
      result.grid.appendChild(card);
      count = 1;
      if (!fits(result.content)) result.page.classList.add("book-page-card-oversize");
    });

    if (options.emptyNode) placeNode(options.emptyNode, result.content);
    registerDynamicGrid(section, primaryGrid, continuations);
  }

  function createNodePage(section, nodes, options = {}) {
    const result = createPage(section, options);
    placeNodes([...nodes].filter(Boolean), result.content);
    if (!fits(result.content)) result.page.classList.add("book-page-item-oversize");
    return result;
  }

  function paginateItemContainer(section, sourceContainer, items, options = {}) {
    if (!sourceContainer) return;
    const safeItems = [...items].filter(Boolean);
    let result = createPage(section, {
      className: options.className || "",
      contentClass: options.contentClass || ""
    });
    let shell = sourceContainer.cloneNode(false);
    shell.removeAttribute("id");
    shell.classList.add(options.shellClass || "book-continuation-container");
    result.content.appendChild(shell);

    safeItems.forEach((item) => {
      placeNode(item, shell);
      if (fits(result.content)) return;
      item.remove();
      result = createPage(section, {
        className: options.className || "",
        contentClass: options.contentClass || ""
      });
      shell = sourceContainer.cloneNode(false);
      shell.removeAttribute("id");
      shell.classList.add(options.shellClass || "book-continuation-container");
      result.content.appendChild(shell);
      placeNode(item, shell);
      if (!fits(result.content)) result.page.classList.add("book-page-item-oversize");
    });
  }

  function buildHome() {
    const view = sourceView("home");
    const { content } = createPage("home", { hard: true, cover: true, contentClass: "book-cover-content" });
    content.innerHTML = '<img class="book-cover-art book-generated-clone" src="assets/book-front-cover-ai.png" alt="诗人眺望远方遗迹与山谷的书籍封面">';
    if (homePanelContent) placeNodes(view.childNodes, homePanelContent);
  }

  function buildLetter() {
    const view = sourceView("letter");
    alignSectionToLeft();
    const hero = view.querySelector(".section-hero");
    const article = view.querySelector(".letter-paper");
    if (hero) paginateNodes("letter", [hero], { className: "book-section-opening" });
    paginateNodes("letter", article ? article.children : [], {
      className: "book-prose-sheet",
      contentClass: "letter-paper preface-paper book-prose-content",
      clone: true,
      splitText: true
    });
  }

  function buildMap() {
    const view = sourceView("map");
    const atlas = view.querySelector(".atlas-shell");
    const hero = view.querySelector(".section-hero");
    const heroCopy = hero?.firstElementChild;
    const mapCount = window.ATLAS_MAPS?.length || 0;

    alignSectionToLeft();
    const leftOpening = createPage("map", { className: "book-map-opening book-map-opening-left" });
    const leftIntro = document.createElement("div");
    leftIntro.className = "book-map-opening-panel book-map-opening-copy";
    leftOpening.content.appendChild(leftIntro);
    if (heroCopy) placeNode(heroCopy, leftIntro);

    const rightOpening = createPage("map", { className: "book-map-opening book-map-opening-right" });
    const rightIntro = document.createElement("div");
    rightIntro.className = "book-map-opening-panel book-map-opening-mark";
    rightIntro.innerHTML = `
      <span class="book-map-roman" aria-hidden="true">${romanNumeral(mapCount)}</span>
      <p>MAPS OF THE KNOWN LANDS</p>
      <div class="book-map-count"><strong>${mapCount}</strong><span>MAPS</span></div>
    `;
    rightOpening.content.appendChild(rightIntro);

    alignSectionToLeft();
    createNodePage("map", [atlas?.querySelector(".atlas-index")], {
      className: "book-map-index-sheet"
    });
    createNodePage("map", [atlas?.querySelector(".atlas-viewer")], {
      className: "book-map-viewer-sheet"
    });
  }

  function buildCharacters() {
    const view = sourceView("characters");
    alignSectionToLeft();
    createNodePage("characters", [view.querySelector(".section-hero"), view.querySelector(".character-toolbar")], {
      className: "book-section-opening book-character-opening"
    });
    const gallery = view.querySelector("#characterGallery");
    const empty = view.querySelector("#characterEmpty");
    paginateGrid("characters", gallery, {
      emptyNode: empty,
      className: "book-card-sheet book-character-card-sheet",
      contentClass: "book-card-page-content"
    });
    const form = view.querySelector("#characterForm");
    if (form && document.body.classList.contains("developer-mode")) {
      paginateNodes("characters", [form], { tool: true, className: "book-developer-sheet" });
    }
  }

  function buildGallery() {
    const view = sourceView("gallery");
    alignSectionToLeft();
    createNodePage("gallery", [view.querySelector(".section-hero"), view.querySelector("#galleryCategoryTabs")], {
      className: "book-section-opening book-gallery-opening"
    });
    const grid = view.querySelector("#galleryGrid");
    const empty = view.querySelector("#galleryEmpty");
    paginateGrid("gallery", grid, {
      emptyNode: empty,
      className: "book-card-sheet book-gallery-card-sheet",
      contentClass: "book-card-page-content"
    });
    const developerPanel = view.querySelector("#galleryDeveloperPanel");
    if (developerPanel && document.body.classList.contains("developer-mode")) {
      paginateNodes("gallery", [developerPanel], { tool: true, className: "book-developer-sheet" });
    }
  }

  function createArchiveIntroPart(className) {
    const part = document.createElement("div");
    part.className = `archive-intro archive-intro-part ${className}`;
    return part;
  }

  function createArchiveFrame(className) {
    const frame = document.createElement("div");
    frame.className = `archive-frame book-archive-frame ${className}`;
    frame.innerHTML = `
      <div class="corner corner-tl"></div><div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div><div class="corner corner-br"></div>
    `;
    return frame;
  }

  function distributeArchiveCards() {
    if (!archivePrimaryGrid || !archiveSecondaryGrid) return;
    restoreDynamicGrid("archive");
    archiveSecondaryGrid.replaceChildren();
    [...archivePrimaryGrid.children].slice(6).forEach((card) => archiveSecondaryGrid.appendChild(card));
    registerDynamicGrid("archive", archivePrimaryGrid, [archiveSecondaryGrid]);
  }

  function buildArchive() {
    const view = sourceView("archive");
    const intro = view.querySelector(".archive-intro");
    const introCopy = intro?.firstElementChild;
    const volumeCount = intro?.querySelector(".volume-count");

    alignSectionToLeft();
    const leftOpening = createPage("archive", { className: "book-archive-opening book-archive-opening-left" });
    const leftIntro = createArchiveIntroPart("archive-intro-left");
    leftOpening.content.appendChild(leftIntro);
    if (introCopy) placeNode(introCopy, leftIntro);

    const rightOpening = createPage("archive", { className: "book-archive-opening book-archive-opening-right" });
    const rightIntro = createArchiveIntroPart("archive-intro-right");
    rightIntro.insertAdjacentHTML("afterbegin", `
      <div class="archive-opening-mark" aria-hidden="true">
        <span>XII</span>
        <small>Stories carried from voice to voice</small>
      </div>
    `);
    rightOpening.content.appendChild(rightIntro);
    if (volumeCount) placeNode(volumeCount, rightIntro);

    alignSectionToLeft();
    archivePrimaryGrid = view.querySelector("#bookGrid");
    const leftCatalog = createPage("archive", { className: "book-archive-catalog-sheet book-archive-catalog-left" });
    const leftFrame = view.querySelector(".archive-frame");
    leftFrame?.classList.add("book-archive-frame", "book-archive-frame-left");
    if (leftFrame) placeNode(leftFrame, leftCatalog.content);

    const rightCatalog = createPage("archive", { className: "book-archive-catalog-sheet book-archive-catalog-right" });
    const rightFrame = createArchiveFrame("book-archive-frame-right");
    archiveSecondaryGrid = document.createElement("div");
    archiveSecondaryGrid.className = "book-grid book-grid-continuation";
    rightFrame.appendChild(archiveSecondaryGrid);
    rightCatalog.content.appendChild(rightFrame);
    distributeArchiveCards();

    const workbench = view.querySelector("#bookWorkbench");
    if (workbench && document.body.classList.contains("developer-mode")) {
      paginateNodes("archive", [workbench], { tool: true, className: "book-developer-sheet" });
    }
  }

  function buildSettings() {
    const view = sourceView("settings");
    const panel = view.querySelector(".settings-panel");
    alignSectionToLeft();
    createNodePage("settings", [view.querySelector(".section-hero")], {
      className: "book-section-opening book-settings-opening"
    });
    paginateItemContainer("settings", panel, panel?.children || [], {
      className: "book-settings-sheet",
      shellClass: "book-settings-panel"
    });
  }

  function buildReader() {
    const view = sourceView("reader");
    const reader = window.EchoesReader;
    if (!reader?.getCurrentBook?.()) return;
    alignSectionToLeft();
    if (readerEditing) {
      createNodePage("reader", view.children, { tool: true, className: "book-reader-editing-sheet" });
      return;
    }

    const top = view.querySelector(".reader-top");
    const sidebar = view.querySelector(".reader-sidebar");
    const paper = view.querySelector(".reader-paper");
    const actions = paper?.querySelector(".reader-actions");
    createClonedNodePage("reader", [top, sidebar, actions], {
      className: "book-reader-index-sheet"
    });

    const header = paper?.querySelector("header");
    const chapterBody = paper?.querySelector(".chapter-body");
    paginateNodes("reader", [header, ...(chapterBody?.children || [])].filter(Boolean), {
      clone: true,
      splitText: true,
      className: "book-reader-text-sheet",
      contentClass: "reader-paper book-reader-page-content"
    });
  }

  function buildBackCover() {
    if (pages.length % 2 === 0) createBlankPage();
    const { content } = createPage("back-cover", { hard: true, cover: true, contentClass: "book-back-cover-content" });
    content.innerHTML = '<img class="book-cover-art book-generated-clone" src="assets/book-back-cover-ai.png" alt="暮色山谷与远方遗迹的书籍封底">';
  }

  function buildPages() {
    pages = [];
    sectionStarts = new Map();
    buildHome();
    buildLetter();
    buildMap();
    buildCharacters();
    buildGallery();
    buildArchive();
    buildSettings();
    buildReader();
    buildBackCover();
  }

  function currentHashFor(section) {
    if (section === "reader") {
      const book = window.EchoesReader?.getCurrentBook?.();
      const chapter = window.EchoesReader?.getCurrentChapterIndex?.() || 0;
      return book ? `#read/${book.id}/${chapter}` : "#archive";
    }
    return `#${SECTION_HASHES.has(section) ? section : "home"}`;
  }

  function setActiveSection(section, updateHistory = false) {
    if (!SECTION_ORDER.includes(section)) return;
    currentSection = section;
    window.EchoesReader?.setCurrentView?.(section);
    document.body.classList.toggle("book-home-active", section === "home");
    document.querySelectorAll(".nav-trigger").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === section);
    });
    document.body.classList.toggle("reading-mode", section === "reader" && document.getElementById("focusToggle")?.checked);
    if (updateHistory) history.replaceState(null, "", currentHashFor(section));
  }

  function bindFlipEvents() {
    pageFlip.on("flip", (event) => {
      const pageIndex = Number(event.data);
      window.EchoesMotion?.onBookFlip?.(pageIndex, false);
      if (suppressFlipHistory) return;
      const page = pages[pageIndex];
      const section = page?.dataset.bookSection;
      if (!SECTION_ORDER.includes(section)) return;
      setActiveSection(section, true);
    });
    pageFlip.on("changeState", (event) => {
      document.body.classList.toggle("book-is-flipping", event.data !== "read");
      if (event.data !== "read") beginFlipSound();
      if (event.data === "read") flipSoundStarted = false;
      if (event.data === "read" && pendingRebuildReason && !rebuilding) {
        const reason = pendingRebuildReason;
        pendingRebuildReason = "";
        window.setTimeout(() => rebuild(reason), 20);
      }
    });
  }

  function createBookRoot() {
    bookRoot = document.createElement("div");
    bookRoot.id = "siteBook";
    bookRoot.className = "site-book";
    stage.appendChild(bookRoot);
  }

  function mountPageFlip(target = "home") {
    bookMounted = false;
    document.body.classList.add("book-opening");
    pageFlip = new window.St.PageFlip(bookRoot, {
      width: 720,
      height: 960,
      size: "stretch",
      minWidth: 300,
      maxWidth: 720,
      minHeight: 400,
      maxHeight: 960,
      showCover: true,
      usePortrait: true,
      drawShadow: false,
      maxShadowOpacity: .08,
      flippingTime: 520,
      clickEventForward: true,
      useMouseEvents: true,
      showPageCorners: false,
      mobileScrollSupport: true,
      disableFlipByClick: true,
      autoSize: true
    });
    bindFlipEvents();
    pageFlip.loadFromHTML(pages);
    window.setTimeout(() => {
      let targetPage = typeof target === "number"
        ? Math.min(Math.max(target, 0), pages.length - 1)
        : sectionStarts.get(target) || 0;
      if (requestedHeadingAfterRebuild) {
        targetPage = pageForReaderHeading(requestedHeadingAfterRebuild) ?? targetPage;
        requestedHeadingAfterRebuild = "";
      }
      pageFlip.turnToPage(targetPage);
      forceDraw();
      const section = pages[targetPage]?.dataset.bookSection;
      if (SECTION_ORDER.includes(section)) setActiveSection(section);
      window.EchoesMotion?.onBookFlip?.(targetPage, false);
      window.EchoesMotion?.refresh?.(stage);
      finishBoot();
      rebuilding = false;
      window.setTimeout(() => {
        bookMounted = true;
        document.body.classList.remove("book-opening");
      }, reducedMotion.matches ? 20 : 720);
      if (pendingRebuildReason) {
        const reason = pendingRebuildReason;
        pendingRebuildReason = "";
        repaginate(reason);
      }
    }, 40);
  }

  function requestedSectionFromHash() {
    const hash = location.hash.replace(/^#/, "") || "home";
    if (hash.startsWith("read/")) return "reader";
    return SECTION_ORDER.includes(hash) ? hash : "home";
  }

  function forceDraw() {
    pageFlip?.getRender?.().drawFrame?.();
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
  }

  function beginFlipSound() {
    if (!bookMounted || rebuilding || flipSoundStarted) return;
    flipSoundStarted = true;
    window.EchoesMotion?.onBookTurnStart?.();
  }

  function turnPage(direction) {
    if (!ready || !pageFlip || pageFlip.getState?.() !== "read") return false;
    const currentPage = pageFlip.getCurrentPageIndex();
    const canTurn = direction === "next"
      ? currentPage < pageFlip.getPageCount() - 1
      : currentPage > 0;
    if (!canTurn) return false;

    beginFlipSound();
    if (reducedMotion.matches) {
      pageFlip[direction === "next" ? "turnToNextPage" : "turnToPrevPage"]();
    } else {
      pageFlip[direction === "next" ? "flipNext" : "flipPrev"]("top");
    }
    forceDraw();
    return true;
  }

  function handleKeyboardPageTurn(event) {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isEditableTarget(event.target) ||
      document.querySelector("dialog[open]") ||
      readerEditing
    ) return;

    const direction = event.key === "ArrowRight"
      ? "next"
      : event.key === "ArrowLeft"
        ? "prev"
        : "";
    if (!direction || !turnPage(direction)) return;
    event.preventDefault();
  }

  function showTarget(section, animate) {
    const target = sectionStarts.get(section);
    if (target == null || !pageFlip) return;
    turnToPageIndex(target, false);
  }

  function sectionOffset(section) {
    const start = sectionStarts.get(section);
    if (start == null || !pageFlip) return 0;
    return Math.max(0, pageFlip.getCurrentPageIndex() - start);
  }

  function pageForSectionOffset(section, offset) {
    const start = sectionStarts.get(section);
    if (start == null) return sectionStarts.get("home") || 0;
    const sectionPages = pages
      .map((page, index) => page.dataset.bookSection === section ? index : -1)
      .filter((index) => index >= start);
    const last = sectionPages.length ? sectionPages[sectionPages.length - 1] : start;
    return Math.min(start + Math.max(0, offset), last);
  }

  function selectorValue(value) {
    return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }

  function pageForReaderHeading(headingId) {
    if (!headingId) return null;
    const selector = `[data-reader-heading-id="${selectorValue(headingId)}"]`;
    const index = pages.findIndex((page) => page.dataset.bookSection === "reader" && page.querySelector(selector));
    return index >= 0 ? index : null;
  }

  function turnToPageIndex(pageIndex, animate = false) {
    if (!pageFlip || pageIndex == null || pageIndex < 0 || pageIndex >= pages.length) return false;
    const section = pages[pageIndex]?.dataset.bookSection;
    suppressFlipHistory = true;
    if (SECTION_ORDER.includes(section)) setActiveSection(section);
    if (animate && !reducedMotion.matches) {
      beginFlipSound();
      pageFlip.flip(pageIndex, "top");
      forceDraw();
      window.setTimeout(forceDraw, 30);
    } else {
      pageFlip.turnToPage(pageIndex);
      forceDraw();
    }
    window.setTimeout(() => { suppressFlipHistory = false; }, animate ? 560 : 30);
    return true;
  }

  function rebuild(reason = "content") {
    if (!ready) return;
    if (rebuilding) {
      pendingRebuildReason = reason;
      return;
    }
    if (pageFlip?.getState?.() !== "read") {
      pendingRebuildReason = reason;
      return;
    }

    rebuilding = true;
    window.clearTimeout(repaginateTimer);
    repaginateTimer = 0;
    const preserveSection = requestedHeadingAfterRebuild ? "reader" : (requestedSectionAfterRebuild || currentSection);
    const preserveOffset = requestedHeadingAfterRebuild ? 0 : (requestedOffsetAfterRebuild ?? sectionOffset(preserveSection));
    requestedSectionAfterRebuild = "";
    requestedOffsetAfterRebuild = null;
    restoreSource();
    pageFlip.destroy();
    createBookRoot();
    setBookDimensions();
    buildPages();
    mountPageFlip(pageForSectionOffset(sectionStarts.has(preserveSection) ? preserveSection : "home", preserveOffset));
  }

  function repaginate(reason = "content") {
    if (!ready) return;
    window.clearTimeout(repaginateTimer);
    pendingRebuildReason = reason;
    repaginateTimer = window.setTimeout(() => {
      repaginateTimer = 0;
      const queuedReason = pendingRebuildReason;
      pendingRebuildReason = "";
      rebuild(queuedReason || reason);
    }, reason === "characters" ? 220 : 160);
  }

  function goToSection(name, options = {}) {
    if (!ready || !sectionStarts.has(name)) return;
    const { updateHash = true, replaceHash = false, animate = true } = options;
    document.getElementById("mainNav")?.classList.remove("open");
    document.getElementById("menuToggle")?.setAttribute("aria-expanded", "false");
    if (updateHash && name !== "reader") {
      history[replaceHash ? "replaceState" : "pushState"](null, "", `#${name}`);
    }
    showTarget(name, animate);
  }

  function openReader(bookId, chapterIndex, options = {}) {
    if (!ready) return;
    const { updateHash = true, replaceHash = false, animate = true, headingId = "" } = options;
    if (updateHash) {
      history[replaceHash ? "replaceState" : "pushState"](null, "", `#read/${bookId}/${chapterIndex}`);
    }
    requestedSectionAfterRebuild = "reader";
    requestedOffsetAfterRebuild = 0;
    requestedHeadingAfterRebuild = headingId;
    if (sectionStarts.has("reader")) showTarget("reader", animate);
    repaginate("reader");
  }

  function goToReaderHeading(headingId, options = {}) {
    if (!ready || !headingId) return false;
    const targetPage = pageForReaderHeading(headingId);
    if (targetPage == null) {
      requestedHeadingAfterRebuild = headingId;
      repaginate("reader-heading");
      return false;
    }
    requestedHeadingAfterRebuild = "";
    return turnToPageIndex(targetPage, Boolean(options.animate));
  }

  function setReaderEditing(enabled) {
    readerEditing = Boolean(enabled);
    document.body.classList.toggle("book-reader-editing", readerEditing);
    requestedSectionAfterRebuild = "reader";
    requestedOffsetAfterRebuild = 0;
    repaginate(enabled ? "reader-edit-start" : "reader-edit-end");
  }

  function prepareDynamicContent(section) {
    restoreDynamicGrid(section);
  }

  function prepareDocument() {
    const main = document.querySelector("main");
    sourceRoot = document.createElement("div");
    sourceRoot.id = "bookSource";
    sourceRoot.className = "book-source";
    document.querySelectorAll("main > .view").forEach((view) => {
      view.classList.remove("active");
      sourceRoot.appendChild(view);
    });

    stage = document.createElement("div");
    stage.id = "bookStage";
    stage.className = "book-stage";

    homePanel = document.createElement("aside");
    homePanel.id = "bookHomePanel";
    homePanel.className = "book-home-panel";
    homePanel.setAttribute("aria-label", "首页介绍");
    homePanelContent = document.createElement("div");
    homePanelContent.className = "book-home-panel-content";
    homePanel.appendChild(homePanelContent);

    createBookRoot();
    stage.prepend(homePanel);
    main.append(stage, sourceRoot);

    document.querySelectorAll("dialog").forEach((dialog) => document.body.appendChild(dialog));
    setBookDimensions();
  }

  function initialize() {
    if (ready) return true;
    if (!window.St?.PageFlip) {
      document.body.classList.add("book-plugin-unavailable");
      finishBoot();
      return false;
    }

    try {
      prepareDocument();
      buildPages();
      ready = true;
      document.body.classList.add("book-mode");
      mountPageFlip(requestedSectionFromHash());
    } catch (error) {
      document.body.classList.add("book-plugin-unavailable");
      finishBoot();
      console.error("SiteBook initialization failed.", error);
      return false;
    }

    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        setBookDimensions();
        repaginate("resize");
      }, 180);
    });
    document.addEventListener("keydown", handleKeyboardPageTurn);
    document.fonts?.ready?.then(() => repaginate("fonts")).catch(() => {});
    document.addEventListener("load", (event) => {
      if (
        event.target instanceof HTMLImageElement &&
        event.target.id !== "atlasImage" &&
        !event.target.closest(".book-generated-clone")
      ) {
        repaginate("image");
      }
    }, true);
    return true;
  }

  window.SiteBook = {
    initialize,
    isReady: () => ready,
    goToSection,
    openReader,
    goToReaderHeading,
    repaginate,
    prepareDynamicContent,
    setReaderEditing,
    nextPage: () => turnPage("next"),
    previousPage: () => turnPage("prev"),
    getCurrentSection: () => currentSection,
    getPageCount: () => pageFlip?.getPageCount?.() || 0
  };

})();
