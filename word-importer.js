(function () {
  "use strict";

  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  function children(node, name) {
    return [...(node?.childNodes || [])].filter((child) => child.nodeType === 1 && (!name || child.localName === name));
  }

  function descendants(node, name) {
    return [...(node?.getElementsByTagNameNS?.(W, name) || [])];
  }

  function first(node, name) {
    return descendants(node, name)[0] || null;
  }

  function value(node, fallback = "") {
    return node?.getAttributeNS(W, "val") ?? node?.getAttribute("w:val") ?? node?.getAttribute("val") ?? fallback;
  }

  function parseXml(text) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("Word 文档中的 XML 无法解析。");
    return xml;
  }

  function normalizeStyleName(valueToNormalize) {
    return String(valueToNormalize || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  }

  function safeFontName(font) {
    return String(font || "").replace(/["';:(){}<>\\]/g, "").trim().slice(0, 120);
  }

  function styleValue(node, name) {
    const item = first(node, name);
    return item ? value(item, "1") !== "0" : undefined;
  }

  function mergeProps(parent, child) {
    return {
      ...parent,
      ...Object.fromEntries(Object.entries(child || {}).filter(([, item]) => item !== undefined && item !== ""))
    };
  }

  function parseRunProperties(rPr) {
    if (!rPr) return {};
    const fonts = first(rPr, "rFonts");
    const size = Number(value(first(rPr, "sz"), ""));
    return {
      bold: styleValue(rPr, "b"),
      italic: styleValue(rPr, "i"),
      underline: first(rPr, "u") ? value(first(rPr, "u"), "single") !== "none" : undefined,
      font: safeFontName(fonts ? (
        fonts.getAttributeNS(W, "eastAsia")
        || fonts.getAttributeNS(W, "ascii")
        || fonts.getAttribute("w:eastAsia")
        || fonts.getAttribute("w:ascii")
        || ""
      ) : ""),
      sizePt: Number.isFinite(size) && size > 0 ? size / 2 : undefined
    };
  }

  function parseParagraphProperties(pPr) {
    if (!pPr) return {};
    const outlineValue = value(first(pPr, "outlineLvl"), "");
    const outline = outlineValue === "" ? Number.NaN : Number(outlineValue);
    const styleId = value(first(pPr, "pStyle"));
    const alignment = value(first(pPr, "jc"));
    const numPr = first(pPr, "numPr");
    return {
      styleId,
      level: Number.isFinite(outline) ? outline + 1 : undefined,
      align: ["left", "center", "right", "both", "justify"].includes(alignment)
        ? (alignment === "both" ? "justify" : alignment)
        : undefined,
      numId: value(first(numPr, "numId")),
      listLevel: Number(value(first(numPr, "ilvl"), "0")) || 0,
      run: parseRunProperties(first(pPr, "rPr"))
    };
  }

  function parseStyles(xml) {
    const raw = new Map();
    descendants(xml, "style").forEach((style) => {
      const id = style.getAttributeNS(W, "styleId") || style.getAttribute("w:styleId") || "";
      if (!id) return;
      raw.set(id, {
        id,
        name: value(first(style, "name"), id),
        basedOn: value(first(style, "basedOn")),
        paragraph: parseParagraphProperties(first(style, "pPr")),
        run: parseRunProperties(first(style, "rPr"))
      });
    });

    const resolved = new Map();
    function resolve(id, seen = new Set()) {
      if (!id || !raw.has(id)) return { name: id || "", paragraph: {}, run: {} };
      if (resolved.has(id)) return resolved.get(id);
      if (seen.has(id)) return raw.get(id);
      seen.add(id);
      const item = raw.get(id);
      const parent = resolve(item.basedOn, seen);
      const result = {
        id,
        name: item.name || parent.name,
        paragraph: mergeProps(parent.paragraph, item.paragraph),
        run: mergeProps(parent.run, item.run)
      };
      resolved.set(id, result);
      return result;
    }

    raw.forEach((_, id) => resolve(id));
    return resolved;
  }

  function parseNumbering(xml) {
    const abstractFormats = new Map();
    descendants(xml, "abstractNum").forEach((abstract) => {
      const id = abstract.getAttributeNS(W, "abstractNumId") || abstract.getAttribute("w:abstractNumId") || "";
      const levels = new Map();
      children(abstract, "lvl").forEach((level) => {
        const index = Number(level.getAttributeNS(W, "ilvl") || level.getAttribute("w:ilvl") || 0);
        levels.set(index, value(first(level, "numFmt"), "bullet"));
      });
      abstractFormats.set(id, levels);
    });

    const formats = new Map();
    descendants(xml, "num").forEach((num) => {
      const id = num.getAttributeNS(W, "numId") || num.getAttribute("w:numId") || "";
      const abstractId = value(first(num, "abstractNumId"));
      formats.set(id, abstractFormats.get(abstractId) || new Map());
    });
    return formats;
  }

  function classifyStyle(style, paragraph) {
    const name = normalizeStyleName(style?.name || paragraph.styleId);
    const explicitLevel = paragraph.level ?? style?.paragraph?.level;
    let level = Number.isFinite(explicitLevel) ? explicitLevel : undefined;
    if (!level) {
      const match = name.match(/(?:heading|标题|標題)([1-6])/);
      if (match) level = Number(match[1]);
    }
    return {
      level,
      subtitle: /subtitle|副标题|副標題/.test(name),
      quote: /quote|quotation|引用/.test(name)
    };
  }

  function runText(run) {
    let text = "";
    [...run.childNodes].forEach((node) => {
      if (node.nodeType !== 1) return;
      if (node.localName === "t") text += node.textContent || "";
      if (node.localName === "tab") text += "\t";
      if (node.localName === "cr") text += "\n";
      if (node.localName === "br" && (node.getAttributeNS(W, "type") || node.getAttribute("w:type")) !== "page") text += "\n";
    });
    return text;
  }

  function hasAncestor(node, localName) {
    let current = node?.parentNode;
    while (current) {
      if (current.localName === localName) return true;
      current = current.parentNode;
    }
    return false;
  }

  function cleanRun(run) {
    const cleaned = { text: run.text };
    ["bold", "italic", "underline"].forEach((key) => {
      if (run[key]) cleaned[key] = true;
    });
    if (run.font) cleaned.font = run.font;
    if (run.sizeRatio && Math.abs(run.sizeRatio - 1) > 0.01) cleaned.sizeRatio = Number(run.sizeRatio.toFixed(3));
    return cleaned;
  }

  function parseParagraph(node, styles, numbering, baseSizePt) {
    const ownParagraph = parseParagraphProperties(first(node, "pPr"));
    const style = styles.get(ownParagraph.styleId) || { paragraph: {}, run: {}, name: ownParagraph.styleId };
    const paragraph = mergeProps(style.paragraph, ownParagraph);
    const classification = classifyStyle(style, paragraph);
    const defaultRun = mergeProps(style.run, paragraph.run);
    const runs = [];

    descendants(node, "r").forEach((runNode) => {
      if (hasAncestor(runNode, "del")) return;
      const text = runText(runNode);
      if (!text) return;
      const props = mergeProps(defaultRun, parseRunProperties(first(runNode, "rPr")));
      runs.push(cleanRun({
        text,
        ...props,
        sizeRatio: props.sizePt ? Math.min(1.6, Math.max(.8, props.sizePt / baseSizePt)) : 1
      }));
    });

    const text = runs.map((run) => run.text).join("");
    const format = numbering.get(paragraph.numId)?.get(paragraph.listLevel);
    return {
      text,
      runs,
      level: classification.level,
      subtitle: classification.subtitle,
      quote: classification.quote,
      align: paragraph.align,
      list: paragraph.numId ? { ordered: format !== "bullet", level: paragraph.listLevel } : null
    };
  }

  function detectBaseSize(documentXml, styles) {
    const sizes = [];
    descendants(documentXml, "p").forEach((paragraph) => {
      const styleId = value(first(first(paragraph, "pPr"), "pStyle"));
      const style = styles.get(styleId);
      const classification = classifyStyle(style, style?.paragraph || {});
      if (classification.level) return;
      descendants(paragraph, "sz").forEach((size) => {
        const amount = Number(value(size));
        if (Number.isFinite(amount) && amount >= 16 && amount <= 40) sizes.push(amount / 2);
      });
      if (style?.run?.sizePt) sizes.push(style.run.sizePt);
    });
    if (!sizes.length) return 11;
    const counts = new Map();
    sizes.forEach((size) => counts.set(size, (counts.get(size) || 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }

  function blockFromParagraph(paragraph) {
    const base = { runs: paragraph.runs };
    if (paragraph.align) base.align = paragraph.align;
    if (paragraph.level) return { type: "heading", level: paragraph.level, ...base };
    if (paragraph.quote) return { type: "quote", ...base };
    return { type: "paragraph", ...base };
  }

  function appendContent(chapter, paragraph) {
    if (!paragraph.text.trim()) return;
    if (paragraph.list) {
      const previous = chapter.blocks[chapter.blocks.length - 1];
      if (previous?.type === "list" && previous.ordered === paragraph.list.ordered) {
        previous.items.push({ runs: paragraph.runs, level: paragraph.list.level });
      } else {
        chapter.blocks.push({
          type: "list",
          ordered: paragraph.list.ordered,
          items: [{ runs: paragraph.runs, level: paragraph.list.level }]
        });
      }
      return;
    }
    chapter.blocks.push(blockFromParagraph(paragraph));
  }

  function buildVolumes(paragraphs, warnings) {
    const volumes = [];
    let volume = null;
    let chapter = null;

    paragraphs.forEach((paragraph) => {
      if (!paragraph.text.trim()) return;
      if (paragraph.level === 1) {
        volume = { title: paragraph.text.trim(), english: "", summary: "", tone: "", chapters: [] };
        volumes.push(volume);
        chapter = null;
        return;
      }
      if (!volume) {
        warnings.push(`已忽略卷标题之前的内容：“${paragraph.text.trim().slice(0, 28)}”`);
        return;
      }
      if (paragraph.level === 2) {
        chapter = { title: paragraph.text.trim(), subtitle: "", blocks: [] };
        volume.chapters.push(chapter);
        return;
      }
      if (paragraph.subtitle && !chapter && !volume.summary) {
        volume.summary = paragraph.text.trim();
        return;
      }
      if (!chapter) {
        chapter = { title: "未命名章节", subtitle: "", blocks: [] };
        volume.chapters.push(chapter);
      }
      if (paragraph.subtitle && !chapter.blocks.length && !chapter.subtitle) {
        chapter.subtitle = paragraph.text.trim();
        return;
      }
      appendContent(chapter, paragraph);
    });

    volumes.forEach((item) => {
      if (!item.chapters.length) item.chapters.push({ title: "未命名章节", subtitle: "", blocks: [] });
    });
    return volumes;
  }

  async function parseDocx(file) {
    if (!window.JSZip) throw new Error("本地 DOCX 解析器未加载。");
    if (!file?.name?.toLowerCase().endsWith(".docx")) throw new Error("第一版仅支持 .docx 文件。");

    const buffer = await file.arrayBuffer();
    const zip = await window.JSZip.loadAsync(buffer);
    const required = zip.file("word/document.xml");
    if (!required) throw new Error("这不是有效的 DOCX 文档。");

    const [documentText, stylesText, numberingText] = await Promise.all([
      required.async("text"),
      zip.file("word/styles.xml")?.async("text") || "",
      zip.file("word/numbering.xml")?.async("text") || ""
    ]);
    const documentXml = parseXml(documentText);
    const styles = stylesText ? parseStyles(parseXml(stylesText)) : new Map();
    const numbering = numberingText ? parseNumbering(parseXml(numberingText)) : new Map();
    const baseSizePt = detectBaseSize(documentXml, styles);
    const warnings = [];
    const paragraphs = descendants(documentXml, "body")
      .flatMap((body) => children(body))
      .filter((node) => {
        if (node.localName === "tbl") warnings.push("已忽略一个表格。");
        return node.localName === "p";
      })
      .map((paragraph) => parseParagraph(paragraph, styles, numbering, baseSizePt));

    const mediaCount = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name].dir).length;
    if (mediaCount) warnings.push(`已忽略 ${mediaCount} 张正文图片。`);
    if (descendants(documentXml, "footnoteReference").length) warnings.push("已忽略脚注引用。");
    if (zip.file("word/comments.xml")) warnings.push("已忽略 Word 批注。");
    if (Object.keys(zip.files).some((name) => /^word\/header\d*\.xml$/i.test(name))) warnings.push("已忽略页眉。");
    if (Object.keys(zip.files).some((name) => /^word\/footer\d*\.xml$/i.test(name))) warnings.push("已忽略页脚。");
    if (descendants(documentXml, "br").some((node) => (node.getAttributeNS(W, "type") || node.getAttribute("w:type")) === "page")) warnings.push("已忽略分页符。");

    return {
      filename: file.name,
      importedAt: new Date().toISOString(),
      baseSizePt,
      volumes: buildVolumes(paragraphs, warnings),
      warnings,
      sourceBase64: await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      })
    };
  }

  window.WordBookImporter = { parseDocx };
})();
