(function () {
  "use strict";

  const DB_NAME = "echoes-book-workbench";
  const STORE_NAME = "workspace";
  const STATE_KEY = "current";
  const AUTOSAVE_DELAY = 800;
  let books = [];
  let projectBooks = [];
  let state = { drafts: {}, sources: [], baseRevision: "", updatedAt: "" };
  let pendingImport = null;
  let editorOpen = false;
  let saveTimer = 0;
  let serverConnected = false;

  const $ = (selector) => document.querySelector(selector);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[《》〈〉\s.,，。:：·'"“”‘’_-]/g, "");
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function loadState() {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(STATE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      const saved = localStorage.getItem(DB_NAME);
      return saved ? JSON.parse(saved) : null;
    }
  }

  async function saveState() {
    state.updatedAt = new Date().toISOString();
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } catch {
      localStorage.setItem(DB_NAME, JSON.stringify(state));
    }
    renderDraftManager();
  }

  function mergeDraftsIntoBooks() {
    Object.entries(state.drafts || {}).forEach(([id, draft]) => {
      const index = books.findIndex((book) => book.id === id);
      if (index >= 0) books.splice(index, 1, clone(draft));
    });
  }

  async function refreshServerStatus() {
    const status = $("#publishConnectionStatus");
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const payload = await response.json();
      if (!state.baseRevision || !Object.keys(state.drafts || {}).length) {
        state.baseRevision = payload.revision;
        await saveState();
      }
      status.textContent = "已连接本地发布服务，可以写入项目。";
      status.dataset.connected = "true";
      serverConnected = true;
    } catch {
      status.textContent = "当前为只读打开方式。请使用“启动档案馆.cmd”后再保存到项目。";
      status.dataset.connected = "false";
      serverConnected = false;
    }
    updatePublishButton();
  }

  function updatePublishButton() {
    $("#publishBooksButton").disabled = !serverConnected || !Object.keys(state.drafts || {}).length;
  }

  function defaultMapping(volumes) {
    const used = new Set();
    return volumes.map((volume, index) => {
      const match = books.findIndex((book, bookIndex) => !used.has(bookIndex)
        && [book.title, book.english].some((title) => normalize(title) === normalize(volume.title)));
      const target = match >= 0 ? match : (index < books.length ? index : -1);
      if (target >= 0) used.add(target);
      return target;
    });
  }

  function bookOptions(selected) {
    return [
      `<option value="-1"${selected < 0 ? " selected" : ""}>不导入此卷</option>`,
      ...books.map((book, index) => `<option value="${index}"${selected === index ? " selected" : ""}>${String(index + 1).padStart(2, "0")} · ${escapeHtml(book.title)}</option>`)
    ].join("");
  }

  function renderImportPreview() {
    const host = $("#wordImportPreview");
    if (!pendingImport) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = `
      <div class="import-summary">
        <div><strong>${escapeHtml(pendingImport.filename)}</strong><span>识别到 ${pendingImport.volumes.length} 卷</span></div>
        ${pendingImport.warnings.length ? `<details><summary>${pendingImport.warnings.length} 条导入提示</summary><ul>${pendingImport.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : ""}
      </div>
      <div class="volume-mapping-list">
        ${pendingImport.volumes.map((volume, index) => {
          const target = pendingImport.mapping[index];
          const existing = target >= 0 ? books[target] : {};
          return `
            <section class="volume-mapping-card" data-import-index="${index}">
              <div class="mapping-heading">
                <div><small>WORD VOLUME ${index + 1}</small><strong>${escapeHtml(volume.title)}</strong></div>
                <label>导入到<select class="mapping-target">${bookOptions(target)}</select></label>
              </div>
              <div class="mapping-fields">
                <label>中文书名<input class="mapping-title" value="${escapeHtml(volume.title || existing.title || "")}"></label>
                <label>英文书名<input class="mapping-english" value="${escapeHtml(volume.english || existing.english || "")}"></label>
                <label>色调<input class="mapping-tone" value="${escapeHtml(volume.tone || existing.tone || "")}"></label>
                <label class="mapping-summary-field">简介<textarea class="mapping-summary">${escapeHtml(volume.summary || existing.summary || "")}</textarea></label>
                <label>书封<input class="mapping-cover" type="file" accept="image/*"><span>${escapeHtml(existing.cover || "沿用原书封")}</span></label>
              </div>
              <details><summary>${volume.chapters.length} 个章节</summary><ol>${volume.chapters.map((chapter) => `<li>${escapeHtml(chapter.title)}${chapter.subtitle ? `<small>${escapeHtml(chapter.subtitle)}</small>` : ""}</li>`).join("")}</ol></details>
            </section>`;
        }).join("")}
      </div>
      <div class="workbench-actions">
        <button id="applyWordImport" type="button">应用为本地草稿</button>
        <button id="cancelWordImport" type="button">取消导入</button>
      </div>`;

    host.querySelectorAll(".mapping-target").forEach((select) => {
      select.addEventListener("change", () => {
        pendingImport.mapping[Number(select.closest(".volume-mapping-card").dataset.importIndex)] = Number(select.value);
      });
    });
    host.querySelectorAll(".mapping-cover").forEach((input) => {
      input.addEventListener("change", async () => {
        const [file] = input.files;
        if (!file) return;
        const card = input.closest(".volume-mapping-card");
        pendingImport.volumes[Number(card.dataset.importIndex)].cover = await readDataUrl(file);
        input.nextElementSibling.textContent = file.name;
      });
    });
    $("#applyWordImport").addEventListener("click", applyPendingImport);
    $("#cancelWordImport").addEventListener("click", () => {
      pendingImport = null;
      renderImportPreview();
      setWorkbenchStatus("已取消本次导入。");
    });
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function applyPendingImport() {
    const usedTargets = new Set();
    for (const card of [...document.querySelectorAll(".volume-mapping-card")]) {
      const importIndex = Number(card.dataset.importIndex);
      const target = Number(card.querySelector(".mapping-target").value);
      if (target < 0) continue;
      if (usedTargets.has(target)) {
        setWorkbenchStatus("同一个目标卷不能被重复映射，请调整后再应用。", true);
        return;
      }
      usedTargets.add(target);
      const source = pendingImport.volumes[importIndex];
      const existing = books[target];
      const draft = {
        ...clone(existing),
        title: card.querySelector(".mapping-title").value.trim() || existing.title,
        english: card.querySelector(".mapping-english").value.trim(),
        tone: card.querySelector(".mapping-tone").value.trim(),
        summary: card.querySelector(".mapping-summary").value.trim(),
        cover: source.cover || existing.cover,
        chapters: clone(source.chapters),
        importedFrom: { filename: pendingImport.filename, importedAt: pendingImport.importedAt }
      };
      books.splice(target, 1, draft);
      state.drafts[draft.id] = clone(draft);
    }
    if (!usedTargets.size) {
      setWorkbenchStatus("没有选择要导入的目标卷。", true);
      return;
    }
    state.sources.push({
      filename: pendingImport.filename,
      importedAt: pendingImport.importedAt,
      base64: pendingImport.sourceBase64
    });
    pendingImport = null;
    await saveState();
    renderImportPreview();
    refreshSite();
    setWorkbenchStatus(`已更新 ${usedTargets.size} 卷本地草稿。`);
  }

  function setWorkbenchStatus(message, error = false) {
    const status = $("#bookWorkbenchStatus");
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  function refreshSite() {
    window.EchoesReader?.refreshBooks?.();
    renderDraftManager();
  }

  function renderDraftManager() {
    const host = $("#bookDraftList");
    if (!host) return;
    host.innerHTML = books.map((book, index) => `
      <div class="draft-book-row">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <div><strong>${escapeHtml(book.title)}</strong><small>${state.drafts[book.id] ? "本地草稿 · 尚未发布" : "项目版本"}</small></div>
        <button type="button" data-restore-book="${escapeHtml(book.id)}" ${state.drafts[book.id] ? "" : "disabled"}>恢复项目版本</button>
      </div>
    `).join("");
    host.querySelectorAll("[data-restore-book]").forEach((button) => {
      button.addEventListener("click", () => restoreBook(button.dataset.restoreBook));
    });
    $("#draftCount").textContent = `${Object.keys(state.drafts).length} 卷未发布`;
    updatePublishButton();
  }

  async function restoreBook(id) {
    const projectBook = projectBooks.find((book) => book.id === id);
    const index = books.findIndex((book) => book.id === id);
    if (!projectBook || index < 0) return;
    books.splice(index, 1, clone(projectBook));
    delete state.drafts[id];
    await saveState();
    refreshSite();
    setWorkbenchStatus(`《${projectBook.title}》已恢复为项目版本。`);
  }

  function renderRuns(runs) {
    return (runs || []).map((run) => {
      const font = String(run.font || "").replace(/["';:(){}<>\\]/g, "").trim().slice(0, 120);
      const ratio = Number.isFinite(Number(run.sizeRatio)) ? Math.min(6, Math.max(.5, Number(run.sizeRatio))) : 1;
      const attrs = [
        font ? `data-font="${escapeHtml(font)}"` : "",
        run.sizeRatio ? `data-size-ratio="${ratio}"` : ""
      ].filter(Boolean).join(" ");
      const style = [
        font ? `font-family:${escapeHtml(font)}, "Noto Serif SC", serif` : "",
        run.sizeRatio ? `font-size:${Math.min(6, Math.max(.5, Number(run.sizeRatio) || 1))}em` : "",
        run.color ? `color:${escapeHtml(run.color)}` : "",
        run.background ? `background-color:${escapeHtml(run.background)}` : ""
      ].filter(Boolean).join(";");
      let text = escapeHtml(run.text).replace(/\n/g, "<br>");
      if (run.strike) text = `<s>${text}</s>`;
      if (run.underline) text = `<u>${text}</u>`;
      if (run.italic) text = `<em>${text}</em>`;
      if (run.bold) text = `<strong>${text}</strong>`;
      if (run.superscript) text = `<sup>${text}</sup>`;
      if (run.subscript) text = `<sub>${text}</sub>`;
      if (run.link) text = `<a href="${escapeHtml(run.link)}">${text}</a>`;
      return attrs || style ? `<span ${attrs} style="${style}">${text}</span>` : text;
    }).join("");
  }

  function editableBlocks(chapter) {
    const blocks = chapter.blocks || (chapter.paragraphs || []).map((text) => ({ type: "paragraph", runs: [{ text }] }));
    return blocks.map((block) => {
      if (block.type === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag}>${(block.items || []).map((item) => `<li>${renderRuns(item.runs)}</li>`).join("")}</${tag}>`;
      }
      if (block.type === "image") return `<figure data-image-block="true" data-align="${escapeHtml(block.align || "center")}" style="width:${Math.min(100, Math.max(15, Number(block.width) || 80))}%"><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || "")}"><figcaption>${escapeHtml(block.caption || "")}</figcaption></figure>`;
      if (block.type === "divider") return "<hr>";
      if (block.type === "table") return `<table data-table-block="true"><tbody>${(block.rows || []).map((row, rowIndex) => `<tr>${(row || []).map((cell) => {
        const tag = block.header && rowIndex === 0 ? "th" : "td";
        return `<${tag}>${renderRuns(cell.runs || [{ text: cell.text || "" }])}</${tag}>`;
      }).join("")}</tr>`).join("")}</tbody></table>`;
      const tag = block.type === "heading" ? `h${Math.min(6, Math.max(2, Number(block.level) || 3))}` : block.type === "quote" ? "blockquote" : "p";
      return `<${tag}>${renderRuns(block.runs || [{ text: block.text || "" }])}</${tag}>`;
    }).join("");
  }

  function startEditor() {
    const book = window.EchoesReader?.getCurrentBook?.();
    const chapter = window.EchoesReader?.getCurrentChapter?.();
    if (!book || !chapter) return;
    window.SiteBook?.setReaderEditing?.(true);
    editorOpen = true;
    document.body.classList.add("chapter-editing");
    $("#chapterEditorToolbar").hidden = false;
    $("#editChapterButton").textContent = "完成编辑";
    $("#chapterTitle").contentEditable = "true";
    $("#chapterSubtitle").contentEditable = "true";
    $("#chapterBody").contentEditable = "true";
    $("#chapterBody").innerHTML = editableBlocks(chapter);
    $("#chapterEditorStatus").textContent = "编辑内容会自动保存到浏览器本地。";
  }

  function stopEditor() {
    if (!editorOpen) return;
    saveCurrentChapterNow();
    editorOpen = false;
    document.body.classList.remove("chapter-editing");
    $("#chapterEditorToolbar").hidden = true;
    $("#editChapterButton").textContent = "编辑本章";
    ["#chapterTitle", "#chapterSubtitle", "#chapterBody"].forEach((selector) => {
      $(selector).contentEditable = "false";
    });
    window.EchoesReader?.refreshCurrentChapter?.();
    window.SiteBook?.setReaderEditing?.(false);
  }

  function textRuns(node, inherited = {}) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ? [{ text: node.nodeValue, ...inherited }] : [];
    if (node.nodeType !== Node.ELEMENT_NODE || ["SCRIPT", "STYLE"].includes(node.tagName)) return [];
    const next = { ...inherited };
    if (["STRONG", "B"].includes(node.tagName)) next.bold = true;
    if (["EM", "I"].includes(node.tagName)) next.italic = true;
    if (node.tagName === "U") next.underline = true;
    if (["S", "STRIKE", "DEL"].includes(node.tagName)) next.strike = true;
    if (node.tagName === "SUP") next.superscript = true;
    if (node.tagName === "SUB") next.subscript = true;
    if (node.tagName === "A" && /^(?:https?:\/\/|mailto:|#)/i.test(node.getAttribute("href") || "")) next.link = node.getAttribute("href");
    if (node.dataset?.font) next.font = node.dataset.font;
    if (node.dataset?.sizeRatio) next.sizeRatio = Math.min(6, Math.max(.5, Number(node.dataset.sizeRatio)));
    if (node.style?.color) next.color = node.style.color;
    if (node.style?.backgroundColor) next.background = node.style.backgroundColor;
    if (node.tagName === "BR") return [{ text: "\n", ...next }];
    return [...node.childNodes].flatMap((child) => textRuns(child, next));
  }

  function serializeEditor() {
    const blocks = [];
    [...$("#chapterBody").children].forEach((element) => {
      if (element.tagName === "FIGURE" || element.dataset.imageBlock) {
        const image = element.querySelector("img");
        if (image) blocks.push({
          type: "image",
          src: image.getAttribute("src") || "",
          alt: image.getAttribute("alt") || "",
          caption: element.querySelector("figcaption")?.textContent?.trim() || "",
          align: element.dataset.align || "center",
          width: Math.min(100, Math.max(15, parseFloat(element.style.width) || 80))
        });
        return;
      }
      if (element.tagName === "HR") {
        blocks.push({ type: "divider" });
        return;
      }
      if (element.tagName === "TABLE" || element.dataset.tableBlock) {
        const rows = [...element.querySelectorAll("tr")].map((row) =>
          [...row.children].filter((cell) => ["TH", "TD"].includes(cell.tagName)).map((cell) => ({ runs: textRuns(cell) }))
        ).filter((row) => row.length);
        if (rows.length) blocks.push({ type: "table", header: Boolean(element.querySelector("th")), rows });
        return;
      }
      if (["UL", "OL"].includes(element.tagName)) {
        blocks.push({
          type: "list",
          ordered: element.tagName === "OL",
          items: [...element.children].filter((child) => child.tagName === "LI").map((item) => ({ runs: textRuns(item) }))
        });
        return;
      }
      const type = ["H1", "H2", "H3", "H4", "H5", "H6"].includes(element.tagName) ? "heading"
        : element.tagName === "BLOCKQUOTE" ? "quote" : "paragraph";
      const block = { type, runs: textRuns(element) };
      if (type === "heading") block.level = Number(element.tagName.slice(1));
      const alignment = element.style.textAlign;
      if (["left", "center", "right", "justify"].includes(alignment)) block.align = alignment;
      blocks.push(block);
    });
    return blocks.filter((block) => ["image", "divider", "table"].includes(block.type) || (block.type === "list"
      ? block.items.some((item) => item.runs.some((run) => run.text.trim()))
      : block.runs.some((run) => run.text.trim())));
  }

  function scheduleChapterSave() {
    clearTimeout(saveTimer);
    $("#chapterEditorStatus").textContent = "正在编辑…";
    saveTimer = setTimeout(saveCurrentChapterNow, AUTOSAVE_DELAY);
  }

  async function saveCurrentChapterNow() {
    clearTimeout(saveTimer);
    if (!editorOpen) return;
    const book = window.EchoesReader?.getCurrentBook?.();
    const chapter = window.EchoesReader?.getCurrentChapter?.();
    if (!book || !chapter) return;
    chapter.title = $("#chapterTitle").textContent.trim() || "未命名章节";
    chapter.subtitle = $("#chapterSubtitle").textContent.trim();
    chapter.blocks = serializeEditor();
    delete chapter.paragraphs;
    book.importedFrom ||= { filename: "浏览器直接编辑", importedAt: new Date().toISOString() };
    state.drafts[book.id] = clone(book);
    await saveState();
    $("#chapterEditorStatus").textContent = `已自动保存 · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  async function publish() {
    if (!Object.keys(state.drafts).length) {
      setWorkbenchStatus("当前没有需要写入项目的本地草稿。");
      return;
    }
    const draftBooks = books.map((book) => clone(book));
    setWorkbenchStatus("正在安全写入项目…");
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: state.baseRevision, books: draftBooks, sources: state.sources })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "发布失败");
      state.drafts = {};
      state.sources = [];
      state.baseRevision = payload.revision;
      if (Array.isArray(payload.books)) books.splice(0, books.length, ...clone(payload.books));
      projectBooks = clone(books);
      await saveState();
      setWorkbenchStatus(`已写入项目，并创建备份 ${payload.backup}.`);
      refreshSite();
    } catch (error) {
      setWorkbenchStatus(error.message || "发布失败，本地草稿仍然保留。", true);
    }
  }

  function bindEvents() {
    $("#wordFileInput").addEventListener("change", async (event) => {
      const [file] = event.target.files;
      if (!file) return;
      setWorkbenchStatus("正在本地解析 Word 文档…");
      try {
        pendingImport = await window.WordBookImporter.parseDocx(file);
        pendingImport.mapping = defaultMapping(pendingImport.volumes);
        renderImportPreview();
        setWorkbenchStatus(`解析完成：识别到 ${pendingImport.volumes.length} 卷。请检查映射后应用。`);
      } catch (error) {
        pendingImport = null;
        renderImportPreview();
        setWorkbenchStatus(error.message || "无法解析该文档。", true);
      } finally {
        event.target.value = "";
      }
    });
    $("#publishBooksButton").addEventListener("click", publish);
    $("#editChapterButton").addEventListener("click", () => editorOpen ? stopEditor() : startEditor());
    $("#chapterEditorToolbar").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-command]");
      if (!button) return;
      document.execCommand(button.dataset.command, false, button.dataset.value || null);
      $("#chapterBody").focus();
      scheduleChapterSave();
    });
    ["#chapterTitle", "#chapterSubtitle", "#chapterBody"].forEach((selector) => {
      $(selector).addEventListener("input", scheduleChapterSave);
    });
    $("#chapterBody").addEventListener("paste", (event) => {
      event.preventDefault();
      document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    });
  }

  async function initialize(bookData) {
    books = bookData;
    projectBooks = clone(bookData);
    state = { ...state, ...(await loadState() || {}) };
    state.drafts ||= {};
    state.sources ||= [];
    mergeDraftsIntoBooks();
    bindEvents();
    renderDraftManager();
    refreshServerStatus();
    refreshSite();
  }

  window.BookWorkbench = {
    initialize,
    stopEditor,
    isEditing: () => editorOpen
  };
})();
