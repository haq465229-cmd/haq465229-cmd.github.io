const books = window.ARCHIVE_BOOKS || [];
const atlasMaps = window.ATLAS_MAPS || [];
const baseCharacters = window.ARCHIVE_CHARACTERS || [];
const views = [...document.querySelectorAll(".view")];
const navButtons = [...document.querySelectorAll(".nav-trigger")];
const bookGrid = document.getElementById("bookGrid");
const atlasList = document.getElementById("atlasList");
const atlasImage = document.getElementById("atlasImage");
const atlasTitle = document.getElementById("atlasTitle");
const atlasEnglish = document.getElementById("atlasEnglish");
const atlasNote = document.getElementById("atlasNote");
const atlasCounter = document.getElementById("atlasCounter");
const characterGallery = document.getElementById("characterGallery");
const characterCount = document.getElementById("characterCount");
const characterSearch = document.getElementById("characterSearch");
const characterEmpty = document.getElementById("characterEmpty");
const characterForm = document.getElementById("characterForm");
const characterImageInput = document.getElementById("characterImageInput");
const portraitPreview = document.getElementById("portraitPreview");
const portraitUploadLabel = document.getElementById("portraitUploadLabel");
const characterNameInput = document.getElementById("characterNameInput");
const characterIntroInput = document.getElementById("characterIntroInput");
const characterFormStatus = document.getElementById("characterFormStatus");
const characterFormMode = document.getElementById("characterFormMode");
const characterSubmitButton = document.getElementById("characterSubmitButton");
const characterCancelEdit = document.getElementById("characterCancelEdit");
const exportCharactersButton = document.getElementById("exportCharactersButton");
const menuToggle = document.getElementById("menuToggle");
const mainNav = document.getElementById("mainNav");
const backgroundMusic = document.getElementById("backgroundMusic");
const musicToggle = document.getElementById("musicToggle");
const musicTrackSelect = document.getElementById("musicTrackSelect");
const musicStatus = document.getElementById("musicStatus");
const pageSoundToggle = document.getElementById("pageSoundToggle");
const pageTurnSound = document.getElementById("pageTurnSound");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const musicTracks = {
  wings: {
    title: "Wings in his Eyes",
    artist: "Eleni Mandell",
    source: "assets/music/wings-in-his-eyes.mp3"
  },
  siren: {
    title: "Song to the Siren",
    artist: "Rose Betts",
    source: "assets/music/song-to-the-siren.mp3"
  }
};
const introScreen = document.getElementById("introScreen");
const introCourse = document.getElementById("introCourse");
const introStatus = document.getElementById("introStatus");
const introPercent = document.getElementById("introPercent");
const introModeChoices = document.getElementById("introModeChoices");
const introModeButtons = [...document.querySelectorAll("[data-display-mode]")];
const introTaskWeights = {
  background: 28,
  wordmark: 22,
  fonts: 18,
  window: 17,
  app: 15
};
const introReadyTasks = new Set();
const introMinimumDuration = 4000;
const introTimeout = 12000;

let currentBook = null;
let currentChapter = 0;
let currentHeadingId = "";
let currentView = "home";
let currentMapIndex = 0;
let customCharacters = [];
let pendingPortraitData = "";
let editingCharacterId = "";
let musicResumePending = false;
let introActive = Boolean(introScreen && document.documentElement.classList.contains("intro-enabled"));
let introStartedAt = 0;
let introDisplayedProgress = 0;
let introTimedOut = false;
let introComplete = false;
let revealObserver = null;
let mapTransitionTimer = 0;
let motionFrame = 0;
let motionGestureReady = false;
const tiltBoundElements = new WeakSet();
const expandedReaderHeadings = new Set();
const expandedTocChapters = new Set();

const motionRevealSelector = [
  ".section-hero > div",
  ".archive-intro > div",
  ".letter-paper > p",
  ".letter-paper > blockquote",
  ".letter-paper > footer",
  ".atlas-index > *",
  ".atlas-viewer",
  ".character-card",
  ".gallery-card",
  ".book-card",
  ".settings-panel > .setting-row",
  ".reader-paper > header",
  ".chapter-body > *",
  ".reader-actions"
].join(",");

const motionTiltSelector = ".character-card, .gallery-card, .book-card";

function registerMotionGesture() {
  if (motionGestureReady) return;
  motionGestureReady = true;
  if (!pageTurnSound || !pageSoundToggle?.checked) return;
  const previousVolume = pageTurnSound.volume;
  pageTurnSound.volume = 0;
  pageTurnSound.play()
    .then(() => {
      pageTurnSound.pause();
      pageTurnSound.currentTime = 0;
      pageTurnSound.volume = previousVolume || .2;
    })
    .catch(() => {
      pageTurnSound.volume = previousVolume || .2;
    });
}

function playPageTurnSound() {
  if (!motionGestureReady || !pageSoundToggle?.checked || !pageTurnSound) return;
  pageTurnSound.volume = .2;
  pageTurnSound.currentTime = 0;
  pageTurnSound.play().catch(() => {});
}

function bindMotionTilt(element) {
  if (tiltBoundElements.has(element)) return;
  tiltBoundElements.add(element);
}

function refreshMotion(root = document) {
}

function animateCurrentView() {
  const activeView = document.querySelector(".view.active");
  if (!activeView) return;
  activeView.classList.remove("view-cinematic-enter");
}

function closeCinematicDialog(dialog) {
  if (!dialog?.open) return;
  dialog.classList.remove("is-opening", "is-closing");
  dialog.close();
}

function openCinematicDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove("is-opening", "is-closing");
  dialog.showModal();
}

function settleBookPages(pageIndex, shouldPlaySound = true) {
  if (shouldPlaySound) playPageTurnSound();
}

function updateCinematicParallax(event) {
}

function initializeCinematicMotion() {
  document.addEventListener("pointerdown", registerMotionGesture, { once: true, passive: true });
  document.addEventListener("keydown", registerMotionGesture, { once: true });
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeCinematicDialog(dialog);
    });
  });
}

window.EchoesMotion = {
  refresh: refreshMotion,
  animateCurrentView,
  openDialog: openCinematicDialog,
  closeDialog: closeCinematicDialog,
  onBookTurnStart: playPageTurnSound,
  onBookFlip: settleBookPages
};

function setIntroBackgroundInert(isInert) {
  [document.querySelector(".site-header"), document.querySelector("main"), document.querySelector(".site-footer")]
    .filter(Boolean)
    .forEach((element) => {
      element.inert = isInert;
    });
}

function markIntroTaskReady(task) {
  if (introActive && introTaskWeights[task]) introReadyTasks.add(task);
}

function introResourceProgress() {
  return [...introReadyTasks].reduce((total, task) => total + introTaskWeights[task], 0);
}

function setIntroProgress(progress) {
  const boundedProgress = Math.min(100, Math.max(0, progress));
  introDisplayedProgress = boundedProgress;
  introCourse.style.setProperty("--intro-progress", `${boundedProgress}%`);
  introPercent.textContent = `${Math.round(boundedProgress)}%`;
}

function updateIntroStatus(progress) {
  if (progress < 24) {
    introStatus.textContent = "Opening the first leaf...";
  } else if (progress < 52) {
    introStatus.textContent = "Gathering the scattered chronicles...";
  } else if (progress < 78) {
    introStatus.textContent = "Calling the names back from memory...";
  } else {
    introStatus.textContent = "Preparing the archive...";
  }
}

function completeIntro() {
  if (introComplete) return;
  introComplete = true;
  setIntroProgress(100);
  introStatus.textContent = "The archive is ready.";
  introScreen.classList.add("is-ready");
  introModeButtons.forEach((button) => { button.disabled = false; });
  window.setTimeout(() => introModeButtons[0]?.focus({ preventScroll: true }), 460);
}

function animateIntroProgress(now) {
  if (!introActive || introComplete) return;
  const elapsed = now - introStartedAt;
  const resourceProgress = introResourceProgress();
  const pacedCap = Math.min(96, 6 + (elapsed / introMinimumDuration) * 90);
  const target = introTimedOut || (resourceProgress >= 100 && elapsed >= introMinimumDuration)
    ? 100
    : Math.min(resourceProgress, pacedCap);
  const distance = target - introDisplayedProgress;

  if (distance > 0) {
    setIntroProgress(introDisplayedProgress + Math.min(distance, Math.max(.14, distance * .075)));
    updateIntroStatus(introDisplayedProgress);
  }

  if (introDisplayedProgress >= 99.5) {
    completeIntro();
    return;
  }

  requestAnimationFrame(animateIntroProgress);
}

function watchIntroImage(image, task) {
  if (!image) {
    markIntroTaskReady(task);
    return;
  }
  if (image.complete && image.naturalWidth) {
    markIntroTaskReady(task);
    return;
  }
  image.addEventListener("load", () => markIntroTaskReady(task), { once: true });
  image.addEventListener("error", () => markIntroTaskReady(task), { once: true });
}

function initializeIntro() {
  if (!introActive) {
    introScreen?.setAttribute("aria-hidden", "true");
    return;
  }

  setIntroBackgroundInert(true);
  introStartedAt = performance.now();

  const pageBackground = new Image();
  watchIntroImage(pageBackground, "background");
  pageBackground.src = "assets/page-background.png";
  watchIntroImage(document.querySelector(".hero-title-wordmark"), "wordmark");

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => markIntroTaskReady("fonts")).catch(() => markIntroTaskReady("fonts"));
  } else {
    markIntroTaskReady("fonts");
  }

  if (document.readyState === "complete") {
    markIntroTaskReady("window");
  } else {
    window.addEventListener("load", () => markIntroTaskReady("window"), { once: true });
  }

  window.setTimeout(() => {
    if (introComplete) return;
    introTimedOut = true;
    introStatus.textContent = "Completing the first leaf...";
  }, introTimeout);

  requestAnimationFrame(animateIntroProgress);
}

function enterArchiveFromIntro(displayMode) {
  if (!introActive || !introComplete) return;
  let selectedMode = displayMode === "book" ? "book" : "classic";

  try {
    localStorage.setItem("echoesDisplayMode", selectedMode);
  } catch {
    // The current visit can still continue if storage is unavailable.
  }

  introModeButtons.forEach((button) => { button.disabled = true; });
  document.body.classList.toggle("classic-mode", selectedMode === "classic");
  if (selectedMode === "book") {
    document.documentElement.classList.add("book-booting");
    window.setTimeout(() => document.documentElement.classList.remove("book-booting"), 5000);
    if (!window.SiteBook?.initialize?.()) {
      selectedMode = "classic";
      document.body.classList.add("classic-mode");
      document.documentElement.classList.remove("book-booting");
    }
  } else {
    document.documentElement.classList.remove("book-booting");
  }

  introScreen.classList.add("is-leaving");

  window.setTimeout(() => {
    introActive = false;
    document.documentElement.classList.remove("intro-enabled");
    introScreen.setAttribute("aria-hidden", "true");
    setIntroBackgroundInert(false);
    document.querySelector(".hero-view .ornate-button")?.focus({ preventScroll: true });
  }, 900);
}

introModeChoices?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-display-mode]");
  if (button) enterArchiveFromIntro(button.dataset.displayMode);
});

function romanize(number) {
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  return numerals[number - 1] || number;
}

function safeImageSource(value) {
  const source = String(value || "");
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(source)) return source;
  if (/^(?:assets\/|\.\/assets\/)[A-Za-z0-9_./ -]+$/.test(source) && !source.includes("..")) return source;
  return "";
}

function compactTitleText(value) {
  return String(value || "").replace(/[\s\u200b\u200c\u200d\ufeff]+/g, "").toLowerCase();
}

function bookEnglishLabel(book) {
  const english = String(book?.english || "").trim();
  if (!english) return "";
  return compactTitleText(book?.title).includes(compactTitleText(english)) ? "" : english;
}

function renderBooks() {
  window.SiteBook?.prepareDynamicContent?.("archive");
  bookGrid.innerHTML = books.map((book, index) => `
    <button class="book-card" data-book-id="${escapeHtml(book.id)}" aria-label="打开《${escapeHtml(book.title)}》">
      <span class="book-number">VOL. ${romanize(index + 1)}</span>
      <span class="book-cover">
        <img src="${safeImageSource(book.cover)}" alt="${escapeHtml(book.title)}封面">
        <span class="book-glint"></span>
      </span>
      <span class="book-meta">
        <strong>${escapeHtml(book.title)}</strong>
        ${bookEnglishLabel(book) ? `<em>${escapeHtml(bookEnglishLabel(book))}</em>` : ""}
      </span>
    </button>
  `).join("");

  document.querySelectorAll(".book-card").forEach((card) => {
    card.addEventListener("click", () => {
      const book = books.find((item) => item.id === card.dataset.bookId);
      openReader(book, 0);
    });
  });
  refreshMotion(bookGrid);
  window.SiteBook?.repaginate?.("books");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeRichColor(value) {
  const color = String(value || "").trim();
  return /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(color) ? color : "";
}

function safeRichLink(value) {
  const link = String(value || "").trim();
  return /^(?:https?:\/\/|mailto:|#)/i.test(link) ? link : "";
}

function renderRichRuns(runs, fallbackText = "") {
  const safeRuns = Array.isArray(runs) && runs.length ? runs : [{ text: fallbackText }];
  return safeRuns.map((run) => {
    const style = [];
    const font = String(run.font || "").replace(/["';:(){}<>\\]/g, "").trim().slice(0, 120);
    if (font) style.push(`font-family:${escapeHtml(font)}, "Noto Serif SC", serif`);
    if (run.sizeRatio) style.push(`font-size:${Math.min(6, Math.max(.5, Number(run.sizeRatio) || 1))}em`);
    const color = safeRichColor(run.color);
    const background = safeRichColor(run.background);
    if (color) style.push(`color:${color}`);
    if (background) style.push(`background-color:${background}`);
    if (run.superscript) style.push("vertical-align:super;font-size:.75em");
    if (run.subscript) style.push("vertical-align:sub;font-size:.75em");
    let text = escapeHtml(run.text || "").replace(/\n/g, "<br>");
    if (run.strike) text = `<s>${text}</s>`;
    if (run.underline) text = `<u>${text}</u>`;
    if (run.italic) text = `<em>${text}</em>`;
    if (run.bold) text = `<strong>${text}</strong>`;
    if (style.length) text = `<span style="${style.join(";")}">${text}</span>`;
    const link = safeRichLink(run.link);
    return link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
  }).join("");
}

function plainTextFromRuns(runs, fallbackText = "") {
  const safeRuns = Array.isArray(runs) && runs.length ? runs : [{ text: fallbackText }];
  return safeRuns.map((run) => run.text || "").join("").trim();
}

function safeIdPart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "book";
}

function readerHeadingId(chapterIndex, blockIndex) {
  return `reader-heading-${safeIdPart(currentBook?.id)}-${chapterIndex}-${blockIndex}`;
}

function readerChapterTocId(chapterIndex) {
  return `reader-chapter-${safeIdPart(currentBook?.id)}-${chapterIndex}`;
}

function readerBookTocId() {
  return `reader-book-${safeIdPart(currentBook?.id)}`;
}

function isSyntheticChapter(chapter) {
  return Boolean(chapter?.synthetic);
}

function readerDisplayLevel(level) {
  return Math.min(4, Math.max(1, Number(level) || 1));
}

function readerTocLevel(block) {
  return readerDisplayLevel(blockHeadingLevel(block));
}

function readerHeadingTagLevel(block) {
  return readerDisplayLevel(blockHeadingLevel(block));
}

function blockHeadingLevel(block) {
  return Math.min(6, Math.max(2, Number(block?.level) || 3));
}

function readerHeadingText(block) {
  return plainTextFromRuns(block?.runs, block?.text);
}

function isReaderHeadingBlock(block) {
  if (block?.type !== "heading") return false;
  const title = readerHeadingText(block);
  if (!title) return false;
  if (title.length > 60) return false;
  return !/[。！？；：，,.!?;:]/.test(title);
}

function chapterBlocks(chapter) {
  return chapter.blocks || (chapter.paragraphs || []).map((text) => ({ type: "paragraph", text }));
}

function headingControlsContent(blocks, blockIndex, level) {
  for (let index = blockIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (isReaderHeadingBlock(block) && blockHeadingLevel(block) <= level) return false;
    return true;
  }
  return false;
}

function expandReaderHeadingPath(chapter, chapterIndex, headingId) {
  if (!headingId) return;
  expandedTocChapters.add(readerBookTocId());
  expandedTocChapters.add(readerChapterTocId(chapterIndex));
  const blocks = chapterBlocks(chapter);
  const targetIndex = blocks.findIndex((block, blockIndex) =>
    isReaderHeadingBlock(block) && readerHeadingId(chapterIndex, blockIndex) === headingId
  );
  if (targetIndex < 0) return;

  let level = blockHeadingLevel(blocks[targetIndex]);
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!isReaderHeadingBlock(block)) continue;
    const candidateLevel = blockHeadingLevel(block);
    if (candidateLevel >= level) continue;
    expandedReaderHeadings.add(readerHeadingId(chapterIndex, index));
    level = candidateLevel;
  }
}

function readerTocItems(book) {
  const items = [{
    type: "book",
    level: 1,
    outlineLevel: 1,
    chapterIndex: 0,
    tocId: readerBookTocId(),
    title: book?.title || "",
    marker: ""
  }];

  (book?.chapters || []).forEach((chapter, chapterIndex) => {
    if (!isSyntheticChapter(chapter)) {
      items.push({
        type: "chapter",
        level: 2,
        outlineLevel: 2,
        chapterIndex,
        tocId: readerChapterTocId(chapterIndex),
        title: chapter.title,
        marker: String(chapterIndex + 1).padStart(2, "0")
      });
    }
    chapterBlocks(chapter).forEach((block, blockIndex) => {
      if (!isReaderHeadingBlock(block)) return;
      const title = readerHeadingText(block);
      if (!title) return;
      items.push({
        type: "heading",
        level: readerTocLevel(block),
        outlineLevel: blockHeadingLevel(block),
        chapterIndex,
        tocId: readerHeadingId(chapterIndex, blockIndex),
        headingId: readerHeadingId(chapterIndex, blockIndex),
        title,
        marker: ""
      });
    });
  });

  return applyReaderTocFoldState(items);
}

function tocItemControlsContent(items, itemIndex) {
  const item = items[itemIndex];
  if (!item) return false;
  const itemLevel = Number(item.outlineLevel) || Number(item.level) || 1;
  for (let index = itemIndex + 1; index < items.length; index += 1) {
    const nextLevel = Number(items[index].outlineLevel) || Number(items[index].level) || 1;
    if (nextLevel <= itemLevel) return false;
    return true;
  }
  return false;
}

function isReaderTocItemExpanded(item) {
  if (item?.type === "book" || item?.type === "chapter") return expandedTocChapters.has(item.tocId);
  return expandedReaderHeadings.has(item?.headingId);
}

function applyReaderTocFoldState(items) {
  const collapsedStack = [];
  return items.map((item, index) => {
    const outlineLevel = Number(item.outlineLevel) || Number(item.level) || 1;
    while (collapsedStack.length && collapsedStack[collapsedStack.length - 1] >= outlineLevel) collapsedStack.pop();
    const canFold = tocItemControlsContent(items, index);
    const collapsed = canFold && !isReaderTocItemExpanded(item);
    const nextItem = {
      ...item,
      canFold,
      collapsed,
      hiddenByTocFold: collapsedStack.length > 0
    };
    if (collapsed) collapsedStack.push(outlineLevel);
    return nextItem;
  });
}

function scrollReaderToHeading(headingId) {
  if (!headingId) return;
  requestAnimationFrame(() => {
    document.getElementById(headingId)?.scrollIntoView({ behavior: "auto", block: "start" });
  });
}

function renderChapterBlocks(chapter, chapterIndex = currentChapter) {
  const blocks = chapterBlocks(chapter);
  let firstParagraph = true;

  return blocks.map((block, blockIndex) => {
    const blockStyles = [];
    if (["left", "center", "right", "justify"].includes(block.align)) blockStyles.push(`text-align:${block.align}`);
    if (Number(block.indent) > 0) blockStyles.push(`margin-left:${Math.min(8, Number(block.indent)) * 2}em`);
    const alignment = blockStyles.length ? ` style="${blockStyles.join(";")}"` : "";
    if (block.type === "image") {
      const width = Math.min(100, Math.max(15, Number(block.width) || 80));
      const figureAlign = ["left", "right", "center"].includes(block.align) ? block.align : "center";
      return `<figure class="chapter-figure chapter-figure-${figureAlign}" style="width:${width}%">
        <img src="${safeImageSource(block.src)}" alt="${escapeHtml(block.alt || block.caption || "正文图片")}" loading="lazy">
        ${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}
      </figure>`;
    }
    if (block.type === "divider") return '<hr class="chapter-divider">';
    if (block.type === "table") {
      return `<div class="chapter-table-wrap"><table class="chapter-table"><tbody>${(block.rows || []).map((row, rowIndex) =>
        `<tr>${(row || []).map((cell) => {
          const tag = block.header && rowIndex === 0 ? "th" : "td";
          return `<${tag}>${renderRichRuns(cell.runs, cell.text)}</${tag}>`;
        }).join("")}</tr>`
      ).join("")}</tbody></table></div>`;
    }
    if (block.type === "list") {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}${alignment}>${(block.items || []).map((item) => `<li>${renderRichRuns(item.runs, item.text)}</li>`).join("")}</${tag}>`;
    }
    if (isReaderHeadingBlock(block)) {
      const hLevel = blockHeadingLevel(block);
      const tagLevel = readerHeadingTagLevel(block);
      const levelClass = hLevel >= 5 ? "chapter-minor-heading" : "chapter-subheading";
      const headingId = readerHeadingId(chapterIndex, blockIndex);
      const canFold = headingControlsContent(blocks, blockIndex, hLevel);
      const isCollapsed = canFold && !expandedReaderHeadings.has(headingId);
      const foldClass = canFold ? ` chapter-fold-heading${isCollapsed ? " is-collapsed" : ""}` : "";
      const foldLabel = isCollapsed ? "展开本节" : "折叠本节";
      const foldButton = canFold ? `<button class="chapter-fold-toggle" type="button" data-heading-id="${headingId}" aria-label="${foldLabel}" title="${foldLabel}" aria-expanded="${String(!isCollapsed)}"></button>` : "";
      return `<h${tagLevel} id="${headingId}" class="${levelClass}${foldClass}" data-reader-heading-id="${headingId}" data-reader-heading-level="${hLevel}" data-reader-heading-display-level="${tagLevel}"${alignment}>${foldButton}<span class="chapter-heading-text">${renderRichRuns(block.runs, block.text)}</span></h${tagLevel}>`;
    }
    if (block.type === "quote") {
      return `<blockquote${alignment}>${renderRichRuns(block.runs, block.text)}</blockquote>`;
    }

    const className = firstParagraph ? ' class="first-paragraph"' : "";
    firstParagraph = false;
    return `<p${className}${alignment}>${renderRichRuns(block.runs, block.text)}</p>`;
  }).join("");
}

function readerHeadingLevel(element) {
  return Number(element?.dataset?.readerHeadingLevel) || Number(String(element?.tagName || "").slice(1)) || 6;
}

function setReaderHeadingFoldState(heading, hiddenByParent = false) {
  const headingId = heading?.dataset?.readerHeadingId || "";
  const button = heading?.querySelector?.(".chapter-fold-toggle");
  const isCollapsed = Boolean(button) && !expandedReaderHeadings.has(headingId);
  heading?.classList?.toggle("is-collapsed", isCollapsed);
  heading?.classList?.toggle("is-hidden-by-fold", hiddenByParent);
  if (heading) heading.hidden = hiddenByParent;
  if (!button) return;
  const foldLabel = isCollapsed ? "展开本节" : "折叠本节";
  button.setAttribute("aria-expanded", String(!isCollapsed));
  button.setAttribute("aria-label", foldLabel);
  button.setAttribute("title", foldLabel);
}

function applyReaderHeadingFolds(root = document.getElementById("chapterBody")) {
  if (!root) return;
  const collapsedStack = [];
  [...root.children].forEach((element) => {
    if (element.matches("[data-reader-heading-id][data-reader-heading-level]")) {
      const level = readerHeadingLevel(element);
      while (collapsedStack.length && collapsedStack[collapsedStack.length - 1] >= level) collapsedStack.pop();
      const hiddenByParent = collapsedStack.length > 0;
      setReaderHeadingFoldState(element, hiddenByParent);
      if (element.querySelector(".chapter-fold-toggle") && !expandedReaderHeadings.has(element.dataset.readerHeadingId)) collapsedStack.push(level);
      return;
    }

    const isHidden = collapsedStack.length > 0;
    element.classList.toggle("is-hidden-by-fold", isHidden);
    element.hidden = isHidden;
  });
}

function syncReaderHeadingFoldControls(headingId) {
  if (!headingId) return;
  const safeHeadingId = window.CSS?.escape ? window.CSS.escape(headingId) : headingId.replace(/["\\]/g, "\\$&");
  document.querySelectorAll(`[data-reader-heading-id="${safeHeadingId}"]`).forEach((heading) => {
    setReaderHeadingFoldState(heading, heading.hidden);
  });
}

function toggleReaderHeadingFold(headingId) {
  if (!headingId) return;
  if (expandedReaderHeadings.has(headingId)) expandedReaderHeadings.delete(headingId);
  else expandedReaderHeadings.add(headingId);
  applyReaderHeadingFolds();
  syncReaderHeadingFoldControls(headingId);
  renderReaderToc();
  refreshMotion(document.getElementById("readerView"));
  window.SiteBook?.goToReaderHeading?.(headingId, { animate: false });
  window.SiteBook?.repaginate?.("reader-fold");
}

function toggleReaderTocFold(button) {
  if (!currentBook || !button) return;
  const headingId = button.dataset.headingId || "";
  if (headingId) {
    toggleReaderHeadingFold(headingId);
    return;
  }

  const tocId = button.dataset.tocId || "";
  if (!tocId) return;
  if (expandedTocChapters.has(tocId)) expandedTocChapters.delete(tocId);
  else expandedTocChapters.add(tocId);
  renderReaderToc();
  window.SiteBook?.repaginate?.("reader-toc-fold");
}

function renderReaderToc() {
  const chapterList = document.getElementById("chapterList");
  if (!chapterList || !currentBook) return;
  chapterList.innerHTML = readerTocItems(currentBook).map((item) => {
    const isActive = item.type === "chapter"
      ? item.chapterIndex === currentChapter && !currentHeadingId
      : item.headingId === currentHeadingId;
    const foldLabel = item.collapsed ? "展开目录项" : "折叠目录项";
    const foldControl = item.canFold
      ? `<button class="toc-fold-toggle" type="button" data-toc-id="${escapeHtml(item.tocId)}"${item.headingId ? ` data-heading-id="${escapeHtml(item.headingId)}"` : ""} aria-label="${foldLabel}" title="${foldLabel}" aria-expanded="${String(!item.collapsed)}"></button>`
      : '<span class="toc-fold-spacer" aria-hidden="true"></span>';
    const outlineLevel = Number(item.outlineLevel) || Number(item.level) || 1;
    return `
      <div class="toc-item toc-level-${item.level} toc-outline-level-${outlineLevel}${isActive ? " active" : ""}${item.canFold ? " has-toc-children" : ""}${item.collapsed ? " is-collapsed" : ""}${item.hiddenByTocFold ? " is-hidden-by-toc-fold" : ""}" data-toc-id="${escapeHtml(item.tocId)}" data-outline-level="${outlineLevel}"${item.hiddenByTocFold ? " hidden" : ""}>
        ${foldControl}
        <button class="toc-link" data-chapter="${item.chapterIndex}"${item.headingId ? ` data-heading-id="${escapeHtml(item.headingId)}"` : ""} type="button">
          <span class="toc-marker">${escapeHtml(item.marker)}</span><span class="toc-label">${escapeHtml(item.title)}</span>
        </button>
      </div>
    `;
  }).join("");
}

function renderAtlas() {
  if (!atlasMaps.length || !atlasList) return;

  atlasList.innerHTML = atlasMaps.map((map, index) => `
    <button class="atlas-item" data-map-index="${index}" type="button">
      <img src="${map.image}" alt="${map.title}缩略图">
      <span>
        <small>${String(index + 1).padStart(2, "0")} · ${map.english}</small>
        <strong>${map.title}</strong>
      </span>
    </button>
  `).join("");

  document.querySelectorAll(".atlas-item").forEach((button) => {
    button.addEventListener("click", () => selectAtlasMap(Number(button.dataset.mapIndex)));
  });

  selectAtlasMap(0);
}

function selectAtlasMap(index) {
  if (!atlasMaps.length) return;
  currentMapIndex = Math.min(Math.max(index, 0), atlasMaps.length - 1);
  const map = atlasMaps[currentMapIndex];

  atlasImage.src = map.image;
  atlasImage.alt = `${map.title}地图`;
  atlasTitle.textContent = map.title;
  atlasEnglish.textContent = map.english;
  atlasNote.textContent = map.note;
  atlasCounter.textContent = `${String(currentMapIndex + 1).padStart(2, "0")} / ${String(atlasMaps.length).padStart(2, "0")}`;

  document.querySelectorAll(".atlas-item").forEach((button, index) => {
    button.classList.toggle("active", index === currentMapIndex);
  });

  document.getElementById("prevMap").disabled = currentMapIndex === 0;
  document.getElementById("nextMap").disabled = currentMapIndex === atlasMaps.length - 1;
  window.clearTimeout(mapTransitionTimer);
}

function characterPlaceholder(name) {
  const initial = escapeHtml((name || "?").trim().slice(0, 1) || "?");
  return `<div class="portrait-placeholder"><span>${initial}</span></div>`;
}

function mergedCharacters() {
  const characterMap = new Map(baseCharacters.map((character) => [character.id, character]));

  customCharacters.forEach((character) => {
    if (character.deleted) {
      characterMap.delete(character.id);
      return;
    }

    if (!characterMap.has(character.id) || character.override) {
      characterMap.set(character.id, character);
    }
  });

  return [...characterMap.values()];
}

function visibleCharacters() {
  const query = (characterSearch.value || "").trim().toLowerCase();
  return mergedCharacters().filter((character) => {
    if (!query) return true;
    return `${character.name} ${character.intro}`.toLowerCase().includes(query);
  });
}

function renderCharacters() {
  if (!characterGallery) return;
  window.SiteBook?.prepareDynamicContent?.("characters");
  const characters = visibleCharacters();
  const developerMode = document.body.classList.contains("developer-mode");

  characterCount.textContent = `${characters.length} CHARACTERS`;
  characterEmpty.classList.toggle("visible", characters.length === 0);
  characterGallery.innerHTML = characters.map((character) => `
    <article class="character-card">
      <div class="character-portrait">
        ${character.image ? `<img src="${character.image}" alt="${escapeHtml(character.name)}肖像" loading="lazy" decoding="async">` : characterPlaceholder(character.name)}
      </div>
      <div class="character-info">
        <h2>${escapeHtml(character.name)}</h2>
        <p>${escapeHtml(character.intro)}</p>
      </div>
      ${developerMode ? `
        <div class="character-manage-actions">
          <button class="character-edit" data-character-id="${character.id}" type="button">修改</button>
          <button class="character-delete" data-character-id="${character.id}" type="button">删除</button>
        </div>
      ` : ""}
    </article>
  `).join("");

  document.querySelectorAll(".character-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const character = mergedCharacters().find((item) => item.id === button.dataset.characterId);
      if (!window.confirm(`确定删除人物“${character?.name || "未命名人物"}”吗？`)) return;
      const baseCharacterExists = baseCharacters.some((item) => item.id === button.dataset.characterId);
      if (baseCharacterExists) {
        const tombstone = { id: button.dataset.characterId, deleted: true, custom: true, override: true };
        customCharacters = [
          ...customCharacters.filter((item) => item.id !== button.dataset.characterId),
          tombstone
        ];
        await saveCustomCharacter(tombstone);
      } else {
        await deleteCustomCharacter(button.dataset.characterId);
        customCharacters = customCharacters.filter((item) => item.id !== button.dataset.characterId);
      }
      if (editingCharacterId === button.dataset.characterId) resetCharacterForm();
      renderCharacters();
    });
  });

  document.querySelectorAll(".character-edit").forEach((button) => {
    button.addEventListener("click", () => beginCharacterEdit(button.dataset.characterId));
  });
  refreshMotion(characterGallery);
  window.SiteBook?.repaginate?.("characters");
}

function openCharacterDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open("echoes-character-archive", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("characters", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadCustomCharacters() {
  try {
    const db = await openCharacterDb();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("characters", "readonly");
      const request = transaction.objectStore("characters").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    const saved = localStorage.getItem("customCharacters");
    return saved ? JSON.parse(saved) : [];
  }
}

async function saveCustomCharacter(character) {
  try {
    const db = await openCharacterDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("characters", "readwrite");
      transaction.objectStore("characters").put(character);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    localStorage.setItem("customCharacters", JSON.stringify(customCharacters));
  }
}

async function deleteCustomCharacter(id) {
  try {
    const db = await openCharacterDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("characters", "readwrite");
      transaction.objectStore("characters").delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    localStorage.setItem("customCharacters", JSON.stringify(customCharacters.filter((character) => character.id !== id)));
  }
}

function resetCharacterForm() {
  editingCharacterId = "";
  pendingPortraitData = "";
  characterForm.reset();
  portraitPreview.removeAttribute("src");
  portraitPreview.classList.remove("visible");
  portraitUploadLabel.classList.remove("hidden");
  characterImageInput.required = true;
  characterForm.querySelector("h2").textContent = "添加人物";
  characterFormMode.textContent = "新增内容保存在当前浏览器本地。";
  characterSubmitButton.textContent = "添加到人物图鉴";
  characterCancelEdit.classList.remove("visible");
}

function beginCharacterEdit(id) {
  const character = mergedCharacters().find((item) => item.id === id);
  if (!character) return;

  editingCharacterId = id;
  pendingPortraitData = character.image || "";
  characterNameInput.value = character.name;
  characterIntroInput.value = character.intro;
  characterImageInput.required = false;

  if (character.image) {
    portraitPreview.src = character.image;
    portraitPreview.classList.add("visible");
    portraitUploadLabel.classList.add("hidden");
  }

  characterForm.querySelector("h2").textContent = "修改人物";
  characterFormMode.textContent = "正在修改人物卡；可重新选择图片，也可以保留原图。";
  characterSubmitButton.textContent = "保存修改";
  characterCancelEdit.classList.add("visible");
  characterFormStatus.textContent = "";
  characterForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyView(name, updateHash = true, animate = true) {
  if (name !== "reader") window.BookWorkbench?.stopEditor?.();
  const commitView = () => {
    currentView = name;
    views.forEach((view) => view.classList.toggle("active", view.dataset.viewName === name));
    navButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    document.body.classList.toggle("reading-mode", name === "reader" && document.getElementById("focusToggle").checked);
    mainNav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    window.scrollTo({ top: 0, behavior: "auto" });

    if (updateHash && name !== "reader") {
      history.pushState(null, "", `#${name}`);
    }
  };

  commitView();
  animateCurrentView();
}

function showView(name, updateHash = true, animate = true) {
  if (!views.some((view) => view.dataset.viewName === name)) return;
  if (window.SiteBook?.isReady?.()) {
    currentView = name;
    window.SiteBook.goToSection(name, { updateHash, animate });
    return;
  }
  applyView(name, updateHash, animate);
}

function selectReaderTocButton(button) {
  if (!currentBook || !button) return;
  window.BookWorkbench?.stopEditor?.();
  currentChapter = Number(button.dataset.chapter);
  currentHeadingId = button.dataset.headingId || "";
  expandedTocChapters.add(readerBookTocId());
  if (!currentHeadingId) expandedTocChapters.add(readerChapterTocId(currentChapter));
  if (currentHeadingId) expandReaderHeadingPath(currentBook.chapters[currentChapter], currentChapter, currentHeadingId);
  renderReader();
  history.replaceState(null, "", `#read/${currentBook.id}/${currentChapter}`);
  if (window.SiteBook?.isReady?.()) {
    window.SiteBook.openReader(currentBook.id, currentChapter, {
      updateHash: false,
      animate: false,
      headingId: currentHeadingId
    });
  } else if (currentHeadingId) {
    scrollReaderToHeading(currentHeadingId);
  } else {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
}

function renderReader() {
  if (!currentBook) return;
  const chapter = currentBook.chapters[currentChapter];
  const bookNumber = books.indexOf(currentBook) + 1;

  document.getElementById("readerCover").src = safeImageSource(currentBook.cover);
  document.getElementById("readerCover").alt = `${currentBook.title}封面`;
  document.getElementById("readerSideTitle").textContent = currentBook.title;
  document.getElementById("readerVolumeLabel").textContent = `VOLUME ${romanize(bookNumber)}`;
  document.getElementById("readerProgress").style.width = `${((currentChapter + 1) / currentBook.chapters.length) * 100}%`;
  document.getElementById("chapterKicker").textContent = isSyntheticChapter(chapter) ? `卷 ${romanize(bookNumber)}` : `卷 ${romanize(bookNumber)} · 第 ${currentChapter + 1} 章`;
  document.getElementById("chapterTitle").textContent = isSyntheticChapter(chapter) ? currentBook.title : chapter.title;
  document.getElementById("chapterSubtitle").textContent = isSyntheticChapter(chapter) ? "" : chapter.subtitle;
  const importNote = currentBook.importedFrom ? "" : `
    <aside class="import-note">
      <span>WORD CONTENT PLACEHOLDER</span>
      <p>此处已经为后续 Word 文档内容预留。替换 <code>books.js</code> 中本章的 paragraphs 即可自动更新正文。</p>
    </aside>
  `;
  document.getElementById("chapterBody").innerHTML = renderChapterBlocks(chapter, currentChapter) + importNote;
  applyReaderHeadingFolds();
  renderReaderToc();

  document.getElementById("prevChapter").disabled = currentChapter === 0;
  document.getElementById("nextChapter").disabled = currentChapter === currentBook.chapters.length - 1;
  refreshMotion(document.getElementById("readerView"));
  window.SiteBook?.repaginate?.("reader");
}

function refreshBooks() {
  renderBooks();
  if (currentBook) {
    const updatedBook = books.find((book) => book.id === currentBook.id);
    if (updatedBook) currentBook = updatedBook;
  }
  if (currentView === "reader" && currentBook) renderReader();
}

function openReader(book, chapterIndex = 0, updateHash = true, animate = true) {
  if (!book) return;
  window.BookWorkbench?.stopEditor?.();
  currentBook = book;
  currentChapter = Math.min(Math.max(chapterIndex, 0), book.chapters.length - 1);
  currentHeadingId = "";
  renderReader();
  currentView = "reader";
  if (window.SiteBook?.isReady?.()) {
    window.SiteBook.openReader(book.id, currentChapter, { updateHash, animate });
  } else {
    showView("reader", false, animate);
    if (updateHash) history.pushState(null, "", `#read/${book.id}/${currentChapter}`);
  }
}

function moveChapter(direction) {
  if (!currentBook) return;
  window.BookWorkbench?.stopEditor?.();
  const next = currentChapter + direction;
  if (next < 0 || next >= currentBook.chapters.length) return;
  currentChapter = next;
  currentHeadingId = "";
  renderReader();
  if (window.SiteBook?.isReady?.()) {
    window.SiteBook.openReader(currentBook.id, currentChapter, { updateHash: true, replaceHash: true, animate: true });
  } else {
    history.replaceState(null, "", `#read/${currentBook.id}/${currentChapter}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function loadHash(animate = true) {
  const hash = location.hash.replace(/^#/, "") || "home";
  if (hash.startsWith("read/")) {
    const [, id, chapter = "0"] = hash.split("/");
    openReader(books.find((book) => book.id === id), Number(chapter), false, animate);
    return;
  }
  const allowed = ["home", "letter", "map", "characters", "gallery", "archive", "settings"];
  showView(allowed.includes(hash) ? hash : "home", false, animate);
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

menuToggle.addEventListener("click", () => {
  const isOpen = mainNav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});

document.getElementById("readerBack").addEventListener("click", () => showView("archive"));
document.getElementById("prevChapter").addEventListener("click", () => moveChapter(-1));
document.getElementById("nextChapter").addEventListener("click", () => moveChapter(1));
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest(".book-reader-index-sheet .back-button")) {
    event.preventDefault();
    showView("archive");
    return;
  }
  const clonedReaderAction = event.target.closest(".book-reader-index-sheet .reader-actions button");
  if (clonedReaderAction) {
    event.preventDefault();
    if (clonedReaderAction.textContent.includes("上一章")) moveChapter(-1);
    if (clonedReaderAction.textContent.includes("下一章")) moveChapter(1);
    return;
  }
  const foldButton = event.target.closest(".chapter-fold-toggle");
  if (foldButton) {
    event.preventDefault();
    event.stopPropagation();
    toggleReaderHeadingFold(foldButton.dataset.headingId || foldButton.closest("[data-reader-heading-id]")?.dataset.readerHeadingId || "");
    return;
  }
  const tocFoldButton = event.target.closest(".toc-fold-toggle");
  if (tocFoldButton) {
    event.preventDefault();
    event.stopPropagation();
    toggleReaderTocFold(tocFoldButton);
    return;
  }
  const button = event.target.closest("#chapterList .toc-link[data-chapter], .book-reader-index-sheet .reader-sidebar nav .toc-link[data-chapter]");
  if (!button) return;
  event.preventDefault();
  selectReaderTocButton(button);
});

document.getElementById("prevMap").addEventListener("click", () => selectAtlasMap(currentMapIndex - 1));
document.getElementById("nextMap").addEventListener("click", () => selectAtlasMap(currentMapIndex + 1));
document.getElementById("openMapLightbox").addEventListener("click", () => {
  const map = atlasMaps[currentMapIndex];
  document.getElementById("lightboxMapImage").src = map.image;
  document.getElementById("lightboxMapImage").alt = `${map.title}地图大图`;
  document.getElementById("lightboxMapTitle").textContent = `${map.title} · ${map.english}`;
  openCinematicDialog(document.getElementById("mapLightbox"));
});
document.getElementById("closeMapLightbox").addEventListener("click", () => {
  closeCinematicDialog(document.getElementById("mapLightbox"));
});

document.querySelectorAll("#fontControls button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("#fontControls button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.documentElement.dataset.readerSize = button.dataset.size;
    localStorage.setItem("readerSize", button.dataset.size);
    window.SiteBook?.repaginate?.("reader-size");
  });
});

document.getElementById("ambientToggle").addEventListener("change", (event) => {
  document.body.classList.toggle("no-ambient", !event.target.checked);
  localStorage.setItem("ambient", event.target.checked ? "on" : "off");
});

pageSoundToggle?.addEventListener("change", (event) => {
  localStorage.setItem("pageSound", event.target.checked ? "on" : "off");
});

document.getElementById("focusToggle").addEventListener("change", (event) => {
  document.body.classList.toggle("reading-mode", event.target.checked && currentView === "reader");
  localStorage.setItem("focus", event.target.checked ? "on" : "off");
});

function selectedMusicTrack() {
  return musicTracks[musicTrackSelect.value] || musicTracks.siren;
}

function updateMusicStatus(message = "") {
  const track = selectedMusicTrack();
  musicStatus.textContent = message || `${track.title} · ${track.artist}`;
}

function resumeMusicAfterGesture() {
  musicResumePending = false;
  if (musicToggle.checked && backgroundMusic.paused) playMusic();
}

function queueMusicResume() {
  if (musicResumePending) return;
  musicResumePending = true;
  document.addEventListener("pointerdown", resumeMusicAfterGesture, { once: true });
}

function playMusic() {
  updateMusicStatus("正在播放…");
  backgroundMusic.play()
    .then(() => updateMusicStatus())
    .catch(() => {
      updateMusicStatus("点击页面任意位置即可继续播放。");
      queueMusicResume();
    });
}

function selectMusicTrack(trackId, shouldPlay = musicToggle.checked) {
  const validTrackId = musicTracks[trackId] ? trackId : "siren";
  const track = musicTracks[validTrackId];
  musicTrackSelect.value = validTrackId;
  backgroundMusic.src = track.source;
  backgroundMusic.load();
  localStorage.setItem("musicTrack", validTrackId);
  updateMusicStatus(shouldPlay ? "正在切换曲目…" : "");
  if (shouldPlay) playMusic();
}

musicToggle.addEventListener("change", (event) => {
  localStorage.setItem("music", event.target.checked ? "on" : "off");
  if (event.target.checked) {
    playMusic();
    return;
  }
  backgroundMusic.pause();
  updateMusicStatus();
});

musicTrackSelect.addEventListener("change", (event) => {
  selectMusicTrack(event.target.value);
});

backgroundMusic.addEventListener("error", () => {
  updateMusicStatus("音乐文件暂时无法播放。");
});

document.getElementById("developerToggle").addEventListener("change", (event) => {
  document.body.classList.toggle("developer-mode", event.target.checked);
  localStorage.setItem("developerMode", event.target.checked ? "on" : "off");
  if (!event.target.checked) resetCharacterForm();
  renderCharacters();
  window.GalleryWorkbench?.setDeveloperMode?.(event.target.checked);
  window.SiteBook?.repaginate?.("developer-mode");
});

characterSearch.addEventListener("input", renderCharacters);

characterImageInput.addEventListener("change", () => {
  const [file] = characterImageInput.files;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    pendingPortraitData = String(reader.result || "");
    portraitPreview.src = pendingPortraitData;
    portraitPreview.classList.add("visible");
    portraitUploadLabel.classList.add("hidden");
  };
  reader.readAsDataURL(file);
});

characterCancelEdit.addEventListener("click", () => {
  resetCharacterForm();
  characterFormStatus.textContent = "已取消编辑。";
});

exportCharactersButton.addEventListener("click", () => {
  const charactersToExport = mergedCharacters();
  if (!charactersToExport.length) {
    characterFormStatus.textContent = "当前浏览器里没有可导出的人物。";
    return;
  }

  const payload = {
    format: "echoes-character-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    characters: charactersToExport
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `echoes-characters-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  characterFormStatus.textContent = `已导出 ${charactersToExport.length} 个人物。`;
});

characterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingPortraitData) {
    characterFormStatus.textContent = "请先选择人物图片。";
    return;
  }

  const existingCharacter = customCharacters.find((character) => character.id === editingCharacterId);
  const character = {
    id: editingCharacterId || `custom-${Date.now()}`,
    name: characterNameInput.value.trim(),
    intro: characterIntroInput.value.trim(),
    image: pendingPortraitData,
    custom: true,
    override: true,
    createdAt: existingCharacter?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (editingCharacterId) {
    customCharacters = customCharacters.map((item) => item.id === editingCharacterId ? character : item);
  } else {
    customCharacters.push(character);
  }
  await saveCustomCharacter(character);
  renderCharacters();
  const statusMessage = editingCharacterId ? "人物卡已更新。" : "已添加到人物图鉴。";
  resetCharacterForm();
  characterFormStatus.textContent = statusMessage;
});

function restoreSettings() {
  const size = localStorage.getItem("readerSize") || "medium";
  document.documentElement.dataset.readerSize = size;
  document.querySelectorAll("#fontControls button").forEach((button) => {
    button.classList.toggle("active", button.dataset.size === size);
  });

  const ambientOn = localStorage.getItem("ambient") !== "off";
  document.getElementById("ambientToggle").checked = ambientOn;
  document.body.classList.toggle("no-ambient", !ambientOn);

  const focusOn = localStorage.getItem("focus") === "on";
  document.getElementById("focusToggle").checked = focusOn;

  const pageSoundOn = localStorage.getItem("pageSound") !== "off";
  if (pageSoundToggle) pageSoundToggle.checked = pageSoundOn;

  backgroundMusic.volume = 0.38;
  const musicOn = localStorage.getItem("music") !== "off";
  musicToggle.checked = musicOn;
  selectMusicTrack(localStorage.getItem("musicTrack") || "siren", musicOn);

  const developerOn = localStorage.getItem("developerMode") === "on";
  document.getElementById("developerToggle").checked = developerOn;
  document.body.classList.toggle("developer-mode", developerOn);
}

async function initializeCharacters() {
  renderCharacters();
  customCharacters = await loadCustomCharacters();
  renderCharacters();
}

let pendingHistoryRoute = 0;
function queueHistoryRoute() {
  window.clearTimeout(pendingHistoryRoute);
  pendingHistoryRoute = window.setTimeout(() => {
    pendingHistoryRoute = 0;
    loadHash();
  }, 0);
}

window.addEventListener("popstate", queueHistoryRoute);
window.addEventListener("hashchange", queueHistoryRoute);

initializeIntro();
restoreSettings();
initializeCinematicMotion();
renderBooks();
renderAtlas();
const characterInitialization = initializeCharacters();
loadHash(false);
window.EchoesReader = {
  getCurrentBook: () => currentBook,
  getCurrentChapter: () => currentBook?.chapters?.[currentChapter] || null,
  getCurrentChapterIndex: () => currentChapter,
  setCurrentView: (name) => { currentView = name; },
  refreshBooks,
  refreshCurrentChapter: renderReader,
  refreshChapterList: renderReader
};
window.BookWorkbench?.initialize?.(books);
Promise.resolve(characterInitialization).then(
  () => markIntroTaskReady("app"),
  () => markIntroTaskReady("app")
);
