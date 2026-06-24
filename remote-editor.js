(() => {
  "use strict";

  const state = {
    books: [],
    revision: "",
    selectedBook: 0,
    selectedChapter: 0,
    dirty: false,
    saving: false,
    savedRange: null
  };

  const $ = (selector) => document.querySelector(selector);
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeColor(value) {
    const color = String(value || "").trim();
    return /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(color) ? color : "";
  }

  function safeLink(value) {
    const link = String(value || "").trim();
    return /^(?:https?:\/\/|mailto:|#)/i.test(link) ? link : "";
  }

  function safeImage(value) {
    const source = String(value || "");
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(source)) return source;
    if (/^(?:assets\/|\.\/assets\/)[A-Za-z0-9_./ -]+$/.test(source) && !source.includes("..")) return source;
    return "";
  }

  function setStatus(message, kind = "") {
    const status = $("#status");
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function setDirty(dirty = true) {
    state.dirty = dirty;
    $("#dirtyMark").textContent = dirty ? "有尚未远程保存的修改" : "";
    $("#saveButton").disabled = !dirty || state.saving;
  }

  function editorToken() {
    return $("#tokenInput").value.trim();
  }

  function requestHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (editorToken()) headers["X-Echoes-Editor-Token"] = editorToken();
    return headers;
  }

  function loadToken() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = hash.get("token") || sessionStorage.getItem("echoes-editor-token") || "";
    $("#tokenInput").value = token;
    if (token) sessionStorage.setItem("echoes-editor-token", token);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  function currentBook() {
    return state.books[state.selectedBook];
  }

  function currentChapter() {
    return currentBook()?.chapters?.[state.selectedChapter];
  }

  function runStyle(run) {
    const styles = [];
    const font = String(run.font || "").replace(/["';:(){}<>\\]/g, "").trim().slice(0, 120);
    if (font) styles.push(`font-family:${font}`);
    if (run.sizeRatio) styles.push(`font-size:${Math.min(6, Math.max(.5, Number(run.sizeRatio) || 1))}em`);
    const color = safeColor(run.color);
    const background = safeColor(run.background);
    if (color) styles.push(`color:${color}`);
    if (background) styles.push(`background-color:${background}`);
    return styles.join(";");
  }

  function renderRuns(runs, fallback = "") {
    const items = Array.isArray(runs) && runs.length ? runs : [{ text: fallback }];
    return items.map((run) => {
      let text = escapeHtml(run.text || "").replace(/\n/g, "<br>");
      if (run.strike) text = `<s>${text}</s>`;
      if (run.underline) text = `<u>${text}</u>`;
      if (run.italic) text = `<em>${text}</em>`;
      if (run.bold) text = `<strong>${text}</strong>`;
      if (run.superscript) text = `<sup>${text}</sup>`;
      if (run.subscript) text = `<sub>${text}</sub>`;
      const style = runStyle(run);
      if (style) text = `<span style="${escapeHtml(style)}">${text}</span>`;
      const link = safeLink(run.link);
      return link ? `<a href="${escapeHtml(link)}">${text}</a>` : text;
    }).join("");
  }

  function blockStyle(block) {
    const styles = [];
    if (["left", "center", "right", "justify"].includes(block.align)) styles.push(`text-align:${block.align}`);
    if (Number(block.indent) > 0) styles.push(`margin-left:${Math.min(8, Number(block.indent)) * 2}em`);
    return styles.length ? ` style="${styles.join(";")}"` : "";
  }

  function chapterToHtml(chapter) {
    const blocks = chapter.blocks || (chapter.paragraphs || []).map((text) => ({ type: "paragraph", runs: [{ text }] }));
    return blocks.map((block) => {
      const style = blockStyle(block);
      if (block.type === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag}${style}>${(block.items || []).map((item) => `<li>${renderRuns(item.runs, item.text)}</li>`).join("")}</${tag}>`;
      }
      if (block.type === "heading") {
        const level = Math.min(4, Math.max(2, Number(block.level) || 3));
        return `<h${level}${style}>${renderRuns(block.runs, block.text)}</h${level}>`;
      }
      if (block.type === "quote") return `<blockquote${style}>${renderRuns(block.runs, block.text)}</blockquote>`;
      if (block.type === "image") {
        const width = Math.min(100, Math.max(15, Number(block.width) || 80));
        const align = ["left", "right", "center"].includes(block.align) ? block.align : "center";
        return `<figure data-image-block="true" data-align="${align}" style="width:${width}%;text-align:${align}">
          <img src="${safeImage(block.src)}" alt="${escapeHtml(block.alt || "")}">
          <figcaption>${escapeHtml(block.caption || "")}</figcaption>
        </figure>`;
      }
      if (block.type === "divider") return "<hr>";
      if (block.type === "table") {
        return `<table data-table-block="true"><tbody>${(block.rows || []).map((row, rowIndex) =>
          `<tr>${(row || []).map((cell) => {
            const tag = block.header && rowIndex === 0 ? "th" : "td";
            return `<${tag}>${renderRuns(cell.runs, cell.text) || "<br>"}</${tag}>`;
          }).join("")}</tr>`
        ).join("")}</tbody></table>`;
      }
      return `<p${style}>${renderRuns(block.runs, block.text)}${renderRuns(block.runs, block.text) ? "" : "<br>"}</p>`;
    }).join("");
  }

  function normalizeColor(value) {
    if (!value || value === "rgba(0, 0, 0, 0)" || value === "transparent") return "";
    return safeColor(value);
  }

  function runProperties(element, inherited) {
    const next = { ...inherited };
    const tag = element.tagName;
    if (["B", "STRONG"].includes(tag)) next.bold = true;
    if (["I", "EM"].includes(tag)) next.italic = true;
    if (tag === "U") next.underline = true;
    if (["S", "STRIKE", "DEL"].includes(tag)) next.strike = true;
    if (tag === "SUP") next.superscript = true;
    if (tag === "SUB") next.subscript = true;
    if (tag === "A" && safeLink(element.getAttribute("href"))) next.link = safeLink(element.getAttribute("href"));
    if (tag === "FONT") {
      if (element.getAttribute("face")) next.font = element.getAttribute("face").slice(0, 120);
      if (safeColor(element.getAttribute("color"))) next.color = safeColor(element.getAttribute("color"));
    }

    const style = element.style;
    if (style.fontWeight === "bold" || Number(style.fontWeight) >= 600) next.bold = true;
    if (style.fontStyle === "italic") next.italic = true;
    if (style.textDecorationLine.includes("underline")) next.underline = true;
    if (style.textDecorationLine.includes("line-through")) next.strike = true;
    if (style.fontFamily) next.font = style.fontFamily.replace(/["']/g, "").split(",")[0].trim().slice(0, 120);
    if (style.fontSize) {
      const size = parseFloat(style.fontSize);
      if (Number.isFinite(size)) next.sizeRatio = style.fontSize.endsWith("em") ? size : Math.min(6, Math.max(.5, size / 16));
    }
    const color = normalizeColor(style.color);
    const background = normalizeColor(style.backgroundColor);
    if (color) next.color = color;
    if (background) next.background = background;
    return next;
  }

  function sameRunStyle(left, right) {
    const a = { ...left };
    const b = { ...right };
    delete a.text;
    delete b.text;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function mergeRuns(runs) {
    const merged = [];
    runs.forEach((run) => {
      if (!run.text) return;
      const previous = merged[merged.length - 1];
      if (previous && sameRunStyle(previous, run)) previous.text += run.text;
      else merged.push(run);
    });
    return merged;
  }

  function extractRuns(node, inherited = {}) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ? [{ text: node.nodeValue, ...inherited }] : [];
    if (node.nodeType !== Node.ELEMENT_NODE || ["SCRIPT", "STYLE", "IMG", "FIGURE"].includes(node.tagName)) return [];
    if (node.tagName === "BR") return [{ text: "\n", ...inherited }];
    const next = runProperties(node, inherited);
    return mergeRuns([...node.childNodes].flatMap((child) => extractRuns(child, next)));
  }

  function elementAlignment(element) {
    const align = element.style.textAlign || element.getAttribute("align") || "";
    return ["left", "center", "right", "justify"].includes(align) ? align : undefined;
  }

  function elementIndent(element) {
    const amount = parseFloat(element.style.marginLeft || "0");
    return Number.isFinite(amount) && amount > 0 ? Math.min(8, Math.max(1, Math.round(amount / 32))) : undefined;
  }

  function serializeDocument() {
    const blocks = [];
    [...$("#chapterBody").children].forEach((element) => {
      if (element.tagName === "FIGURE" || element.dataset.imageBlock) {
        const image = element.querySelector("img");
        if (!image || !safeImage(image.getAttribute("src"))) return;
        blocks.push({
          type: "image",
          src: safeImage(image.getAttribute("src")),
          alt: image.getAttribute("alt") || "",
          caption: element.querySelector("figcaption")?.textContent?.trim() || "",
          align: element.dataset.align || elementAlignment(element) || "center",
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
          [...row.children].filter((cell) => ["TH", "TD"].includes(cell.tagName)).map((cell) => ({ runs: extractRuns(cell) }))
        ).filter((row) => row.length);
        if (rows.length) blocks.push({ type: "table", header: Boolean(element.querySelector("th")), rows });
        return;
      }
      if (["UL", "OL"].includes(element.tagName)) {
        const block = {
          type: "list",
          ordered: element.tagName === "OL",
          items: [...element.children].filter((child) => child.tagName === "LI").map((item) => ({ runs: extractRuns(item) }))
        };
        const align = elementAlignment(element);
        const indent = elementIndent(element);
        if (align) block.align = align;
        if (indent) block.indent = indent;
        if (block.items.some((item) => item.runs.some((run) => run.text.trim()))) blocks.push(block);
        return;
      }

      const type = /^H[1-6]$/.test(element.tagName) ? "heading" : element.tagName === "BLOCKQUOTE" ? "quote" : "paragraph";
      const block = { type, runs: extractRuns(element) };
      if (type === "heading") block.level = Number(element.tagName.slice(1));
      const align = elementAlignment(element);
      const indent = elementIndent(element);
      if (align) block.align = align;
      if (indent) block.indent = indent;
      if (block.runs.some((run) => run.text.trim())) blocks.push(block);
    });
    return blocks;
  }

  function syncCurrentChapter() {
    const chapter = currentChapter();
    if (!chapter || $("#editorForm").hidden) return;
    chapter.blocks = serializeDocument();
    delete chapter.paragraphs;
  }

  function renderBooks() {
    const query = $("#bookSearch").value.trim().toLowerCase();
    $("#bookList").innerHTML = state.books.map((book, index) => {
      const haystack = `${book.title} ${book.english}`.toLowerCase();
      if (query && !haystack.includes(query)) return "";
      return `
        <button class="nav-button ${index === state.selectedBook ? "active" : ""}" type="button" data-book="${index}">
          <b>${String(index + 1).padStart(2, "0")}</b>
          <span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.english)}</small></span>
        </button>`;
    }).join("");
  }

  function renderChapters() {
    const book = currentBook();
    $("#chapterList").innerHTML = (book?.chapters || []).map((chapter, index) => `
      <button class="nav-button ${index === state.selectedChapter ? "active" : ""}" type="button" data-chapter="${index}">
        <b>${String(index + 1).padStart(2, "0")}</b>
        <span><strong>${escapeHtml(chapter.title)}</strong><small>${escapeHtml(chapter.subtitle || "无副标题")}</small></span>
      </button>
    `).join("");
  }

  function renderEditor() {
    const book = currentBook();
    const chapter = currentChapter();
    $("#emptyState").hidden = Boolean(book && chapter);
    $("#editorForm").hidden = !(book && chapter);
    if (!book || !chapter) return;
    $("#volumeNumber").textContent = `VOLUME ${String(state.selectedBook + 1).padStart(2, "0")} · CHAPTER ${String(state.selectedChapter + 1).padStart(2, "0")}`;
    $("#editorHeading").textContent = chapter.title;
    $("#bookTitle").value = book.title || "";
    $("#bookEnglish").value = book.english || "";
    $("#bookTone").value = book.tone || "";
    $("#bookSummary").value = book.summary || "";
    $("#chapterTitle").value = chapter.title || "";
    $("#chapterSubtitle").value = chapter.subtitle || "";
    $("#chapterBody").innerHTML = chapterToHtml(chapter) || "<p><br></p>";
    state.savedRange = null;
  }

  function render() {
    renderBooks();
    renderChapters();
    renderEditor();
  }

  function selectionInsideEditor() {
    const selection = getSelection();
    return selection?.rangeCount && $("#chapterBody").contains(selection.anchorNode);
  }

  function saveSelection() {
    if (selectionInsideEditor()) state.savedRange = getSelection().getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    const editor = $("#chapterBody");
    if (!state.savedRange || !state.savedRange.commonAncestorContainer?.isConnected || !editor.contains(state.savedRange.commonAncestorContainer)) {
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      state.savedRange = range;
    }
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(state.savedRange);
  }

  function afterFormat() {
    syncCurrentChapter();
    setDirty();
    saveSelection();
    $("#chapterBody").focus();
  }

  function runCommand(command, value = null) {
    restoreSelection();
    document.execCommand(command, false, value);
    afterFormat();
  }

  function applyFontSize(ratio) {
    restoreSelection();
    document.execCommand("fontSize", false, "7");
    $("#chapterBody").querySelectorAll('font[size="7"]').forEach((font) => {
      font.removeAttribute("size");
      font.style.fontSize = `${ratio}em`;
    });
    $("#chapterBody").querySelectorAll("*").forEach((element) => {
      if (element.style.fontSize === "xxx-large") element.style.fontSize = `${ratio}em`;
    });
    afterFormat();
  }

  function insertHtml(html) {
    restoreSelection();
    document.execCommand("insertHTML", false, html);
    afterFormat();
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function loadBooks({ force = false } = {}) {
    if (state.dirty && !force && !confirm("当前有尚未保存的修改，确定放弃并重新加载吗？")) return;
    setStatus("正在读取远程文字...");
    try {
      const response = await fetch("/api/books", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.books)) throw new Error(payload.error || "无法读取书籍数据");
      state.books = payload.books;
      state.revision = payload.revision;
      state.selectedBook = Math.min(state.selectedBook, state.books.length - 1);
      state.selectedChapter = Math.min(state.selectedChapter, Math.max(0, (currentBook()?.chapters?.length || 1) - 1));
      setDirty(false);
      render();
      setStatus("已连接。正文工具栏可直接使用，完成后点击“保存到远程”。", "success");
    } catch (error) {
      setStatus(error.message || "连接失败", "error");
    }
  }

  async function saveBooks() {
    if (!state.dirty || state.saving) return;
    syncCurrentChapter();
    state.saving = true;
    $("#saveButton").disabled = true;
    sessionStorage.setItem("echoes-editor-token", editorToken());
    setStatus("正在远程保存文字、格式和图片，并创建备份...");
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({ baseRevision: state.revision, books: state.books, sources: [] })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "远程保存失败");
      state.revision = payload.revision;
      if (Array.isArray(payload.books)) state.books = payload.books;
      setDirty(false);
      render();
      setStatus(`保存成功，备份已创建：${payload.backup}`, "success");
    } catch (error) {
      setStatus(error.message || "远程保存失败", "error");
    } finally {
      state.saving = false;
      $("#saveButton").disabled = !state.dirty;
    }
  }

  function bindToolbar() {
    $("#wordToolbar").addEventListener("mousedown", (event) => {
      if (event.target.closest("button")) event.preventDefault();
    });

    $("#wordToolbar").addEventListener("click", (event) => {
      const commandButton = event.target.closest("button[data-command]");
      if (commandButton) runCommand(commandButton.dataset.command, commandButton.dataset.value || null);
    });

    $("#blockFormat").addEventListener("change", (event) => runCommand("formatBlock", event.target.value));
    $("#fontName").addEventListener("change", (event) => {
      let font = event.target.value;
      if (font === "__custom__") font = String(prompt("输入电脑上已安装的字体名称：", "") || "").replace(/["';:(){}<>\\]/g, "").trim().slice(0, 120);
      if (font) runCommand("fontName", font);
    });
    $("#fontSize").addEventListener("change", (event) => {
      let ratio = Number(event.target.value);
      if (event.target.value === "__custom__") {
        const points = Number(prompt("输入字号（8-72 磅）：", "12"));
        ratio = Number.isFinite(points) ? Math.min(6, Math.max(.5, points / 12)) : 0;
      }
      if (ratio) applyFontSize(ratio);
    });
    $("#textColor").addEventListener("input", (event) => runCommand("foreColor", event.target.value));
    $("#highlightColor").addEventListener("input", (event) => runCommand("hiliteColor", event.target.value));

    $("#linkButton").addEventListener("click", () => {
      const link = prompt("输入链接地址（https://、http://、mailto: 或 # 开头）：", "https://");
      if (safeLink(link)) runCommand("createLink", link);
      else if (link) alert("链接地址格式不正确。");
    });

    $("#imageButton").addEventListener("click", () => $("#imageInput").click());
    $("#imageInput").addEventListener("change", async (event) => {
      const [file] = event.target.files;
      event.target.value = "";
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) {
        alert("单张图片不能超过 15MB。");
        return;
      }
      const source = await readDataUrl(file);
      insertHtml(`<figure data-image-block="true" data-align="center" style="width:80%;text-align:center"><img src="${source}" alt="${escapeHtml(file.name)}"><figcaption>点击此处填写图片说明</figcaption></figure><p><br></p>`);
    });

    $("#dividerButton").addEventListener("click", () => insertHtml("<hr><p><br></p>"));
    $("#tableButton").addEventListener("click", () => {
      const rowInput = prompt("表格行数（1-12）：", "3");
      if (rowInput === null) return;
      const rows = Math.min(12, Math.max(1, Number(rowInput) || 1));
      const columnInput = prompt("表格列数（1-8）：", "3");
      if (columnInput === null) return;
      const columns = Math.min(8, Math.max(1, Number(columnInput) || 1));
      const body = Array.from({ length: rows }, (_, rowIndex) =>
        `<tr>${Array.from({ length: columns }, (_, columnIndex) => {
          const tag = rowIndex === 0 ? "th" : "td";
          return `<${tag}>${rowIndex === 0 ? `标题 ${columnIndex + 1}` : "<br>"}</${tag}>`;
        }).join("")}</tr>`
      ).join("");
      insertHtml(`<table data-table-block="true"><tbody>${body}</tbody></table><p><br></p>`);
    });
  }

  function bindEvents() {
    $("#bookList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-book]");
      if (!button) return;
      syncCurrentChapter();
      state.selectedBook = Number(button.dataset.book);
      state.selectedChapter = 0;
      render();
      document.body.dataset.mobilePanel = "chapters";
    });

    $("#chapterList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-chapter]");
      if (!button) return;
      syncCurrentChapter();
      state.selectedChapter = Number(button.dataset.chapter);
      render();
      document.body.dataset.mobilePanel = "editor";
    });

    $("#bookSearch").addEventListener("input", renderBooks);

    document.querySelectorAll("[data-book-field]").forEach((input) => {
      input.addEventListener("input", () => {
        currentBook()[input.dataset.bookField] = input.value;
        setDirty();
        renderBooks();
      });
    });

    document.querySelectorAll("[data-chapter-field]").forEach((input) => {
      input.addEventListener("input", () => {
        currentChapter()[input.dataset.chapterField] = input.value;
        $("#editorHeading").textContent = currentChapter().title;
        setDirty();
        renderChapters();
      });
    });

    $("#chapterBody").addEventListener("input", () => {
      syncCurrentChapter();
      setDirty();
    });
    $("#chapterBody").addEventListener("keyup", saveSelection);
    $("#chapterBody").addEventListener("mouseup", saveSelection);
    document.addEventListener("selectionchange", saveSelection);

    $("#chapterBody").addEventListener("dblclick", (event) => {
      const figure = event.target.closest("figure[data-image-block]");
      if (!figure) return;
      const width = prompt("图片宽度百分比（15-100）：", parseFloat(figure.style.width) || 80);
      if (width !== null && Number.isFinite(Number(width))) figure.style.width = `${Math.min(100, Math.max(15, Number(width)))}%`;
      const align = prompt("图片对齐方式：left / center / right", figure.dataset.align || "center");
      if (["left", "center", "right"].includes(align)) {
        figure.dataset.align = align;
        figure.style.textAlign = align;
        figure.style.marginLeft = align === "right" ? "auto" : "0";
        figure.style.marginRight = align === "left" ? "auto" : "0";
        if (align === "center") figure.style.margin = "1.8em auto";
      }
      afterFormat();
    });

    $("#addChapterButton").addEventListener("click", () => {
      syncCurrentChapter();
      const book = currentBook();
      if (!book) return;
      book.chapters.push({ title: "新章节", subtitle: "", blocks: [{ type: "paragraph", runs: [{ text: "" }] }] });
      state.selectedChapter = book.chapters.length - 1;
      setDirty();
      render();
      document.body.dataset.mobilePanel = "editor";
    });

    $("#tokenInput").addEventListener("change", () => sessionStorage.setItem("echoes-editor-token", editorToken()));
    $("#connectButton").addEventListener("click", () => loadBooks());
    $("#reloadButton").addEventListener("click", () => loadBooks());
    $("#saveButton").addEventListener("click", saveBooks);

    document.querySelectorAll("[data-panel]").forEach((button) => {
      button.addEventListener("click", () => {
        document.body.dataset.mobilePanel = button.dataset.panel;
      });
    });

    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  document.execCommand("styleWithCSS", false, true);
  loadToken();
  bindToolbar();
  bindEvents();
  loadBooks({ force: true });
})();
