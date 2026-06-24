(function () {
  "use strict";

  const categoryNames = {
    chronicle: "编年史",
    land: "土地",
    myth: "神话"
  };
  const categoryKeys = Object.keys(categoryNames);
  const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  const $ = (selector) => document.querySelector(selector);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const openDialog = (dialog) => window.EchoesMotion?.openDialog ? window.EchoesMotion.openDialog(dialog) : dialog.showModal();
  const closeDialog = (dialog) => window.EchoesMotion?.closeDialog ? window.EchoesMotion.closeDialog(dialog) : dialog.close();

  let projectGallery = clone(window.ARCHIVE_GALLERY || []);
  let draftGallery = clone(projectGallery);
  let currentCategory = "chronicle";
  let lightboxIndex = 0;
  let baseRevision = "";
  let serverConnected = false;
  let dirty = false;
  let draggedId = "";
  let touchDraggedId = "";
  let touchTargetId = "";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeImageSource(value) {
    const source = String(value || "");
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(source)) return source;
    if (/^(?:编年史|土地|神话)\/[^<>:"|?*\x00-\x1f]+$/u.test(source) && !source.includes("..")) return source;
    return "";
  }

  function developerMode() {
    return document.body.classList.contains("developer-mode");
  }

  function currentArtworks() {
    return draftGallery
      .filter((item) => item.category === currentCategory)
      .sort((a, b) => a.order - b.order);
  }

  function normalizeOrders(category) {
    draftGallery
      .filter((item) => item.category === category)
      .sort((a, b) => a.order - b.order)
      .forEach((item, index) => {
        item.order = index;
      });
  }

  function normalizedForComparison(items) {
    return clone(items).sort((a, b) => a.id.localeCompare(b.id));
  }

  function refreshDirtyState(message = "") {
    dirty = JSON.stringify(normalizedForComparison(draftGallery)) !== JSON.stringify(normalizedForComparison(projectGallery));
    $("#discardGalleryDraft").disabled = !dirty;
    $("#publishGalleryDraft").disabled = !dirty;
    if (message) $("#galleryDraftStatus").textContent = message;
  }

  function renderCounts() {
    $("#galleryCountChronicle").textContent = draftGallery.filter((item) => item.category === "chronicle").length;
    $("#galleryCountLand").textContent = draftGallery.filter((item) => item.category === "land").length;
    $("#galleryCountMyth").textContent = draftGallery.filter((item) => item.category === "myth").length;
  }

  function categoryOptions(selected) {
    return categoryKeys.map((category) =>
      `<option value="${category}"${category === selected ? " selected" : ""}>${categoryNames[category]}</option>`
    ).join("");
  }

  function renderGallery() {
    window.SiteBook?.prepareDynamicContent?.("gallery");
    const artworks = currentArtworks();
    renderCounts();
    $("#galleryEmpty").classList.toggle("visible", artworks.length === 0);
    $("#galleryGrid").innerHTML = artworks.map((item) => `
      <article class="gallery-card" data-gallery-id="${escapeHtml(item.id)}">
        <button class="gallery-artwork-button" data-gallery-open="${escapeHtml(item.id)}" type="button" aria-label="查看画作“${escapeHtml(item.name)}”">
          <span class="gallery-artwork-frame">
            <img src="${safeImageSource(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async">
          </span>
          <h2 class="gallery-card-title">${escapeHtml(item.name)}</h2>
        </button>
        <div class="gallery-card-management">
          <input class="gallery-name-input" data-gallery-name="${escapeHtml(item.id)}" value="${escapeHtml(item.name)}" maxlength="120" aria-label="画作名称">
          <select class="gallery-category-select" data-gallery-move="${escapeHtml(item.id)}" aria-label="移动画作分类">
            ${categoryOptions(item.category)}
          </select>
          <div class="gallery-card-controls">
            <button class="gallery-drag-handle" data-gallery-drag="${escapeHtml(item.id)}" type="button" draggable="true">拖动排序</button>
            <button class="gallery-delete" data-gallery-delete="${escapeHtml(item.id)}" type="button">删除</button>
          </div>
        </div>
      </article>
    `).join("");
    bindRenderedGallery();
    window.EchoesMotion?.refresh?.($("#galleryGrid"));
    window.SiteBook?.repaginate?.("gallery");
  }

  function findArtwork(id) {
    return draftGallery.find((item) => item.id === id);
  }

  function validateName(id, rawName) {
    const name = String(rawName || "").trim().replace(/\.(?:png|jpe?g|webp|gif)$/i, "");
    if (!name) throw new Error("画作名称不能为空。");
    if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) throw new Error("名称包含文件名不支持的字符，或以句点、空格结尾。");
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) throw new Error("该名称是系统保留文件名。");
    const item = findArtwork(id);
    const duplicate = draftGallery.some((other) =>
      other.id !== id &&
      other.category === item.category &&
      other.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (duplicate) throw new Error(`“${categoryNames[item.category]}”中已经存在同名画作。`);
    return name;
  }

  function updateArtworkName(input) {
    const item = findArtwork(input.dataset.galleryName);
    if (!item) return;
    try {
      item.name = validateName(item.id, input.value);
      input.value = item.name;
      input.dataset.validName = item.name;
      input.closest(".gallery-card").querySelector(".gallery-card-title").textContent = item.name;
      refreshDirtyState(`已修改画作名称；点击“保存到项目”后会同步重命名图片文件。`);
      window.SiteBook?.repaginate?.("gallery");
    } catch (error) {
      item.name = input.dataset.validName || item.name;
      input.value = item.name;
      input.closest(".gallery-card").querySelector(".gallery-card-title").textContent = item.name;
      refreshDirtyState(error.message);
      window.SiteBook?.repaginate?.("gallery");
    }
  }

  function moveArtwork(select) {
    const item = findArtwork(select.dataset.galleryMove);
    const targetCategory = select.value;
    if (!item || item.category === targetCategory || !categoryNames[targetCategory]) return;
    const duplicate = draftGallery.some((other) =>
      other.id !== item.id &&
      other.category === targetCategory &&
      other.name.toLocaleLowerCase() === item.name.toLocaleLowerCase()
    );
    if (duplicate) {
      select.value = item.category;
      $("#galleryDraftStatus").textContent = `“${categoryNames[targetCategory]}”中已经存在同名画作，无法移动。`;
      return;
    }
    const previousCategory = item.category;
    item.category = targetCategory;
    item.order = draftGallery.filter((other) => other.category === targetCategory && other.id !== item.id).length;
    normalizeOrders(previousCategory);
    normalizeOrders(targetCategory);
    refreshDirtyState(`已将“${item.name}”移至${categoryNames[targetCategory]}，保存前仍可放弃修改。`);
    renderGallery();
  }

  function deleteArtwork(id) {
    const item = findArtwork(id);
    if (!item || !window.confirm(`确定将画作“${item.name}”标记为删除吗？真正删除会在保存到项目后发生。`)) return;
    draftGallery = draftGallery.filter((other) => other.id !== id);
    normalizeOrders(item.category);
    refreshDirtyState(`已将“${item.name}”标记为删除。`);
    renderGallery();
  }

  function reorderArtwork(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const ordered = currentArtworks();
    const sourceIndex = ordered.findIndex((item) => item.id === sourceId);
    const targetIndex = ordered.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [source] = ordered.splice(sourceIndex, 1);
    ordered.splice(targetIndex, 0, source);
    ordered.forEach((item, index) => {
      item.order = index;
    });
    refreshDirtyState("已调整当前分类的画作顺序。");
    renderGallery();
  }

  function clearDragClasses() {
    document.querySelectorAll(".gallery-card.dragging, .gallery-card.touch-dragging, .gallery-card.drag-target").forEach((card) => {
      card.classList.remove("dragging", "touch-dragging", "drag-target");
    });
  }

  function bindDragAndDrop() {
    document.querySelectorAll(".gallery-drag-handle").forEach((handle) => {
      handle.addEventListener("dragstart", (event) => {
        draggedId = handle.dataset.galleryDrag;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedId);
        handle.closest(".gallery-card").classList.add("dragging");
      });
      handle.addEventListener("dragend", () => {
        draggedId = "";
        clearDragClasses();
      });
      handle.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") return;
        touchDraggedId = handle.dataset.galleryDrag;
        touchTargetId = "";
        handle.setPointerCapture(event.pointerId);
        handle.closest(".gallery-card").classList.add("touch-dragging");
      });
      handle.addEventListener("pointermove", (event) => {
        if (!touchDraggedId) return;
        event.preventDefault();
        const targetCard = document.elementFromPoint(event.clientX, event.clientY)?.closest(".gallery-card");
        document.querySelectorAll(".gallery-card.drag-target").forEach((card) => card.classList.remove("drag-target"));
        if (targetCard && targetCard.dataset.galleryId !== touchDraggedId) {
          touchTargetId = targetCard.dataset.galleryId;
          targetCard.classList.add("drag-target");
        }
      });
      handle.addEventListener("pointerup", () => {
        const source = touchDraggedId;
        const target = touchTargetId;
        touchDraggedId = "";
        touchTargetId = "";
        clearDragClasses();
        reorderArtwork(source, target);
      });
      handle.addEventListener("pointercancel", () => {
        touchDraggedId = "";
        touchTargetId = "";
        clearDragClasses();
      });
    });

    document.querySelectorAll(".gallery-card").forEach((card) => {
      card.addEventListener("dragover", (event) => {
        if (!draggedId || card.dataset.galleryId === draggedId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        document.querySelectorAll(".gallery-card.drag-target").forEach((item) => item.classList.remove("drag-target"));
        card.classList.add("drag-target");
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        const source = draggedId || event.dataTransfer.getData("text/plain");
        const target = card.dataset.galleryId;
        draggedId = "";
        clearDragClasses();
        reorderArtwork(source, target);
      });
    });
  }

  function bindRenderedGallery() {
    document.querySelectorAll("[data-gallery-open]").forEach((button) => {
      button.addEventListener("click", () => openLightbox(button.dataset.galleryOpen));
    });
    document.querySelectorAll("[data-gallery-name]").forEach((input) => {
      input.dataset.validName = input.value;
      input.addEventListener("input", () => {
        const item = findArtwork(input.dataset.galleryName);
        if (!item) return;
        item.name = input.value.trim().replace(/\.(?:png|jpe?g|webp|gif)$/i, "");
        input.closest(".gallery-card").querySelector(".gallery-card-title").textContent = item.name || "未命名画作";
        refreshDirtyState("画作名称草稿已修改；保存时会再次校验文件名。");
      });
      input.addEventListener("change", () => updateArtworkName(input));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    });
    document.querySelectorAll("[data-gallery-move]").forEach((select) => {
      select.addEventListener("change", () => moveArtwork(select));
    });
    document.querySelectorAll("[data-gallery-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteArtwork(button.dataset.galleryDelete));
    });
    if (developerMode()) bindDragAndDrop();
  }

  function renderLightbox() {
    const artworks = currentArtworks();
    if (!artworks.length) return;
    lightboxIndex = Math.min(Math.max(lightboxIndex, 0), artworks.length - 1);
    const item = artworks[lightboxIndex];
    $("#galleryLightboxImage").src = safeImageSource(item.image);
    $("#galleryLightboxImage").alt = item.name;
    $("#galleryLightboxTitle").textContent = item.name;
    $("#galleryLightboxCounter").textContent = `${String(lightboxIndex + 1).padStart(2, "0")} / ${String(artworks.length).padStart(2, "0")}`;
    $("#previousGalleryArtwork").disabled = lightboxIndex === 0;
    $("#nextGalleryArtwork").disabled = lightboxIndex === artworks.length - 1;
  }

  function openLightbox(id) {
    const artworks = currentArtworks();
    const index = artworks.findIndex((item) => item.id === id);
    if (index < 0) return;
    lightboxIndex = index;
    renderLightbox();
    openDialog($("#galleryLightbox"));
  }

  function moveLightbox(direction) {
    lightboxIndex += direction;
    renderLightbox();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("无法读取图片。"));
      reader.readAsDataURL(file);
    });
  }

  function uniqueName(category, value) {
    const base = String(value || "未命名画作").trim().replace(/\.(?:png|jpe?g|webp|gif)$/i, "") || "未命名画作";
    let candidate = base;
    let suffix = 2;
    const names = new Set(draftGallery.filter((item) => item.category === category).map((item) => item.name.toLocaleLowerCase()));
    while (names.has(candidate.toLocaleLowerCase())) candidate = `${base}-${suffix++}`;
    return candidate;
  }

  async function addUploads(files) {
    const category = $("#galleryUploadCategory").value;
    const validFiles = [...files].filter((file) => supportedTypes.has(file.type));
    if (!validFiles.length) {
      $("#galleryDraftStatus").textContent = "请选择 PNG、JPEG、WebP 或 GIF 图片。";
      return;
    }
    $("#galleryDraftStatus").textContent = `正在读取 ${validFiles.length} 张图片…`;
    for (const [index, file] of validFiles.entries()) {
      draftGallery.push({
        id: `gallery-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        category,
        name: uniqueName(category, file.name),
        image: await fileToDataUrl(file),
        order: draftGallery.filter((item) => item.category === category).length
      });
    }
    currentCategory = category;
    selectCategoryButton();
    refreshDirtyState(`已加入 ${validFiles.length} 张画作草稿；点击“保存到项目”后会写入${categoryNames[category]}文件夹。`);
    renderGallery();
  }

  function selectCategoryButton() {
    document.querySelectorAll("[data-gallery-category]").forEach((button) => {
      button.classList.toggle("active", button.dataset.galleryCategory === currentCategory);
    });
    $("#galleryUploadCategory").value = currentCategory;
  }

  async function refreshServerStatus() {
    try {
      const response = await fetch("/api/gallery/status", { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const payload = await response.json();
      baseRevision = payload.revision;
      if (!dirty && Array.isArray(payload.gallery)) {
        projectGallery = clone(payload.gallery);
        draftGallery = clone(payload.gallery);
        window.ARCHIVE_GALLERY = clone(payload.gallery);
        renderGallery();
      }
      serverConnected = true;
      $("#galleryConnectionStatus").textContent = "已连接本地发布服务，可以安全写入项目。";
      $("#galleryConnectionStatus").dataset.connected = "true";
    } catch {
      serverConnected = false;
      $("#galleryConnectionStatus").textContent = "当前为只读打开方式。请使用“启动档案馆.cmd”后再保存到项目。";
      $("#galleryConnectionStatus").dataset.connected = "false";
    }
    refreshDirtyState();
  }

  function summaryText(summary) {
    return `上传 ${summary.uploaded} 张，改名 ${summary.renamed} 张，移动 ${summary.moved} 张，删除 ${summary.deleted} 张，调整顺序 ${summary.reordered} 张`;
  }

  async function publishDraft() {
    if (!dirty) return;
    if (!serverConnected) {
      $("#galleryDraftStatus").textContent = "尚未连接保存服务。请双击项目中的“启动档案馆.cmd”，然后点击“重新检测连接”。";
      await refreshServerStatus();
      if (!serverConnected) return;
    }
    $("#publishGalleryDraft").disabled = true;
    $("#galleryDraftStatus").textContent = "正在校验并安全写入项目…";
    try {
      const response = await fetch("/api/gallery/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision, gallery: draftGallery })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存失败。");
      baseRevision = payload.revision;
      projectGallery = clone(payload.gallery);
      draftGallery = clone(payload.gallery);
      window.ARCHIVE_GALLERY = clone(payload.gallery);
      dirty = false;
      renderGallery();
      refreshDirtyState(`已保存到项目：${summaryText(payload.summary)}。备份位于 ${payload.backup}。`);
    } catch (error) {
      $("#galleryDraftStatus").textContent = error.message || "保存失败，画廊草稿仍然保留。";
      refreshDirtyState();
    }
  }

  function discardDraft() {
    if (dirty && !window.confirm("确定放弃所有尚未保存的美术馆修改吗？")) return;
    draftGallery = clone(projectGallery);
    dirty = false;
    renderGallery();
    refreshDirtyState("已放弃尚未保存的美术馆修改。");
  }

  function setDeveloperMode() {
    renderGallery();
    refreshServerStatus();
  }

  function bindStaticEvents() {
    document.querySelectorAll("[data-gallery-category]").forEach((button) => {
      button.addEventListener("click", () => {
        currentCategory = button.dataset.galleryCategory;
        selectCategoryButton();
        renderGallery();
      });
    });
    $("#galleryUploadInput").addEventListener("change", async (event) => {
      await addUploads(event.target.files);
      event.target.value = "";
    });
    $("#refreshGalleryConnection").addEventListener("click", async () => {
      $("#galleryConnectionStatus").textContent = "正在重新检测本地发布服务…";
      await refreshServerStatus();
    });
    $("#discardGalleryDraft").addEventListener("click", discardDraft);
    $("#publishGalleryDraft").addEventListener("click", publishDraft);
    $("#closeGalleryLightbox").addEventListener("click", () => closeDialog($("#galleryLightbox")));
    $("#previousGalleryArtwork").addEventListener("click", () => moveLightbox(-1));
    $("#nextGalleryArtwork").addEventListener("click", () => moveLightbox(1));
    $("#galleryLightbox").addEventListener("click", (event) => {
      if (event.target === $("#galleryLightbox")) closeDialog($("#galleryLightbox"));
    });
    document.addEventListener("keydown", (event) => {
      if (!$("#galleryLightbox").open) return;
      if (event.key === "ArrowLeft") moveLightbox(-1);
      if (event.key === "ArrowRight") moveLightbox(1);
      if (event.key === "Escape") closeDialog($("#galleryLightbox"));
    });
    window.addEventListener("focus", () => refreshServerStatus());
  }

  bindStaticEvents();
  selectCategoryButton();
  renderGallery();
  refreshServerStatus();

  window.GalleryWorkbench = {
    setDeveloperMode,
    refresh: renderGallery,
    getDraft: () => clone(draftGallery)
  };
}());
