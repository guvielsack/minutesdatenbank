let authState = {
  authenticated: false,
  username: null,
  role: "jeder",
  can_read: true,
  can_write: false,
  can_admin: false,
};
let lookups = {};
let minutesTable;
let yearPlanTable;
let minutesFilter = "all";
let pendingCellSaves = Promise.resolve();
let copiedMinuteRow = null;

const COPYABLE_MINUTE_FIELDS = [
  "entry_type",
  "content",
  "responsible",
  "along_with",
  "since_when",
  "until_when",
  "remarks",
  "category",
  "status",
  "link",
];

function getSchoolHolidaySuggestions() {
  const values = new Set(lookups.school_holiday_labels || []);
  getExcelSourceData("year-plan").forEach((row) => {
    const label = row.school_holiday?.trim();
    if (label) values.add(label);
  });
  return [...values].sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
}

function getFocusTopicSuggestions() {
  const values = new Set(lookups.categories || []);
  getExcelSourceData("year-plan").forEach((row) => {
    const topic = row.focus_topic?.trim();
    if (topic) values.add(topic);
  });
  return [...values].sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
}

function formatDateDE(value) {
  if (value == null || value === "") return "";
  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
  }
  const deMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (deMatch) {
    return `${deMatch[1].padStart(2, "0")}.${deMatch[2].padStart(2, "0")}.${deMatch[3]}`;
  }
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function parseDateDE(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const deMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (deMatch) {
    return `${deMatch[3]}-${deMatch[2].padStart(2, "0")}-${deMatch[1].padStart(2, "0")}`;
  }
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  return text;
}

const dateFormatter = (cell) => formatDateDE(cell.getValue());

const dateColumn = (overrides = {}) => ({
  editor: "input",
  editorParams: { elementAttributes: { placeholder: "TT.MM.JJJJ", maxlength: "10" } },
  formatter: dateFormatter,
  ...overrides,
});

function normalizeCellValue(field, value) {
  if (value === "") return null;
  if (!["since_when", "until_when", "meeting_date"].includes(field) || value == null) {
    return value;
  }
  const parsed = parseDateDE(String(value).trim());
  if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return parsed;
  throw new Error("Ungültiges Datum – bitte TT.MM.JJJJ verwenden.");
}

function tableHasOpenEditor(table) {
  if (!table?.element) return false;
  const active = document.activeElement;
  return (
    active &&
    table.element.contains(active) &&
    (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")
  );
}

async function commitOpenCellEdits() {
  const tables = [minutesTable, yearPlanTable].filter(Boolean);
  for (const table of tables) {
    if (tableHasOpenEditor(table)) {
      document.activeElement.blur();
    }
  }
  await pendingCellSaves;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function queueCellSave(saveFn) {
  pendingCellSaves = pendingCellSaves.then(saveFn).catch((error) => {
    console.error(error);
    throw error;
  });
  return pendingCellSaves;
}

function readEditedCellValue(cell) {
  const value = cell.getValue();
  if (value !== undefined) return value;
  return cell.getRow().getData()[cell.getField()];
}

function applyMinuteRowStyle(row, data) {
  const rowElement = row.getElement();
  rowElement.classList.remove("row-part", "row-agenda");
  const cls = rowClass(data);
  if (cls) rowElement.classList.add(cls);
}

function refreshTaskStatusCell(row) {
  const statusCell = row.getCells().find((cell) => cell.getField() === "status");
  statusCell?.getElement()?.classList.remove("status-overdue", "status-due-soon");
  const statusClass = getTaskStatusClass(row.getData());
  if (statusClass) statusCell?.getElement()?.classList.add(statusClass);
}

async function saveMinuteCell(cell) {
  if (!canEditData()) {
    cell.restoreOldValue();
    return;
  }
  return queueCellSave(async () => {
    if (!canEditData()) {
      cell.restoreOldValue();
      return;
    }
    const row = cell.getRow();
    const field = cell.getField();
    let value = readEditedCellValue(cell);

    try {
      value = normalizeCellValue(field, value);
    } catch (error) {
      alert(error.message);
      cell.restoreOldValue();
      return;
    }

    if (["since_when", "until_when"].includes(field)) {
      cell.setValue(value, true);
    }

    const updatedRow = { ...row.getData(), [field]: value };
    updateExcelSourceRow("minutes", updatedRow);
    if (field === "remarks" && updatedRow.entry_type !== "Part.") {
      refreshMeetingDurationDisplays();
    }

    try {
      await api(`/api/minutes/${row.getData().id}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
        keepalive: true,
      });
      applyMinuteRowStyle(row, updatedRow);
      if (["until_when", "status", "entry_type"].includes(field)) {
        refreshTaskStatusCell(row);
      }
      if (isExcelColumnFiltered("minutes", field)) {
        await applyExcelColumnFilters("minutes");
      }
    } catch (error) {
      cell.restoreOldValue();
      if (canEditData()) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
      }
    }
  });
}

async function saveYearPlanCell(cell) {
  if (!canEditData()) {
    cell.restoreOldValue();
    return;
  }
  return queueCellSave(async () => {
    if (!canEditData()) {
      cell.restoreOldValue();
      return;
    }
    const row = cell.getRow();
    const field = cell.getField();
    let value = readEditedCellValue(cell);

    try {
      value = normalizeCellValue(field, value);
    } catch (error) {
      alert(error.message);
      cell.restoreOldValue();
      return;
    }

    if (field === "meeting_date") {
      cell.setValue(value, true);
    }

    try {
      const updated = await api(`/api/year-plan/${row.getData().id}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
        keepalive: true,
      });
      const updatedRow = { ...row.getData(), [field]: value, ...(updated || {}) };
      updateExcelSourceRow("year-plan", updatedRow);
      if (field === "meeting_date") {
        row.update({ school_holiday: updated.school_holiday });
      } else if (field === "school_holiday") {
        row.update({ school_holiday: updated.school_holiday });
      }
      if (isExcelColumnFiltered("year-plan", field)) {
        await applyExcelColumnFilters("year-plan");
      }
    } catch (error) {
      cell.restoreOldValue();
      if (canEditData()) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
      }
    }
  });
}

function updateMinutesRowCount(count, filtered = false) {
  const label = document.getElementById("minutes-row-count");
  if (!label) return;
  if (filtered) {
    label.textContent = count != null ? `${count} offene Aufgaben` : "";
  } else {
    label.textContent = count != null ? `${count} Zeilen` : "";
  }
}

function refreshMinutesRowCountLabel() {
  if (!minutesTable) return;
  const label = document.getElementById("minutes-row-count");
  if (!label) return;
  const total = getExcelSourceData("minutes").length;
  const visible = minutesTable.getDataCount();
  const filteredView = minutesFilter === "open";
  if (visible < total) {
    label.textContent = filteredView
      ? `${visible} von ${total} offene Aufgaben`
      : `${visible} von ${total} Zeilen`;
  } else {
    updateMinutesRowCount(total, filteredView);
  }
}

function getMinutesScrollHolder() {
  return document.querySelector("#minutes-table .tabulator-tableholder");
}

function captureScrollAnchor(excludedRowIds = new Set()) {
  const holder = getMinutesScrollHolder();
  if (!holder || !minutesTable) return null;

  const scrollTop = holder.scrollTop;
  for (const row of minutesTable.getRows()) {
    const rowId = row.getData().id;
    if (excludedRowIds.has(rowId)) continue;
    const element = row.getElement();
    if (element.offsetTop + element.offsetHeight > scrollTop + 1) {
      return {
        rowId,
        offset: element.offsetTop - scrollTop,
      };
    }
  }
  return null;
}

function captureScrollState(excludedRowIds = new Set()) {
  const holder = getMinutesScrollHolder();
  if (!holder || !minutesTable) return null;

  const anchor = captureScrollAnchor(excludedRowIds);
  let anchorRowNr = null;
  if (anchor) {
    const anchorRow = minutesTable.getRows().find((row) => row.getData().id === anchor.rowId);
    if (anchorRow) anchorRowNr = anchorRow.getData().row_nr;
  }

  return {
    scrollTop: holder.scrollTop,
    scrollHeight: holder.scrollHeight,
    clientHeight: holder.clientHeight,
    nearBottom: holder.scrollHeight - holder.scrollTop - holder.clientHeight < 120,
    anchor,
    anchorRowNr,
  };
}

function restoreScrollAnchor(anchor) {
  if (!anchor || !minutesTable) return;
  const holder = getMinutesScrollHolder();
  if (!holder) return;

  const apply = () => {
    const row = minutesTable.getRows().find((item) => item.getData().id === anchor.rowId);
    if (!row) return;
    holder.scrollTop = row.getElement().offsetTop - anchor.offset;
  };

  apply();
  requestAnimationFrame(apply);
}

function restoreScrollState(state) {
  focusMinutesScrollState(state);
}

async function applyMinutesScroll(applyScroll, { preserveLayout = false } = {}) {
  if (!preserveLayout) {
    await recalculateMinutesLayout();
  }
  await applyScroll();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  // Zweites redraw nach dem Scrollen setzt die Position oft wieder auf oben –
  // daher nur ohne preserveLayout (z. B. bei Scroll-State-Restore).
  if (!preserveLayout) {
    await recalculateMinutesLayout();
    await applyScroll();
  } else {
    await applyScroll();
  }
}

function renumberMinutesRows() {
  minutesTable.getRows().forEach((row, index) => {
    if (row.getData().row_nr !== index) {
      row.update({ row_nr: index });
    }
  });
}

function scrollMinutesToTop() {
  const holder = getMinutesScrollHolder();
  if (holder) holder.scrollTop = 0;
}

function scrollMinutesToBottom() {
  const rows = minutesTable?.getRows() || [];
  if (rows.length === 0) return;

  const last = rows[rows.length - 1];
  try {
    minutesTable.scrollToRow(last, "bottom", false);
  } catch {
    // Tabulator kann scrollToRow vor fertigem Layout ablehnen
  }

  const holder = getMinutesScrollHolder();
  if (!holder) return;

  const lastElement = last.getElement?.();
  if (lastElement) {
    holder.scrollTop = Math.max(0, lastElement.offsetTop + lastElement.offsetHeight - holder.clientHeight);
  } else {
    holder.scrollTop = holder.scrollHeight;
  }
}

function isMinutesNearBottom(threshold = 120) {
  const holder = getMinutesScrollHolder();
  if (!holder || holder.scrollHeight <= holder.clientHeight) return true;
  return holder.scrollHeight - holder.scrollTop - holder.clientHeight <= threshold;
}

async function scrollMinutesToBottomReliable({ maxWaitMs = 5000 } = {}) {
  const started = performance.now();
  let lastHeight = -1;
  let stableCount = 0;

  while (performance.now() - started < maxWaitMs) {
    scrollMinutesToBottom();

    const holder = getMinutesScrollHolder();
    if (!holder) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }

    const height = holder.scrollHeight;
    if (height > 0 && height === lastHeight) {
      stableCount += 1;
    } else {
      stableCount = 0;
      lastHeight = height;
    }

    if (isMinutesNearBottom() && stableCount >= 2) {
      scrollMinutesToBottom();
      return;
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  scrollMinutesToBottom();
}

function pinMinutesScrollToBottom(durationMs = 2500) {
  const until = Date.now() + durationMs;
  const tick = () => {
    scrollMinutesToBottom();
    if (Date.now() < until) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
  setTimeout(scrollMinutesToBottom, durationMs + 50);
}

function scrollToMinuteRowById(rowId, position = "center") {
  if (rowId == null || !minutesTable) return false;
  const row = minutesTable.getRows().find((item) => item.getData().id === rowId);
  if (!row) return false;
  minutesTable.scrollToRow(row, position, false);
  row.select();
  return true;
}

async function startMinuteContentEdit(rowId) {
  for (const delay of [0, 50, 100, 200, 400]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const row = minutesTable.getRows().find((item) => item.getData().id === rowId);
    if (!row) continue;

    const cell = row.getCell("content");
    if (cell) {
      cell.edit();
    } else {
      minutesTable.editCell(row, "content");
    }

    const cellElement = row.getCell("content")?.getElement();
    const editor =
      cellElement?.querySelector("textarea, input") ||
      document.querySelector(".tabulator-editing textarea, .tabulator-editing input");
    if (editor) {
      editor.focus();
      if (typeof editor.select === "function" && editor.tagName === "INPUT") {
        editor.select();
      }
      return;
    }
  }
}

async function focusMinuteRow(rowId, { position = "center", anchorOffset = null } = {}) {
  const apply = () => {
    if (!scrollToMinuteRowById(rowId, position)) return false;
    if (anchorOffset != null) {
      const holder = getMinutesScrollHolder();
      if (holder) holder.scrollTop = Math.max(0, holder.scrollTop - anchorOffset);
    }
    return true;
  };

  if (apply()) return;
  await recalculateMinutesLayout();
  if (apply()) return;

  for (const delay of [50, 100, 200, 400, 700]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    await recalculateMinutesLayout();
    if (apply()) return;
  }

  scrollMinutesToBottom();
}

async function focusMinutesScrollState(state) {
  if (!state) return;

  if (state.anchor?.rowId) {
    await focusMinuteRow(state.anchor.rowId, {
      position: "top",
      anchorOffset: state.anchor.offset,
    });
    return;
  }

  if (state.nearBottom) {
    await recalculateMinutesLayout();
    scrollMinutesToBottom();
    return;
  }

  if (state.anchorRowNr != null) {
    scrollMinutesToRowNr(state.anchorRowNr);
    return;
  }

  const holder = getMinutesScrollHolder();
  if (holder) {
    const heightDelta = holder.scrollHeight - state.scrollHeight;
    holder.scrollTop = Math.max(0, state.scrollTop + heightDelta);
  }
}

async function recalculateMinutesLayout() {
  minutesTable.getRows().forEach((row) => {
    row.normalizeHeight();
  });
  await minutesTable.redraw(true);
}

function scrollMinutesToRowNr(rowNr) {
  const rows = minutesTable.getRows();
  if (rows.length === 0) return;

  let target = rows.find((row) => row.getData().row_nr === rowNr);
  if (!target) {
    target = rows.filter((row) => row.getData().row_nr < rowNr).pop() || rows[0];
  }

  target.select();
  minutesTable.scrollToRow(target, "top", false);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    headers,
    credentials: "include",
    keepalive: Boolean(options.keepalive),
    ...options,
  });
  if (!response.ok) {
    const detail = await response.text();
    let message = detail || response.statusText;
    try {
      const parsed = JSON.parse(detail);
      if (parsed.detail) {
        message = Array.isArray(parsed.detail)
          ? parsed.detail.map((item) => item.msg || String(item)).join(", ")
          : String(parsed.detail);
      }
    } catch {
      // keep raw response text
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function parseIsoDate(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!isoMatch) return null;
  return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
}

function getTaskStatusClass(data) {
  if (data.entry_type !== "T") return "";
  const status = (data.status || "").trim().toLowerCase();
  if (status === "done") return "";

  const dueDate = parseIsoDate(data.until_when);
  if (!dueDate) return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  if (due < today) return "status-overdue";

  const withinSevenDays = new Date(today);
  withinSevenDays.setDate(withinSevenDays.getDate() + 7);
  if (due <= withinSevenDays) return "status-due-soon";

  return "";
}

function isOpenTask(data) {
  if (data.entry_type !== "T") return false;
  const status = (data.status || "").trim().toLowerCase();
  return status !== "done";
}

function parseDurationMinutes(value) {
  if (value == null || value === "") return null;
  const match = String(value).trim().match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatDurationMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function computeMeetingDurationTotals(rows) {
  const sorted = [...rows].sort((a, b) => a.row_nr - b.row_nr || a.id - b.id);
  const totals = new Map();
  let currentPartId = null;
  let currentSum = 0;

  for (const row of sorted) {
    if (row.entry_type === "Part.") {
      if (currentPartId != null) {
        totals.set(currentPartId, currentSum);
      }
      currentPartId = row.id;
      currentSum = 0;
      continue;
    }
    if (currentPartId == null) continue;
    const minutes = parseDurationMinutes(row.remarks);
    if (minutes != null) currentSum += minutes;
  }

  if (currentPartId != null) {
    totals.set(currentPartId, currentSum);
  }

  return totals;
}

let meetingDurationTotals = new Map();

function refreshMeetingDurationTotals() {
  meetingDurationTotals = computeMeetingDurationTotals(getExcelSourceData("minutes"));
}

function getMeetingDurationLabel(partRowId) {
  const totalMinutes = meetingDurationTotals.get(partRowId);
  if (totalMinutes == null || totalMinutes <= 0) return "";
  return formatDurationMinutes(totalMinutes);
}

function refreshMeetingDurationDisplays() {
  refreshMeetingDurationTotals();
  if (!minutesTable) return;
  minutesTable.getRows().forEach((row) => {
    if (row.getData().entry_type === "Part.") {
      row.reformat();
    }
  });
}

const meetingRemarksFormatter = (cell) => {
  const data = cell.getRow().getData();
  if (data.entry_type === "Part.") {
    return getMeetingDurationLabel(data.id);
  }
  const value = cell.getValue();
  return value == null ? "" : String(value);
};

function rowClass(data) {
  if (data.entry_type === "Part.") return "row-part";
  if (data.entry_type === "A") return "row-agenda";
  return "";
}

const statusFormatter = (cell) => {
  const element = cell.getElement();
  element.classList.remove("status-overdue", "status-due-soon");
  const statusClass = getTaskStatusClass(cell.getRow().getData());
  if (statusClass) element.classList.add(statusClass);
  const value = cell.getValue();
  return value == null ? "" : String(value);
};

async function loadAuthState() {
  authState = await api("/api/auth/me");
}

function canEditData() {
  return Boolean(authState.can_write);
}

function canEditRemarksCell(cell) {
  return canEditData() && cell.getRow().getData().entry_type !== "Part.";
}

function updateTableColumnEditPermissions(table) {
  if (!table) return;
  const allowEdit = canEditData();
  table.getColumns().forEach((column) => {
    const field = column.getField();
    if (!field) return;
    if (field === "remarks") {
      column.updateDefinition({ editable: allowEdit ? canEditRemarksCell : false });
      return;
    }
    column.updateDefinition({ editable: allowEdit });
  });
}

function applyTableEditPermissions() {
  const scrollState = minutesTable ? captureScrollState() : null;
  const stayAtBottom = Boolean(scrollState?.nearBottom);
  updateTableColumnEditPermissions(minutesTable);
  updateTableColumnEditPermissions(yearPlanTable);
  document.body.classList.toggle("read-only-mode", !canEditData());
  if (!minutesTable) return;
  requestAnimationFrame(() => {
    if (stayAtBottom) {
      scrollMinutesToBottom();
      return;
    }
    if (scrollState) {
      focusMinutesScrollState(scrollState);
    }
  });
}

function blockReadOnlyCellEdit(cell) {
  if (canEditData()) return;
  cell.cancelEdit();
  cell.restoreOldValue();
}

function applyAuthStateToUi() {
  const roleLabel = document.getElementById("auth-role-label");
  const loginLink = document.getElementById("login-link");
  const adminLink = document.getElementById("admin-link");
  const logoutBtn = document.getElementById("logout-btn");

  if (authState.authenticated) {
    roleLabel.textContent = `${authState.username} (${authState.role === "admin" ? "Admin" : "Protokollant"})`;
    loginLink.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
  } else {
    roleLabel.textContent = "Lesemodus (jeder)";
    loginLink.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
  }

  adminLink.classList.toggle("hidden", !authState.can_admin);

  document.querySelectorAll("[data-requires-write]").forEach((element) => {
    element.hidden = !authState.can_write;
  });
  document.querySelectorAll("[data-requires-admin]").forEach((element) => {
    element.hidden = !authState.can_admin;
  });

  ["project-name", "project-meeting", "project-participants"].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.disabled = !authState.can_admin;
  });

  applyTableEditPermissions();
}

function setupAuthBar() {
  document.getElementById("logout-btn").addEventListener("click", async () => {
    authState = await api("/api/auth/logout", { method: "POST" });
    applyAuthStateToUi();
  });
}

function buildMinutesTable() {
  minutesTable = new Tabulator("#minutes-table", {
    height: "calc(100vh - 155px)",
    layout: "fitColumns",
    index: "id",
    selectableRows: true,
    virtualDom: false,
    variableHeight: true,
    placeholder: "Daten werden geladen…",
    columnDefaults: {
      minWidth: 70,
      vertAlign: "top",
      headerSort: false,
      editable: canEditData(),
    },
    rowFormatter(row) {
      const el = row.getElement();
      el.classList.remove("row-part", "row-agenda");
      const cls = rowClass(row.getData());
      if (cls) el.classList.add(cls);
    },
    columns: [
      {
        title: "#",
        field: "row_nr",
        width: 55,
        editor: "number",
        hozAlign: "center",
        titleFormatter: excelHeaderTitle("#", "row_nr"),
      },
      {
        title: "Typ",
        field: "entry_type",
        width: 70,
        editor: "list",
        editorParams: { values: lookups.entry_types },
        titleFormatter: excelHeaderTitle("Typ", "entry_type"),
      },
      {
        title: "Inhalt",
        field: "content",
        editor: "textarea",
        widthGrow: 3,
        minWidth: 260,
        cssClass: "cell-content-multiline",
        formatter: "plaintext",
        titleFormatter: excelHeaderTitle("Inhalt", "content"),
      },
      {
        title: "Verantwortlich",
        field: "responsible",
        width: 110,
        editor: "input",
        titleFormatter: excelHeaderTitle("Verantwortlich", "responsible"),
      },
      {
        title: "Mit",
        field: "along_with",
        width: 90,
        editor: "input",
        titleFormatter: excelHeaderTitle("Mit", "along_with"),
      },
      dateColumn({
        title: "Seit",
        field: "since_when",
        width: 100,
        titleFormatter: excelHeaderTitle("Seit", "since_when"),
      }),
      dateColumn({
        title: "Bis",
        field: "until_when",
        width: 105,
        titleFormatter: excelHeaderTitle("Bis", "until_when"),
      }),
      {
        title: "Bemerkung / Dauer",
        field: "remarks",
        width: 110,
        editable: canEditData() ? canEditRemarksCell : false,
        editor: "input",
        formatter: meetingRemarksFormatter,
        titleFormatter: excelHeaderTitle("Bemerkung /<br>Dauer", "remarks", { html: true }),
      },
      {
        title: "Kategorie",
        field: "category",
        width: 170,
        editor: "list",
        editorParams: { values: lookups.categories, autocomplete: true, freetext: true },
        titleFormatter: excelHeaderTitle("Kategorie", "category"),
      },
      {
        title: "Status",
        field: "status",
        width: 80,
        editor: "list",
        editorParams: { values: lookups.statuses, clearable: true },
        formatter: statusFormatter,
        titleFormatter: excelHeaderTitle("Status", "status"),
      },
    ],
  });
  minutesTable.on("cellEdited", (cell) => {
    if (!canEditData()) {
      cell.restoreOldValue();
      return;
    }
    saveMinuteCell(cell);
  });
  minutesTable.on("cellEditing", blockReadOnlyCellEdit);
}

function buildYearPlanTable() {
  const absenceEditor = {
    editor: "list",
    editorParams: { values: ["", "X"], clearable: true },
    hozAlign: "center",
    width: 55,
  };

  yearPlanTable = new Tabulator("#year-plan-table", {
    height: "calc(100vh - 155px)",
    layout: "fitDataStretch",
    index: "id",
    placeholder: "Kein Jahresplan – optional per Excel importieren.",
    columnDefaults: {
      editable: canEditData(),
    },
    columns: [
      {
        title: "Tag",
        field: "weekday",
        width: 90,
        editor: "input",
        titleFormatter: excelHeaderTitle("Tag", "weekday", { tableKey: "year-plan" }),
      },
      dateColumn({
        title: "Datum",
        field: "meeting_date",
        width: 110,
        titleFormatter: excelHeaderTitle("Datum", "meeting_date", { tableKey: "year-plan" }),
      }),
      {
        title: "Schulferien",
        field: "school_holiday",
        width: 110,
        editor: "list",
        editorParams: () => ({
          values: getSchoolHolidaySuggestions(),
          autocomplete: true,
          freetext: true,
          clearable: true,
        }),
        formatter(cell) {
          const value = cell.getValue();
          if (!value) return "";
          return `<span class="holiday-label">${String(value)}</span>`;
        },
        titleFormatter: excelHeaderTitle("Schulferien", "school_holiday", { tableKey: "year-plan" }),
      },
      {
        title: "Schwerpunktsthema",
        field: "focus_topic",
        minWidth: 220,
        editor: "list",
        editorParams: () => ({
          values: getFocusTopicSuggestions(),
          autocomplete: true,
          freetext: true,
        }),
        titleFormatter: excelHeaderTitle("Schwerpunktsthema", "focus_topic", { tableKey: "year-plan" }),
      },
      {
        title: "Fach-Topic / MA",
        field: "fach_topic",
        minWidth: 180,
        editor: "input",
        titleFormatter: excelHeaderTitle("Fach-Topic / MA", "fach_topic", { tableKey: "year-plan" }),
      },
      {
        title: "Ort",
        field: "location",
        width: 100,
        editor: "list",
        editorParams: { values: lookups.locations, freetext: true },
        titleFormatter: excelHeaderTitle("Ort", "location", { tableKey: "year-plan" }),
      },
      { title: "AO", field: "absence_ao", ...absenceEditor, titleFormatter: excelHeaderTitle("AO", "absence_ao", { tableKey: "year-plan" }) },
      { title: "CN", field: "absence_cn", ...absenceEditor, titleFormatter: excelHeaderTitle("CN", "absence_cn", { tableKey: "year-plan" }) },
      { title: "DK", field: "absence_dk", ...absenceEditor, titleFormatter: excelHeaderTitle("DK", "absence_dk", { tableKey: "year-plan" }) },
      { title: "JS", field: "absence_js", ...absenceEditor, titleFormatter: excelHeaderTitle("JS", "absence_js", { tableKey: "year-plan" }) },
      { title: "GV", field: "absence_gv", ...absenceEditor, titleFormatter: excelHeaderTitle("GV", "absence_gv", { tableKey: "year-plan" }) },
      { title: "JB", field: "absence_jb", ...absenceEditor, titleFormatter: excelHeaderTitle("JB", "absence_jb", { tableKey: "year-plan" }) },
      { title: "SM", field: "absence_sm", ...absenceEditor, titleFormatter: excelHeaderTitle("SM", "absence_sm", { tableKey: "year-plan" }) },
      { title: "RE", field: "absence_re", ...absenceEditor, titleFormatter: excelHeaderTitle("RE", "absence_re", { tableKey: "year-plan" }) },
      { title: "AK", field: "absence_ak", ...absenceEditor, titleFormatter: excelHeaderTitle("AK", "absence_ak", { tableKey: "year-plan" }) },
    ],
  });
  yearPlanTable.on("cellEdited", (cell) => {
    if (!canEditData()) {
      cell.restoreOldValue();
      return;
    }
    saveYearPlanCell(cell);
  });
  yearPlanTable.on("cellEditing", blockReadOnlyCellEdit);
}

async function loadProject() {
  const project = await api("/api/project");
  document.getElementById("project-name").value = project.name;
  document.getElementById("project-meeting").value = project.meeting;
  document.getElementById("project-participants").value = project.participants;

  const saveProject = async () => {
    await api("/api/project", {
      method: "PUT",
      body: JSON.stringify({
        name: document.getElementById("project-name").value,
        meeting: document.getElementById("project-meeting").value,
        participants: document.getElementById("project-participants").value,
      }),
    });
  };

  ["project-name", "project-meeting", "project-participants"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      saveProject().catch((error) => alert(error.message));
    });
  });
}

async function loadMinutes({
  scrollToBottom = false,
  scrollToRowNr = null,
  scrollToRowId = null,
  scrollState = null,
  editContent = false,
} = {}) {
  await commitOpenCellEdits();
  const isOpenFilter = minutesFilter === "open";
  const path = isOpenFilter ? "/api/minutes/open-tasks" : "/api/minutes";
  const rows = await api(path);
  setExcelSourceData("minutes", rows);
  refreshMeetingDurationTotals();

  await applyExcelColumnFilters("minutes", {
    restoreScroll: !scrollToBottom && scrollToRowId == null && !scrollState,
  });

  await applyMinutesScroll(
    async () => {
      if (scrollToRowId != null) {
        await focusMinuteRow(scrollToRowId, { position: "center" });
        if (editContent) await startMinuteContentEdit(scrollToRowId);
      } else if (scrollState) {
        await focusMinutesScrollState(scrollState);
      } else if (scrollToBottom) {
        await scrollMinutesToBottomReliable({ maxWaitMs: 2000 });
      } else if (scrollToRowNr != null) {
        scrollMinutesToRowNr(scrollToRowNr);
      }
    },
    { preserveLayout: scrollToBottom }
  );

  refreshExcelFilterButtons("minutes");
  refreshMinutesRowCountLabel();
  await loadMeetingProtocolOptions();

  if (scrollToBottom) {
    scrollMinutesToBottom();
    pinMinutesScrollToBottom(2500);
  }
}

async function loadMeetingProtocolOptions() {
  const select = document.getElementById("meeting-protocol-select");
  if (!select) return;

  const meetings = await api("/api/minutes/meetings");
  const current = select.value;
  select.innerHTML = '<option value="">Datum wählen…</option>';
  meetings.forEach((meeting) => {
    const option = document.createElement("option");
    option.value = String(meeting.id);
    option.textContent = meeting.label;
    select.appendChild(option);
  });
  if (current && [...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

async function downloadOpenTasksPdf() {
  const response = await fetch("/api/minutes/open-tasks.pdf");
  if (!response.ok) {
    const detail = await response.text();
    let message = detail || "PDF konnte nicht erstellt werden.";
    try {
      const parsed = JSON.parse(detail);
      if (parsed.detail) message = String(parsed.detail);
    } catch {
      // keep raw response text
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `offene-aufgaben-${formatDateDE(new Date().toISOString().slice(0, 10)).replace(/\./g, "-")}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadMeetingProtocol() {
  const select = document.getElementById("meeting-protocol-select");
  const partId = select?.value;
  if (!partId) {
    alert("Bitte zuerst ein Meeting-Datum wählen.");
    return;
  }

  const response = await fetch(`/api/minutes/meetings/${partId}/protocol.pdf`);
  if (!response.ok) {
    const detail = await response.text();
    let message = detail || "PDF konnte nicht erstellt werden.";
    try {
      const parsed = JSON.parse(detail);
      if (parsed.detail) message = String(parsed.detail);
    } catch {
      // keep raw response text
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `meeting-protokoll-${select.selectedOptions[0].textContent.replace(/\./g, "-")}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadYearPlan() {
  const rows = await api("/api/year-plan");
  setExcelSourceData("year-plan", rows);
  await applyExcelColumnFilters("year-plan");
  refreshExcelFilterButtons("year-plan");
}

async function addMinuteAtBottom(endpoint, body = {}, { editContent = true } = {}) {
  await commitOpenCellEdits();
  const created = await api(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });

  minutesFilter = "all";

  await loadMinutes({
    scrollToRowId: created.id,
    editContent,
    scrollToBottom: !editContent,
  });
}

function formatDateForInput(value) {
  if (!value) return "";
  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const deMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (deMatch) {
    return `${deMatch[3]}-${deMatch[2].padStart(2, "0")}-${deMatch[1].padStart(2, "0")}`;
  }
  return text;
}

function updateMeetingCreateDialogState() {
  const mode = document.querySelector('input[name="meeting-create-mode"]:checked')?.value;
  const dateField = document.getElementById("meeting-create-date-field");
  dateField.classList.toggle("hidden", mode !== "agenda");
}

function showMeetingCreateDialog(suggestion) {
  const dialog = document.getElementById("meeting-create-dialog");
  const hint = document.getElementById("meeting-create-hint");
  const dateInput = document.getElementById("meeting-create-date");
  const rowMode = document.querySelector('input[name="meeting-create-mode"][value="row"]');
  const agendaMode = document.querySelector('input[name="meeting-create-mode"][value="agenda"]');

  rowMode.checked = true;
  agendaMode.checked = false;
  dateInput.value = formatDateForInput(suggestion.suggested_date);

  if (suggestion.previous_meeting_date) {
    hint.textContent = `Vorheriges Meeting: ${formatDateDE(suggestion.previous_meeting_date)} · ${suggestion.agenda_items} Agenda-Punkte werden kopiert.`;
  } else if (suggestion.agenda_items > 0) {
    hint.textContent = `${suggestion.agenda_items} Agenda-Punkte werden vom letzten Meeting kopiert.`;
  } else {
    hint.textContent = "Es gibt noch kein vorheriges Meeting mit Agenda.";
  }

  updateMeetingCreateDialogState();
  dialog.classList.add("is-open");
  dialog.setAttribute("aria-hidden", "false");

  return new Promise((resolve) => {
    dialog._resolve = resolve;
  });
}

function hideMeetingCreateDialog(result = null) {
  const dialog = document.getElementById("meeting-create-dialog");
  dialog.classList.remove("is-open");
  dialog.setAttribute("aria-hidden", "true");
  if (typeof dialog._resolve === "function") {
    dialog._resolve(result);
    dialog._resolve = null;
  }
}

function setupMeetingCreateDialog() {
  const dialog = document.getElementById("meeting-create-dialog");
  const form = document.getElementById("meeting-create-form");

  dialog.querySelectorAll('input[name="meeting-create-mode"]').forEach((input) => {
    input.addEventListener("change", updateMeetingCreateDialogState);
  });

  dialog.querySelector('[data-action="cancel-meeting-create"]').addEventListener("click", () => {
    hideMeetingCreateDialog(null);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const mode = document.querySelector('input[name="meeting-create-mode"]:checked')?.value;
    if (mode === "agenda") {
      const meetingDate = document.getElementById("meeting-create-date").value;
      if (!meetingDate) {
        alert("Bitte ein Meeting-Datum wählen.");
        return;
      }
      hideMeetingCreateDialog({ mode: "agenda", meetingDate });
      return;
    }
    hideMeetingCreateDialog({ mode: "row" });
  });
}

async function addMeeting() {
  const suggestion = await api("/api/minutes/meetings/suggest-next");
  const choice = await showMeetingCreateDialog(suggestion);
  if (!choice) return;

  if (choice.mode === "row") {
    await addMinuteAtBottom("/api/minutes/meeting", {}, { editContent: true });
    return;
  }

  await addMinuteAtBottom(
    "/api/minutes/meeting",
    {
      with_agenda: true,
      meeting_date: choice.meetingDate,
    },
    { editContent: false }
  );
}

async function insertRowAt(beforeRowNr) {
  await commitOpenCellEdits();
  const payload = { entry_type: "A" };
  if (beforeRowNr != null) {
    payload.before_row_nr = beforeRowNr;
  }

  const scrollState = captureScrollState();
  await api("/api/minutes/insert-row", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await loadMinutes({ scrollState });
}

async function moveRow(entryId, direction) {
  if (entryId == null) return;
  await commitOpenCellEdits();
  const scrollState = captureScrollState();
  await api(`/api/minutes/${entryId}/move`, {
    method: "POST",
    body: JSON.stringify({ direction }),
  });
  await loadMinutes({ scrollState });
  const row = minutesTable.getRow(entryId);
  if (row) row.select();
}

function copyMinuteRowData(rowData) {
  if (!rowData) return;
  const payload = {};
  COPYABLE_MINUTE_FIELDS.forEach((field) => {
    payload[field] = rowData[field] ?? null;
  });
  copiedMinuteRow = {
    sourceId: rowData.id,
    sourceRowNr: rowData.row_nr,
    data: payload,
  };
}

function showPasteRowDialog(targetRow) {
  const dialog = document.getElementById("paste-row-dialog");
  const hint = document.getElementById("paste-row-hint");
  const overwrite = document.querySelector('input[name="paste-row-mode"][value="overwrite"]');
  const below = document.querySelector('input[name="paste-row-mode"][value="below"]');

  overwrite.checked = true;
  below.checked = false;
  const targetNr = targetRow?.row_nr ?? "?";
  const sourceNr = copiedMinuteRow?.sourceRowNr ?? "?";
  hint.textContent = `Kopierte Zeile #${sourceNr} in Zielzeile #${targetNr} einfügen. Überschreiben oder unterhalb?`;

  dialog.classList.add("is-open");
  dialog.setAttribute("aria-hidden", "false");

  return new Promise((resolve) => {
    dialog._resolve = resolve;
  });
}

function hidePasteRowDialog(result = null) {
  const dialog = document.getElementById("paste-row-dialog");
  dialog.classList.remove("is-open");
  dialog.setAttribute("aria-hidden", "true");
  if (typeof dialog._resolve === "function") {
    dialog._resolve(result);
    dialog._resolve = null;
  }
}

function setupPasteRowDialog() {
  const dialog = document.getElementById("paste-row-dialog");
  const form = document.getElementById("paste-row-form");

  dialog.querySelector('[data-action="cancel-paste-row"]').addEventListener("click", () => {
    hidePasteRowDialog(null);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const mode = document.querySelector('input[name="paste-row-mode"]:checked')?.value;
    hidePasteRowDialog(mode === "below" ? "below" : "overwrite");
  });
}

async function pasteCopiedMinuteRow(targetRow) {
  if (!copiedMinuteRow?.data || !targetRow) return;

  const mode = await showPasteRowDialog(targetRow);
  if (!mode) return;

  await commitOpenCellEdits();
  const scrollState = captureScrollState();
  const payload = { ...copiedMinuteRow.data };

  if (mode === "overwrite") {
    await api(`/api/minutes/${targetRow.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await loadMinutes({ scrollState, scrollToRowId: targetRow.id });
    return;
  }

  const created = await api("/api/minutes", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      after_row_nr: targetRow.row_nr,
    }),
  });
  await loadMinutes({ scrollState, scrollToRowId: created.id });
}

async function addEntry(entryType) {
  await addMinuteAtBottom("/api/minutes", {
    entry_type: entryType,
    status: entryType === "T" ? "open" : null,
  });
}

async function deleteSelectedRows() {
  await commitOpenCellEdits();
  const selectedRows = minutesTable.getSelectedRows();
  if (selectedRows.length === 0) {
    alert("Bitte zuerst mindestens eine Zeile auswählen.");
    return;
  }
  const message =
    selectedRows.length === 1
      ? "Ausgewählte Zeile wirklich löschen?"
      : `${selectedRows.length} ausgewählte Zeilen wirklich löschen?`;
  if (!confirm(message)) return;

  const excludedIds = new Set(selectedRows.map((row) => row.getData().id));
  const scrollState = captureScrollState(excludedIds);

  await api("/api/minutes/delete-rows", {
    method: "POST",
    body: JSON.stringify({
      entry_ids: [...excludedIds],
    }),
  });

  removeExcelSourceRows("minutes", excludedIds);
  getExcelSourceData("minutes").forEach((row, index) => {
    row.row_nr = index;
  });
  refreshMeetingDurationTotals();
  await applyExcelColumnFilters("minutes");

  await applyMinutesScroll(async () => {
    await focusMinutesScrollState(scrollState);
  });

  refreshMinutesRowCountLabel();
}

async function importExcelFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/import/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    let message = detail || response.statusText;
    try {
      const parsed = JSON.parse(detail);
      if (parsed.detail) {
        message = Array.isArray(parsed.detail)
          ? parsed.detail.map((item) => item.msg || String(item)).join(", ")
          : String(parsed.detail);
      }
    } catch {
      // keep raw response text
    }
    throw new Error(message);
  }

  const result = await response.json();
  let message = `Import abgeschlossen (${result.source_file}):\n${result.minute_rows} Minutes-Zeilen`;
  if (result.year_plan_included) {
    message += `, ${result.year_plan_rows} Jahresplan-Zeilen`;
  } else {
    message += "\nJahresplan unverändert (Sheet fehlte).";
  }
  alert(message);

  minutesFilter = "all";
  excelFilters.minutes = {};
  hideExcelColumnFilterMenu();

  await loadProject();
  await loadMinutes();
  await loadYearPlan();
  refreshExcelFilterButtons("minutes");
  await loadMeetingProtocolOptions();
}

function setupExcelImport() {
  const input = document.getElementById("excel-import-input");
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    try {
      await importExcelFile(file);
    } catch (error) {
      alert(error.message);
    }
  });
}

function setupToolbar() {
  const toolbar = document.getElementById("minutes-toolbar");
  toolbar.addEventListener(
    "mousedown",
    (event) => {
      if (event.target.closest("button[data-action]") && tableHasOpenEditor(minutesTable)) {
        document.activeElement.blur();
      }
    },
    true
  );

  toolbar.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    try {
      await commitOpenCellEdits();
      if (action === "meeting") await addMeeting();
      if (action === "task") await addEntry("T");
      if (action === "decision") await addEntry("D");
      if (action === "information") await addEntry("I");
      if (action === "agenda") await addEntry("A");
      if (action === "open-tasks") {
        const scrollState = captureScrollState();
        minutesFilter = "open";
        clearExcelColumnFilters("minutes");
        await loadMinutes({ scrollState });
      }
      if (action === "all-rows") {
        minutesFilter = "all";
        clearExcelColumnFilters("minutes");
        await loadMinutes({ scrollToBottom: true });
      }
      if (action === "import") document.getElementById("excel-import-input").click();
      if (action === "open-tasks-pdf") await downloadOpenTasksPdf();
      if (action === "meeting-protocol") await downloadMeetingProtocol();
    } catch (error) {
      alert(error.message);
    }
  });
}

function positionContextMenu(menu, clientX, clientY) {
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.classList.remove("hidden");

  const rect = menu.getBoundingClientRect();
  const padding = 8;
  const maxLeft = Math.max(padding, window.innerWidth - rect.width - padding);
  const maxTop = Math.max(padding, window.innerHeight - rect.height - padding);
  const left = Math.min(Math.max(clientX, padding), maxLeft);
  const top = Math.min(Math.max(clientY, padding), maxTop);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function setupMinutesContextMenu() {
  const menu = document.getElementById("row-context-menu");
  const pasteItem = document.getElementById("paste-row-menu-item");
  let contextRow = null;

  const hideMenu = () => menu.classList.add("hidden");

  minutesTable.on("rowContext", (event, row) => {
    if (!authState.can_write) return;
    event.preventDefault();
    contextRow = row;
    row.select();
    pasteItem.classList.toggle("hidden", !copiedMinuteRow);
    positionContextMenu(menu, event.clientX, event.clientY);
  });

  menu.addEventListener("mousedown", (event) => {
    if (!event.target.closest("button")) {
      event.preventDefault();
    }
  });

  menu.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    event.stopPropagation();
    hideMenu();
    try {
      await commitOpenCellEdits();
      const rowData = contextRow?.getData();
      const entryId = rowData?.id;
      if (button.dataset.action === "move-up") {
        await moveRow(entryId, "up");
      }
      if (button.dataset.action === "move-down") {
        await moveRow(entryId, "down");
      }
      if (button.dataset.action === "copy-row") {
        copyMinuteRowData(rowData);
      }
      if (button.dataset.action === "paste-row") {
        await pasteCopiedMinuteRow(rowData);
      }
      if (button.dataset.action === "insert-row") {
        await insertRowAt(rowData?.row_nr);
      }
      if (button.dataset.action === "delete-row") {
        await deleteSelectedRows();
      }
    } catch (error) {
      alert(error.message);
    }
  });

  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target)) hideMenu();
  });
  document.addEventListener("scroll", hideMenu, true);
  window.addEventListener("resize", hideMenu);
}

function setupRowShortcuts() {
  document.addEventListener("keydown", async (event) => {
    const minutesVisible = document.getElementById("minutes-table").classList.contains("active");
    if (!minutesVisible || !minutesTable || !authState.can_write) return;
    if (event.key === "Delete" && !event.target.closest("input, textarea")) {
      event.preventDefault();
      try {
        await deleteSelectedRows();
      } catch (error) {
        alert(error.message);
      }
    }
  });
}

function setupTabs() {
  document.querySelectorAll(".sheet-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      await commitOpenCellEdits();
      document.querySelectorAll(".sheet-tabs .tab").forEach((el) => el.classList.remove("active"));
      document.querySelectorAll(".sheet-panel").forEach((el) => el.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`${tab.dataset.sheet}-table`).classList.add("active");
      document.getElementById("minutes-toolbar").style.display = tab.dataset.sheet === "minutes" ? "flex" : "none";
    });
  });
}

async function init() {
  document.getElementById("today-label").textContent = formatDateDE(
    new Date().toISOString().slice(0, 10)
  );
  await loadAuthState();
  setupAuthBar();
  applyAuthStateToUi();
  lookups = await api("/api/lookups");
  buildMinutesTable();
  setupMinutesContextMenu();
  buildYearPlanTable();
  applyTableEditPermissions();
  setupToolbar();
  setupExcelImport();
  setupMeetingCreateDialog();
  setupPasteRowDialog();
  setupTabs();
  setupRowShortcuts();
  setupExcelColumnFilterMenu();
  await loadProject();
  await loadMinutes({ scrollToBottom: true });
  await loadYearPlan();
  if (minutesTable) {
    minutesTable.options.placeholder =
      "Keine Einträge – Excel importieren oder neue Zeile anlegen.";
  }
}

init().catch((error) => {
  console.error(error);
  alert(`Initialisierung fehlgeschlagen: ${error.message}`);
});
