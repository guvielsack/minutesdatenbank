const excelFilters = {
  minutes: {},
  "year-plan": {},
};

const excelSourceData = {
  minutes: [],
  "year-plan": [],
};

let excelFilterContext = null;

function setExcelSourceData(tableKey, rows) {
  excelSourceData[tableKey] = Array.isArray(rows) ? rows : [];
}

function getExcelSourceData(tableKey) {
  return excelSourceData[tableKey] ?? [];
}

function updateExcelSourceRow(tableKey, rowData) {
  const source = excelSourceData[tableKey];
  if (!source || rowData?.id == null) return;
  const index = source.findIndex((row) => row.id === rowData.id);
  if (index >= 0) {
    source[index] = { ...source[index], ...rowData };
  }
}

function removeExcelSourceRows(tableKey, rowIds) {
  const ids = rowIds instanceof Set ? rowIds : new Set(rowIds);
  excelSourceData[tableKey] = excelSourceData[tableKey].filter((row) => !ids.has(row.id));
}

function getExcelFilterTable(tableKey) {
  return tableKey === "minutes" ? minutesTable : yearPlanTable;
}

function isExcelColumnFiltered(tableKey, field) {
  const selected = excelFilters[tableKey][field];
  return Boolean(selected && selected.size > 0);
}

function normalizeExcelFilterKey(value, field) {
  if (value == null || value === "") return "__EMPTY__";
  if (["since_when", "until_when", "meeting_date"].includes(field)) {
    return String(value).slice(0, 10);
  }
  if (field === "school_holiday") return value == null || value === "" ? "__EMPTY__" : String(value);
  return String(value);
}

function formatExcelFilterLabel(key, field) {
  if (key === "__EMPTY__") return "(Leer)";
  if (["since_when", "until_when", "meeting_date"].includes(field)) {
    return formatDateDE(key);
  }
  if (field === "school_holiday") return key === "__EMPTY__" ? "(Leer)" : key;
  return key;
}

function getExcelRowData(row) {
  return row && typeof row.getData === "function" ? row.getData() : row;
}

function rowMatchesExcelFilters(tableKey, row, excludeField = null) {
  const data = getExcelRowData(row);
  for (const [filterField, selected] of Object.entries(excelFilters[tableKey])) {
    if (filterField === excludeField) continue;
    if (!selected || selected.size === 0) continue;
    const key = normalizeExcelFilterKey(data[filterField], filterField);
    if (!selected.has(key)) return false;
  }
  return true;
}

function getExcelColumnUniqueValues(tableKey, field) {
  const values = new Map();
  getExcelSourceData(tableKey).forEach((row) => {
    if (!rowMatchesExcelFilters(tableKey, row, field)) return;
    const key = normalizeExcelFilterKey(row[field], field);
    if (!values.has(key)) {
      values.set(key, formatExcelFilterLabel(key, field));
    }
  });

  return [...values.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "de", { numeric: true, sensitivity: "base" }))
    .map(([key, label]) => ({ key, label }));
}

function excelHeaderTitle(title, field, { html = false, tableKey = "minutes" } = {}) {
  return function () {
    const wrap = document.createElement("div");
    wrap.className = "excel-header";

    const label = document.createElement("span");
    label.className = "excel-header-title";
    if (html) label.innerHTML = title;
    else label.textContent = title;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "excel-filter-btn";
    button.dataset.table = tableKey;
    button.dataset.field = field;
    button.setAttribute("aria-label", "Filter");
    button.textContent = "▾";
    if (isExcelColumnFiltered(tableKey, field)) {
      button.classList.add("active");
    }

    button.addEventListener("mousedown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openExcelColumnFilter(tableKey, field, button);
    });

    wrap.appendChild(label);
    wrap.appendChild(button);
    return wrap;
  };
}

function refreshExcelFilterButtons(tableKey) {
  const root = getExcelFilterTable(tableKey)?.element;
  if (!root) return;
  root.querySelectorAll(`.excel-filter-btn[data-table="${tableKey}"]`).forEach((button) => {
    button.classList.toggle("active", isExcelColumnFiltered(tableKey, button.dataset.field));
  });
}

function getExcelFilterVisibleOptions(options, search) {
  const query = search.trim().toLowerCase();
  if (!query) return options;
  return options.filter(({ label }) => label.toLowerCase().includes(query));
}

function resolveExcelFilterSelection({ draftSelected, options, allKeys, search }) {
  if (draftSelected.size > 0) {
    return new Set(draftSelected);
  }

  const query = search.trim();
  if (!query) return new Set();

  const queryLower = query.toLowerCase();
  const exactMatches = options.filter(({ label }) => label.toLowerCase() === queryLower);
  if (exactMatches.length > 0) {
    return new Set(exactMatches.map(({ key }) => key));
  }

  return new Set(getExcelFilterVisibleOptions(options, search).map(({ key }) => key));
}

function syncExcelFilterDraftToSearch() {
  if (!excelFilterContext) return;

  const { options, allKeys, tableKey, field, draftSelected } = excelFilterContext;
  const search = excelFilterContext.search.trim();

  draftSelected.clear();

  if (search) {
    getExcelFilterVisibleOptions(options, search).forEach(({ key }) => draftSelected.add(key));
    return;
  }

  const current = excelFilters[tableKey][field];
  if (current && current.size > 0) {
    [...current].filter((key) => allKeys.has(key)).forEach((key) => draftSelected.add(key));
  }
}

function excelFilterSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

function clearExcelColumnFilters(tableKey) {
  excelFilters[tableKey] = {};
  hideExcelColumnFilterMenu();
  void applyExcelColumnFilters(tableKey);
  refreshExcelFilterButtons(tableKey);
}

async function applyExcelColumnFilters(tableKey) {
  const table = getExcelFilterTable(tableKey);
  if (!table) return;

  const scrollState =
    tableKey === "minutes" && typeof captureScrollState === "function"
      ? captureScrollState()
      : null;

  table.clearFilter(true);

  const source = getExcelSourceData(tableKey);
  const filtered = source.filter((row) => rowMatchesExcelFilters(tableKey, row));

  await table.setData(filtered);

  if (tableKey === "minutes" && typeof recalculateMinutesLayout === "function") {
    await recalculateMinutesLayout();
  }

  if (tableKey === "minutes") {
    if (scrollState && typeof applyMinutesScroll === "function") {
      await applyMinutesScroll(async () => {
        await focusMinutesScrollState(scrollState);
      });
    }
    refreshMinutesRowCountLabel();
  }
}

function hideExcelColumnFilterMenu() {
  const menu = document.getElementById("column-filter-menu");
  menu.classList.add("hidden");
  excelFilterContext = null;
}

function renderExcelFilterOptions() {
  if (!excelFilterContext) return;

  const { tableKey, field, draftSelected, options, search } = excelFilterContext;
  const menu = document.getElementById("column-filter-menu");
  const searchInput = menu.querySelector("#column-filter-search");
  const selectAll = menu.querySelector("#column-filter-select-all");
  const clearBtn = menu.querySelector('[data-action="clear-filter"]');
  const optionsRoot = menu.querySelector(".column-filter-options");

  searchInput.value = search;

  const visibleOptions = getExcelFilterVisibleOptions(options, search);

  const allVisibleSelected =
    visibleOptions.length > 0 && visibleOptions.every(({ key }) => draftSelected.has(key));
  const someVisibleSelected = visibleOptions.some(({ key }) => draftSelected.has(key));

  selectAll.checked = allVisibleSelected;
  selectAll.indeterminate = !allVisibleSelected && someVisibleSelected;

  clearBtn.classList.toggle("hidden", !isExcelColumnFiltered(tableKey, field));

  optionsRoot.innerHTML = "";
  visibleOptions.forEach(({ key, label }) => {
    const row = document.createElement("label");
    row.className = "column-filter-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = draftSelected.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) draftSelected.add(key);
      else draftSelected.delete(key);
      renderExcelFilterOptions();
    });

    const text = document.createElement("span");
    text.textContent = label;

    row.appendChild(checkbox);
    row.appendChild(text);
    optionsRoot.appendChild(row);
  });
}

function openExcelColumnFilter(tableKey, field, anchor) {
  const options = getExcelColumnUniqueValues(tableKey, field);
  const allKeys = new Set(options.map(({ key }) => key));
  const current = excelFilters[tableKey][field];
  const draftSelected = new Set(
    current && current.size > 0 ? [...current].filter((key) => allKeys.has(key)) : []
  );

  excelFilterContext = {
    tableKey,
    field,
    options,
    allKeys,
    draftSelected,
    search: "",
  };

  const menu = document.getElementById("column-filter-menu");
  menu.classList.remove("hidden");
  renderExcelFilterOptions();

  requestAnimationFrame(() => {
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.querySelector("#column-filter-search").focus({ preventScroll: true });
  });
}

async function confirmExcelColumnFilterAction(action) {
  if (!excelFilterContext) return;

  const { tableKey, field, draftSelected, allKeys } = excelFilterContext;

  if (action === "cancel") {
    hideExcelColumnFilterMenu();
    return;
  }

  if (action === "clear-filter") {
    delete excelFilters[tableKey][field];
  } else if (action === "ok") {
    const menu = document.getElementById("column-filter-menu");
    const search = menu.querySelector("#column-filter-search")?.value ?? excelFilterContext.search;
    const selected = resolveExcelFilterSelection({
      draftSelected,
      options: excelFilterContext.options,
      allKeys,
      search,
    });

    if (selected.size === 0 || excelFilterSetsEqual(selected, allKeys)) {
      delete excelFilters[tableKey][field];
    } else {
      excelFilters[tableKey][field] = selected;
    }
  } else {
    return;
  }

  hideExcelColumnFilterMenu();

  await applyExcelColumnFilters(tableKey);
  refreshExcelFilterButtons(tableKey);
}

function setupExcelColumnFilterMenu() {
  const menu = document.getElementById("column-filter-menu");
  const searchInput = menu.querySelector("#column-filter-search");
  const selectAll = menu.querySelector("#column-filter-select-all");

  searchInput.addEventListener("input", () => {
    if (!excelFilterContext) return;
    excelFilterContext.search = searchInput.value;
    syncExcelFilterDraftToSearch();
    renderExcelFilterOptions();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !excelFilterContext) return;
    event.preventDefault();
    void confirmExcelColumnFilterAction("ok");
  });

  selectAll.addEventListener("change", () => {
    if (!excelFilterContext) return;
    const { draftSelected, allKeys, options, search } = excelFilterContext;
    const visibleOptions = getExcelFilterVisibleOptions(options, search);

    if (search.trim()) {
      visibleOptions.forEach(({ key }) => {
        if (selectAll.checked) draftSelected.add(key);
        else draftSelected.delete(key);
      });
    } else if (selectAll.checked) {
      allKeys.forEach((key) => draftSelected.add(key));
    } else {
      draftSelected.clear();
    }
    renderExcelFilterOptions();
  });

  menu.addEventListener("mousedown", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action || !excelFilterContext) return;
    if (action !== "ok" && action !== "cancel" && action !== "clear-filter") return;

    event.preventDefault();
    event.stopPropagation();
    void confirmExcelColumnFilterAction(action);
  });

  menu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action || !excelFilterContext) return;
    if (action !== "ok" && action !== "cancel" && action !== "clear-filter") return;

    event.preventDefault();
    event.stopPropagation();
    void confirmExcelColumnFilterAction(action);
  });

  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target) && !event.target.closest(".excel-filter-btn")) {
      hideExcelColumnFilterMenu();
    }
  });
  window.addEventListener("resize", hideExcelColumnFilterMenu);
  document.addEventListener(
    "scroll",
    (event) => {
      if (menu.classList.contains("hidden")) return;
      if (menu.contains(event.target)) return;
      if (!event.target.closest?.(".tabulator-tableholder")) return;
      hideExcelColumnFilterMenu();
    },
    true
  );

  menu.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
}
