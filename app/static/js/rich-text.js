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
  let text = String(value).trim().toLowerCase();
  // Browser liefert oft rgb(...)
  const rgb = text.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb) {
    const hex = `#${[rgb[1], rgb[2], rgb[3]]
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("")}`;
    text = hex;
  }
  if (/^#[0-9a-f]{6}$/.test(text) && ALLOWED_RICH_COLORS.has(text)) return text;
  // nächste erlaubte Farbe (für #ff0000 o.ä. aus execCommand)
  if (/^#[0-9a-f]{6}$/.test(text)) {
    const map = {
      "#000000": "#111111",
      "#111111": "#111111",
      "#ff0000": "#b91c1c",
      "#b91c1c": "#b91c1c",
      "#c2410c": "#c2410c",
      "#008000": "#15803d",
      "#15803d": "#15803d",
      "#0000ff": "#1d4ed8",
      "#1d4ed8": "#1d4ed8",
      "#7e22ce": "#7e22ce",
      "#800080": "#7e22ce",
    };
    return map[text] || null;
  }
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
      } else if (tag === "B" || tag === "STRONG" || tag === "BR") {
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

function richHtmlToPlainText(value) {
  if (value == null || value === "") return "";
  const source = String(value);
  if (!looksLikeRichHtml(source)) return source.replace(/\r\n|\r/g, "\n");
  const template = document.createElement("template");
  template.innerHTML = sanitizeRichHtml(source);
  template.content.querySelectorAll("br").forEach((br) => {
    br.replaceWith("\n");
  });
  return (template.content.textContent || "").replace(/\u00a0/g, " ");
}

function richTextFormatter(cell) {
  const wrap = document.createElement("div");
  wrap.className = "cell-rich-text";
  wrap.innerHTML = richTextDisplayHtml(cell.getValue());
  return wrap;
}

/** Einfacher Mehrzeilen-Editor (ohne Formatierung) für normalen Zellklick. */
function contentPlainEditor(cell, onRendered, success, cancel) {
  const input = document.createElement("textarea");
  input.className = "content-plain-editor";
  input.value = richHtmlToPlainText(cell.getValue() ?? cell.getRow().getData().content);
  input.rows = 8;

  const cellEl = cell.getElement();
  if (cellEl) {
    input.style.width = "100%";
    input.style.minHeight = `${Math.max(cellEl.offsetHeight || 0, 120)}px`;
  }

  let completed = false;
  const finish = (commit) => {
    if (completed) return;
    completed = true;
    if (commit) {
      // Zeilenumbrüche behalten; Formatierung nur über den Dialog
      success(sanitizeRichHtml(input.value));
    } else {
      cancel();
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));

  onRendered(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  return input;
}

function buildRichTextToolbar(area) {
  const toolbar = document.createElement("div");
  toolbar.className = "rich-text-toolbar";

  const boldBtn = document.createElement("button");
  boldBtn.type = "button";
  boldBtn.className = "rich-text-btn";
  boldBtn.title = "Fett";
  boldBtn.innerHTML = "<b>B</b>";
  boldBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    area.focus();
    document.execCommand("bold", false);
  });

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
  colorGroup.addEventListener("mousedown", (event) => {
    const swatch = event.target.closest("[data-color]");
    if (!swatch) return;
    event.preventDefault();
    area.focus();
    document.execCommand("foreColor", false, swatch.dataset.color);
  });

  toolbar.appendChild(boldBtn);
  toolbar.appendChild(colorGroup);
  return toolbar;
}

function mountRichTextModalEditor(container, initialValue) {
  container.innerHTML = "";
  container.classList.add("rich-text-editor", "rich-text-editor-modal");

  const area = document.createElement("div");
  area.className = "rich-text-area rich-text-area-modal";
  area.contentEditable = "true";
  area.spellcheck = true;
  area.innerHTML = richTextDisplayHtml(initialValue);

  const toolbar = buildRichTextToolbar(area);
  container.appendChild(toolbar);
  container.appendChild(area);

  requestAnimationFrame(() => {
    area.focus();
  });

  return {
    getValue: () => sanitizeRichHtml(area.innerHTML),
    focus: () => area.focus(),
  };
}
