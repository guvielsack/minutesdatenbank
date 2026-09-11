const RICH_TEXT_COLORS = [
  { label: "Schwarz", value: "#111111" },
  { label: "Rot", value: "#b91c1c" },
  { label: "Orange", value: "#c2410c" },
  { label: "Grün", value: "#15803d" },
  { label: "Blau", value: "#1d4ed8" },
  { label: "Lila", value: "#7e22ce" },
];

const ALLOWED_RICH_COLORS = new Set(RICH_TEXT_COLORS.map((item) => item.value.toLowerCase()));

function escapeHtmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function looksLikeRichHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value ?? ""));
}

function normalizeColorValue(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text) && ALLOWED_RICH_COLORS.has(text)) return text;
  return null;
}

function sanitizeRichHtml(html) {
  if (html == null || html === "") return "";
  const source = String(html);
  if (!looksLikeRichHtml(source)) {
    return escapeHtmlText(source).replace(/\r\n|\r|\n/g, "<br>");
  }

  const template = document.createElement("template");
  template.innerHTML = source;
  const allowed = new Set(["B", "STRONG", "BR", "SPAN", "FONT", "DIV", "P"]);

  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        return;
      }

      const tag = child.tagName;
      if (!allowed.has(tag)) {
        const fragment = document.createDocumentFragment();
        while (child.firstChild) fragment.appendChild(child.firstChild);
        child.replaceWith(fragment);
        return;
      }

      if (tag === "SPAN" || tag === "FONT") {
        const color = normalizeColorValue(
          child.getAttribute("color") || child.style?.color || ""
        );
        [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
        if (color) {
          child.setAttribute("style", `color:${color}`);
        } else {
          const fragment = document.createDocumentFragment();
          while (child.firstChild) fragment.appendChild(child.firstChild);
          child.replaceWith(fragment);
          return;
        }
      } else if (tag === "B" || tag === "STRONG") {
        [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
      } else if (tag === "BR") {
        [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
      } else if (tag === "DIV" || tag === "P") {
        const br = document.createElement("br");
        child.replaceWith(...child.childNodes, br);
        return;
      }

      walk(child);
    });
  };

  walk(template.content);

  return template.innerHTML
    .replace(/(?:<br\s*\/?>\s*)+$/i, "")
    .trim();
}

function richTextDisplayHtml(value) {
  return sanitizeRichHtml(value) || "";
}

function richTextFormatter(cell) {
  const wrap = document.createElement("div");
  wrap.className = "cell-rich-text";
  wrap.innerHTML = richTextDisplayHtml(cell.getValue());
  return wrap;
}

function richTextEditor(cell, onRendered, success, cancel) {
  const wrap = document.createElement("div");
  wrap.className = "rich-text-editor";

  const toolbar = document.createElement("div");
  toolbar.className = "rich-text-toolbar";

  const boldBtn = document.createElement("button");
  boldBtn.type = "button";
  boldBtn.className = "rich-text-btn";
  boldBtn.title = "Fett";
  boldBtn.innerHTML = "<b>B</b>";

  const colorGroup = document.createElement("div");
  colorGroup.className = "rich-text-colors";
  RICH_TEXT_COLORS.forEach(({ label, value }) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "rich-text-color";
    swatch.title = label;
    swatch.style.background = value;
    swatch.dataset.color = value;
    colorGroup.appendChild(swatch);
  });

  const hint = document.createElement("span");
  hint.className = "rich-text-hint";
  hint.textContent = "Strg+Enter speichert";

  toolbar.appendChild(boldBtn);
  toolbar.appendChild(colorGroup);
  toolbar.appendChild(hint);

  const area = document.createElement("div");
  area.className = "rich-text-area";
  area.contentEditable = "true";
  area.spellcheck = true;
  // Vollständigen Zellwert laden (nicht den ggf. gekürzten Anzeige-HTML-Stand)
  const rawValue = cell.getValue();
  area.innerHTML = richTextDisplayHtml(rawValue ?? cell.getRow().getData().content);

  wrap.appendChild(toolbar);
  wrap.appendChild(area);

  let completed = false;
  const finish = (commit) => {
    if (completed) return;
    completed = true;
    if (commit) {
      success(sanitizeRichHtml(area.innerHTML));
    } else {
      cancel();
    }
  };

  const sizeToCell = () => {
    const cellEl = cell.getElement();
    if (!cellEl) return;
    const cellHeight = cellEl.offsetHeight || 0;
    const cellWidth = cellEl.clientWidth || 0;
    if (cellWidth > 0) {
      wrap.style.width = `${cellWidth}px`;
    }
    const toolbarHeight = toolbar.offsetHeight || 30;
    // Mindestens so hoch wie die Zelle, maximal ~80% Viewport – dann scrollen
    const target = Math.max(cellHeight - toolbarHeight - 10, 140);
    const capped = Math.min(target, Math.floor(window.innerHeight * 0.8));
    area.style.minHeight = `${capped}px`;
    area.style.height = `${capped}px`;
    area.style.maxHeight = `${Math.floor(window.innerHeight * 0.8)}px`;
  };

  boldBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    area.focus();
    document.execCommand("bold", false);
  });

  colorGroup.addEventListener("mousedown", (event) => {
    const swatch = event.target.closest("[data-color]");
    if (!swatch) return;
    event.preventDefault();
    area.focus();
    document.execCommand("foreColor", false, swatch.dataset.color);
  });

  area.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finish(true);
    }
  });

  area.addEventListener("blur", () => {
    setTimeout(() => {
      if (!wrap.contains(document.activeElement)) {
        finish(true);
      }
    }, 0);
  });

  onRendered(() => {
    sizeToCell();
    requestAnimationFrame(sizeToCell);
    area.focus();
    // Cursor ans Ende, ohne alles zu markieren
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(area);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });

  return wrap;
}
