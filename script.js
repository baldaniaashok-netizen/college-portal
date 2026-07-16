const API = (() => {
  const origin = window.location.origin;
  const explicitBase = window.__API_BASE__;

  if (typeof explicitBase === "string" && explicitBase.trim()) {
    return explicitBase.replace(/\/$/, "");
  }

  if (!origin || origin === "null" || origin.startsWith("file:")) {
    return "http://localhost:5000/api";
  }

  return `${origin}/api`;
})();

function getToken() {
  return localStorage.getItem("token");
}

function isProtectedPage(page) {
  return ["dashboard.html", "student-dashboard.html", "admin-dashboard.html", "marks.html", "profile.html", "timeline.html", "notices.html"].includes(page);
}

function isJustLoggedOut() {
  return localStorage.getItem("justLoggedOut") === "1";
}

function authHeaders(extra = {}) {
  const token = getToken();
  return token
    ? { ...extra, Authorization: `Bearer ${token}` }
    : extra;
}

let latestNoticeCache = [];
let selectedInterventionStudent = null;
let studentTimelineCache = [];
let timelinePageState = 1;
let interventionPageState = 1;
const INTERVENTION_PAGE_LIMIT = 10;

let studentDashboardCache = {
  files: null,
  deadlines: null,
  notices: null,
  attendance: null,
  quizzes: null,
  faculties: null,
  marks: null
};

let adminDashboardCache = {
  notices: null,
  files: null,
  marks: null,
  attendance: null
};

async function preloadStudentDashboardData(force = false) {
  if (!force && studentDashboardCache.files) {
    return studentDashboardCache;
  }
  try {
    const data = await apiRequest("/auth/me/dashboard-bundle", { headers: authHeaders() });
    studentDashboardCache = {
      files: data.files || [],
      deadlines: data.deadlines || [],
      notices: data.notices || [],
      attendance: data.attendance || [],
      quizzes: data.quizzes || [],
      faculties: data.faculties || [],
      marks: data.marks || []
    };
    latestNoticeCache = studentDashboardCache.notices;
  } catch (err) {
    console.error("Dashboard preloading failed:", err);
  }
  return studentDashboardCache;
}

function noticeReadStateKey() {
  const userId = localStorage.getItem("userId") || "anonymous";
  return `noticeSeen:${userId}`;
}

function getSeenNoticeIds() {
  try {
    const raw = localStorage.getItem(noticeReadStateKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function setSeenNoticeIds(ids = []) {
  localStorage.setItem(noticeReadStateKey(), JSON.stringify([...new Set(ids.filter(Boolean))]));
}

function getUnreadNotices(notices = []) {
  const seen = new Set(getSeenNoticeIds());
  return notices.filter((n) => !seen.has(String(n._id || "")));
}

function toggleNoticeCenter() {
  const panel = document.getElementById("noticeCenterPanel");
  if (!panel) return;
  const willOpen = panel.classList.contains("d-none");
  panel.classList.toggle("d-none", !willOpen);
  if (willOpen && latestNoticeCache.length) {
    const ids = latestNoticeCache.map((n) => String(n._id || "")).filter(Boolean);
    setSeenNoticeIds([...getSeenNoticeIds(), ...ids]);
    renderNoticeCenter(latestNoticeCache);
  }
}

function markAllNoticesRead() {
  if (!latestNoticeCache.length) return;
  const ids = latestNoticeCache.map((n) => String(n._id || "")).filter(Boolean);
  setSeenNoticeIds([...getSeenNoticeIds(), ...ids]);
  renderNoticeCenter(latestNoticeCache);
  applyNoticeFeedFilters();
  if (document.getElementById("studentActionCenterList")) {
    loadStudentActionCenter();
  }
}

function renderNoticeCenter(notices = []) {
  const unread = getUnreadNotices(notices);
  const countEl = document.getElementById("noticeBellCount");
  if (countEl) {
    countEl.textContent = String(unread.length);
    countEl.classList.toggle("d-none", unread.length === 0);
  }

  const list = document.getElementById("noticeBellItems");
  if (!list) return;
  list.innerHTML = notices.length
    ? notices.slice(0, 8).map((n) => {
      const isUnread = unread.some((u) => String(u._id) === String(n._id));
      const unreadClass = isUnread ? "portal-notice-unread" : "";
      return `<li class="${unreadClass}"><strong>${escapeHtml(n.title || "")}</strong><br>${escapeHtml(n.message || "")}<br><small>${new Date(n.date).toLocaleString()}</small></li>`;
    }).join("")
    : "<li>No notifications yet</li>";
}

function renderNoticeListHtml(notices = [], { isFeedMode = false } = {}) {
  const masterAdmin = isMasterAdminUser();
  return notices.length
    ? notices.map((n) => {
      let audience = "All users";
      if (n.scope === "user" && Array.isArray(n.targetUsernames) && n.targetUsernames.length) {
        audience = `Users: ${n.targetUsernames.join(", ")}`;
      }
      if (n.scope === "group") {
        const coursePart = Array.isArray(n.targetCourses) && n.targetCourses.length
          ? `Course: ${n.targetCourses.join(", ")}`
          : "Course: Any";
        const semPart = Array.isArray(n.targetSemesters) && n.targetSemesters.length
          ? `Semester: ${n.targetSemesters.join(", ")}`
          : "Semester: Any";
        audience = `${coursePart} | ${semPart}`;
      }

      const title = escapeHtml(n.title || "");
      const message = escapeHtml(n.message || "");
      const audienceText = escapeHtml(audience);
      const encodedTitle = encodeURIComponent(n.title || "");
      const encodedMessage = encodeURIComponent(n.message || "");
      const canManage = Boolean(n.canManage) || masterAdmin;
      const ownershipBadge = canManage
        ? '<span class="badge text-bg-success ms-2">Owner</span>'
        : '<span class="badge text-bg-secondary ms-2">Read-only</span>';
      const isUnread = getUnreadNotices([n]).length > 0;
      const unreadBadge = isUnread ? '<span class="badge text-bg-warning ms-2">Unread</span>' : '<span class="badge text-bg-light ms-2">Read</span>';
      const actions = canManage
        ? ` <button class="btn btn-sm btn-outline-secondary ms-2" onclick="editNotice('${n._id}','${encodedTitle}','${encodedMessage}')">Edit</button><button class="btn btn-sm btn-outline-danger ms-2" onclick="deleteNotice('${n._id}')">Delete</button>`
        : "";
      const extraBadges = isFeedMode ? unreadBadge : "";
      return `<li><strong>${title}</strong>${ownershipBadge}${extraBadges}${actions}<br>${message}<br><small>${new Date(n.date).toLocaleString()} | ${audienceText}</small></li>`;
    }).join("")
    : "<li>No notices yet</li>";
}

function applyNoticeFeedFilters() {
  const list = document.getElementById("noticeList");
  if (!list) return;

  const statusEl = document.getElementById("noticeFilterStatus");
  const scopeEl = document.getElementById("noticeFilterScope");
  const metaEl = document.getElementById("noticeFeedMeta");
  const statusFilter = statusEl ? statusEl.value : "all";
  const scopeFilter = scopeEl ? scopeEl.value : "all";

  const unreadIds = new Set(getUnreadNotices(latestNoticeCache).map((n) => String(n._id)));
  const filtered = latestNoticeCache.filter((n) => {
    const id = String(n._id || "");
    if (statusFilter === "unread" && !unreadIds.has(id)) return false;
    if (statusFilter === "read" && unreadIds.has(id)) return false;

    if (scopeFilter === "all_scope" && n.scope !== "all") return false;
    if (scopeFilter === "user" && n.scope !== "user") return false;
    if (scopeFilter === "group" && n.scope !== "group") return false;
    return true;
  });

  list.innerHTML = renderNoticeListHtml(filtered, { isFeedMode: true });
  if (metaEl) {
    metaEl.textContent = `Showing ${filtered.length} of ${latestNoticeCache.length} notifications`;
  }
}

function timelineDateValue(input) {
  if (!input) return 0;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function applyTimelineFilters() {
  const list = document.getElementById("timelineList");
  if (!list) return;

  const typeEl = document.getElementById("timelineFilterType");
  const windowEl = document.getElementById("timelineFilterWindow");
  const searchEl = document.getElementById("timelineSearchInput");
  const pageSizeEl = document.getElementById("timelinePageSize");
  const metaEl = document.getElementById("timelineMeta");
  const pageMetaEl = document.getElementById("timelinePageMeta");
  const prevBtn = document.getElementById("timelinePrevBtn");
  const nextBtn = document.getElementById("timelineNextBtn");
  const typeFilter = typeEl ? typeEl.value : "all";
  const windowFilter = windowEl ? windowEl.value : "all";
  const searchQuery = String(searchEl ? searchEl.value : "").trim().toLowerCase();
  const pageSize = Math.max(1, Number(pageSizeEl ? pageSizeEl.value : 20) || 20);

  let fromMs = 0;
  if (windowFilter === "7d") fromMs = Date.now() - (7 * 24 * 60 * 60 * 1000);
  if (windowFilter === "30d") fromMs = Date.now() - (30 * 24 * 60 * 60 * 1000);
  if (windowFilter === "90d") fromMs = Date.now() - (90 * 24 * 60 * 60 * 1000);

  const filtered = studentTimelineCache.filter((item) => {
    if (typeFilter !== "all" && item.type !== typeFilter) return false;
    if (fromMs && item.ts < fromMs) return false;
    if (searchQuery) {
      const hay = `${item.title || ""} ${item.message || ""} ${item.typeLabel || ""}`.toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (timelinePageState > totalPages) timelinePageState = totalPages;
  if (timelinePageState < 1) timelinePageState = 1;
  const start = (timelinePageState - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  list.innerHTML = pageItems.length
    ? pageItems.map((item) => {
        let badgeColor = 'var(--portal-blue)';
        if (item.type === 'notice') badgeColor = 'var(--portal-teal)';
        if (item.type === 'marks') badgeColor = '#2e7d32';
        if (item.type === 'quiz') badgeColor = '#ff8f00';
        if (item.type === 'deadline') badgeColor = '#d32f2f';
        
        return `
          <li class="portal-timeline-item">
            <div class="portal-timeline-badge" style="border-color: ${badgeColor};"></div>
            <div class="portal-timeline-card">
              <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                <strong style="color: var(--portal-navy);">${escapeHtml(item.title || "-")}</strong>
                <span class="badge text-bg-light border small text-uppercase" style="letter-spacing: 0.04em;">${escapeHtml(item.typeLabel || item.type || "-")}</span>
              </div>
              <div class="text-muted small">${escapeHtml(item.message || "")}</div>
              <div class="portal-timeline-item-meta d-flex align-items-center gap-1">
                <i class="bi bi-clock-history"></i>
                <span>${item.ts ? new Date(item.ts).toLocaleString() : "-"}</span>
              </div>
            </div>
          </li>
        `;
      }).join("")
    : "<li style='padding-left: 20px;' class='text-muted'>No timeline events found for selected filters.</li>";
  if (metaEl) {
    metaEl.textContent = `Showing ${filtered.length} of ${studentTimelineCache.length} events`;
  }
  if (pageMetaEl) {
    pageMetaEl.textContent = `Page ${timelinePageState} of ${totalPages}`;
  }
  if (prevBtn) prevBtn.disabled = timelinePageState <= 1;
  if (nextBtn) nextBtn.disabled = timelinePageState >= totalPages;
}

function changeTimelinePage(delta) {
  timelinePageState += Number(delta) || 0;
  applyTimelineFilters();
}

async function loadStudentTimeline() {
  const list = document.getElementById("timelineList");
  if (!list) return;
  list.innerHTML = "<li>Loading timeline...</li>";

  try {
    const notices = studentDashboardCache.notices || await apiRequest("/notice", { headers: authHeaders() });
    const deadlines = studentDashboardCache.deadlines || await apiRequest("/files/assignment-deadlines/me", { headers: authHeaders() });
    const quizzes = studentDashboardCache.quizzes || await apiRequest("/quiz/student/list", { headers: authHeaders() });
    const marks = studentDashboardCache.marks || await apiRequest("/marks/me/list", { headers: authHeaders() });
    const attendance = studentDashboardCache.attendance || await apiRequest("/attendance/me", { headers: authHeaders() });

    const events = [];

    notices.forEach((n) => {
      events.push({
        type: "notice",
        typeLabel: "Notice",
        title: n.title || "Notice",
        message: n.message || "",
        ts: timelineDateValue(n.date)
      });
    });

    deadlines.forEach((d) => {
      events.push({
        type: "deadline",
        typeLabel: "Deadline",
        title: d.subject || "Assignment Deadline",
        message: `${d.targetCourse || "-"} Sem ${d.targetSemester || "-"} | Faculty: ${d.facultyUsername || "-"}`,
        ts: timelineDateValue(d.dueDate)
      });
    });

    quizzes.forEach((q) => {
      events.push({
        type: "quiz",
        typeLabel: "Quiz",
        title: q.title || "Quiz",
        message: q.submitted
          ? `Submitted | Marks: ${q.result?.obtainedMarks ?? 0}/${q.result?.totalMarks ?? 0}`
          : "Pending submission",
        ts: timelineDateValue(q.submittedAt || q.createdAt)
      });
    });

    marks.forEach((m) => {
      let marksTs = 0;
      const rawId = typeof m._id === "string" ? m._id : "";
      if (rawId.length >= 8) {
        const seconds = Number.parseInt(rawId.substring(0, 8), 16);
        if (Number.isFinite(seconds)) marksTs = seconds * 1000;
      }
      events.push({
        type: "marks",
        typeLabel: "Marks",
        title: m.subject || "Marks Entry",
        message: `Marks: ${m.marks ?? "-"} | ${m.course || "-"} Sem ${m.semester || "-"}`,
        ts: marksTs
      });
    });

    attendance.forEach((a) => {
      events.push({
        type: "attendance",
        typeLabel: "Attendance",
        title: a.subject || "Attendance",
        message: attendanceStatusText(a),
        ts: timelineDateValue(a.attendanceDate || a.updatedAt || a.createdAt)
      });
    });

    studentTimelineCache = events.sort((a, b) => b.ts - a.ts);
    timelinePageState = 1;
    applyTimelineFilters();
    renderCalendar();
  } catch (err) {
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, options);
  } catch (_err) {
    throw new Error("Cannot reach server. Start backend and open site from http://localhost:5000");
  }

  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : {};

  if (!response.ok) {
    let message = typeof data === "string" ? data : data.error || "";
    if (!message && response.status === 503) {
      message = "Database not connected. Start MongoDB and retry.";
    }
    if (!message) {
      message = `Request failed (${response.status})`;
    }
    throw new Error(message);
  }

  return data;
}

function requireAuth(allowedRoles = []) {
  const token = getToken();
  const role = localStorage.getItem("role");
  const effectiveRole = role === "master_admin" ? "admin" : role;
  const effectiveAllowedRoles = allowedRoles.map((r) => (r === "admin" ? ["admin", "master_admin"] : [r])).flat();
  if (!token) {
    window.location = isJustLoggedOut() ? "index.html" : "login.html";
    return false;
  }
  if (allowedRoles.length && !effectiveAllowedRoles.includes(role)) {
    window.location = effectiveRole === "admin" ? "admin-dashboard.html" : "student-dashboard.html";
    return false;
  }
  return true;
}

function isMasterAdminUser() {
  return localStorage.getItem("role") === "master_admin";
}

function isValidStudentUsernameFormat(username = "") {
  return /^\d{2}(bca|bsccs|mscit)\d{5}$/i.test(String(username).trim());
}

function deriveCourseFromUsernameClient(username = "") {
  const value = String(username).trim().toLowerCase();
  const match = value.match(/^\d{2}(bca|bsccs|mscit)\d{5}$/);
  if (!match) return "";
  if (match[1] === "bca") return "BCA";
  if (match[1] === "bsccs") return "B.Sc. CS";
  if (match[1] === "mscit") return "M.Sc. IT";
  return "";
}

function maxSemesterByCourse(course = "") {
  if (course === "M.Sc. IT") return 4;
  return 6;
}

function applyMentorSemesterLimits(courseValue = "") {
  const semEls = document.querySelectorAll(".mentor-semester-checkbox");
  if (!semEls.length) return;
  const maxAllowed = maxSemesterByCourse(courseValue);
  semEls.forEach((el) => {
    const value = Number(el.value);
    const disable = value > maxAllowed;
    el.disabled = disable;
    if (disable) el.checked = false;
  });
}

function applyStudentSemesterLimits(courseValue = "") {
  const semesterEl = document.getElementById("studentSemesterInput");
  if (!semesterEl) return;
  const maxAllowed = maxSemesterByCourse(courseValue);
  [...semesterEl.options].forEach((option) => {
    if (!option.value) return;
    option.hidden = Number(option.value) > maxAllowed;
  });
  if (semesterEl.value && Number(semesterEl.value) > maxAllowed) {
    semesterEl.value = "";
  }
}

function greetingByHour(hour) {
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

function updateStudentGreeting() {
  const titleEl = document.getElementById("studentGreetingTitle");
  const subtitleEl = document.getElementById("studentGreetingSubtitle");
  if (!titleEl || !subtitleEl) return;

  const userName = (localStorage.getItem("userName") || "Student").trim() || "Student";
  const greeting = greetingByHour(new Date().getHours());

  titleEl.textContent = `${greeting}, ${userName}`;
  subtitleEl.textContent = "Welcome back to your dashboard. Upload assignments, track files, and stay on top of lab notices.";
}

function updateAdminGreeting() {
  const titleEl = document.getElementById("adminGreetingTitle");
  const subtitleEl = document.getElementById("adminGreetingSubtitle");
  if (!titleEl || !subtitleEl) return;

  const userName = (localStorage.getItem("userName") || "Faculty").trim() || "Faculty";
  const greeting = greetingByHour(new Date().getHours());

  titleEl.textContent = `${greeting}, ${userName}`;
  subtitleEl.textContent = "Manage notices, mentoring details, uploads, and student performance in one place.";
}

function initDashboardTabContainers() {
  const containers = document.querySelectorAll("[data-tab-container]");
  if (!containers.length) return;

  containers.forEach((container) => {
    const tabPanes = [...container.querySelectorAll("[data-tab-pane]")];
    if (!tabPanes.length) return;

    const urlParams = new URLSearchParams(window.location.search);
    const initialTab = urlParams.get("tab");
    const firstTarget = initialTab || tabPanes[0].id;
    if (firstTarget) activateTabPaneDirectly(firstTarget);
  });
}

async function loadMentoringDetails() {
  const courseEl = document.getElementById("mentorCourse");
  const semEls = document.querySelectorAll(".mentor-semester-checkbox");
  if (!courseEl || !semEls.length) return;

  try {
    const user = await apiRequest("/auth/me", { headers: authHeaders() });
    const courses = Array.isArray(user.mentorCourses) ? user.mentorCourses : [];
    const semesters = Array.isArray(user.mentorSemesters) ? user.mentorSemesters.map(Number) : [];

    courseEl.value = courses[0] || "";
    applyMentorSemesterLimits(courseEl.value);
    semEls.forEach((el) => {
      const value = Number(el.value);
      if (!el.disabled) el.checked = semesters.includes(value);
    });
  } catch (_err) {
    // Keep panel usable even if profile load fails.
  }
}

async function saveMentoringDetails() {
  const courseEl = document.getElementById("mentorCourse");
  const semEls = [...document.querySelectorAll(".mentor-semester-checkbox")];
  if (!courseEl || !semEls.length) return;

  const mentorCourses = courseEl.value ? [courseEl.value] : [];
  const maxAllowed = maxSemesterByCourse(courseEl.value);
  const mentorSemesters = semEls
    .filter((el) => el.checked && Number(el.value) <= maxAllowed)
    .map((el) => Number(el.value));

  try {
    await apiRequest("/auth/me/mentoring", {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ mentorCourses, mentorSemesters })
    });
    alert("Mentoring details updated");
  } catch (err) {
    alert(err.message);
  }
}

async function loadLinkedFacultyDetails() {
  const list = document.getElementById("linkedFacultyList");
  if (!list) return;

  try {
    const linked = studentDashboardCache.faculties || await apiRequest("/auth/linked-faculty", { headers: authHeaders() });
    list.innerHTML = linked.length
      ? linked.map((f) => {
        const d = f.facultyDetails || {};
        const reasons = Array.isArray(f.reasons) && f.reasons.length ? f.reasons.join(", ") : "Linked";
        return `<li><strong>${escapeHtml(f.name || f.username)}</strong> (${escapeHtml(f.username || "")})<br><small>Role: ${escapeHtml(f.role || "-")} | Reason: ${escapeHtml(reasons)}</small><br><small>Designation: ${escapeHtml(d.designation || "-")} | Department: ${escapeHtml(d.department || "-")} | Contact: ${escapeHtml(d.contactNumber || "-")} | Cabin: ${escapeHtml(d.cabin || "-")}</small><br><small>${escapeHtml(d.about || "")}</small></li>`;
      }).join("")
      : "<li>No linked faculty found yet.</li>";
  } catch (err) {
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

function attendanceDisplayDate(entry) {
  if (entry.attendanceDate) {
    const date = new Date(entry.attendanceDate);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString();
    }
  }
  return "-";
}

function attendanceStatusText(entry) {
  const segments = [];
  if (entry.status) segments.push(`Status: ${entry.status}`);
  if (entry.percentage !== undefined && entry.percentage !== null) {
    segments.push(`Attendance: ${entry.percentage}%`);
  }
  if (
    (entry.presentClasses !== undefined && entry.presentClasses !== null)
    || (entry.totalClasses !== undefined && entry.totalClasses !== null)
  ) {
    segments.push(`Classes: ${entry.presentClasses ?? "-"} / ${entry.totalClasses ?? "-"}`);
  }
  return segments.length ? segments.join(" | ") : "No detailed metrics";
}

function attendanceNumericValue(value) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/%/g, "")
    .replace(/,/g, "");
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function setStudentAttendanceSummary(summary = {}) {
  const presentEl = document.getElementById("attendancePresentDays");
  const absentEl = document.getElementById("attendanceAbsentDays");
  const percentEl = document.getElementById("attendancePercentValue");
  const percentBar = document.getElementById("attendancePercentBar");
  const presentBar = document.getElementById("attendancePresentBar");
  const absentBar = document.getElementById("attendanceAbsentBar");

  const presentDays = Math.max(0, Number(summary.presentDays) || 0);
  const absentDays = Math.max(0, Number(summary.absentDays) || 0);
  const totalDays = presentDays + absentDays;
  const percentage = Math.max(0, Math.min(100, Number(summary.percentage) || 0));

  if (presentEl) presentEl.textContent = String(presentDays);
  if (absentEl) absentEl.textContent = String(absentDays);
  if (percentEl) percentEl.textContent = `${percentage.toFixed(2)}%`;

  if (percentBar) {
    percentBar.style.width = `${percentage}%`;
    percentBar.textContent = `${percentage.toFixed(2)}%`;
  }

  const presentShare = totalDays ? (presentDays / totalDays) * 100 : 0;
  const absentShare = totalDays ? (absentDays / totalDays) * 100 : 0;

  if (presentBar) {
    presentBar.style.width = `${presentShare}%`;
    presentBar.textContent = `Present ${presentDays}`;
  }
  if (absentBar) {
    absentBar.style.width = `${absentShare}%`;
    absentBar.textContent = `Absent ${absentDays}`;
  }
}

function summarizeAttendance(entries = []) {
  let presentByClasses = 0;
  let totalByClasses = 0;
  let hasClassTotals = false;
  let presentByStatus = 0;
  let absentByStatus = 0;

  entries.forEach((entry) => {
    const presentClasses = attendanceNumericValue(entry.presentClasses);
    const totalClasses = attendanceNumericValue(entry.totalClasses);
    if (presentClasses !== undefined || totalClasses !== undefined) {
      hasClassTotals = true;
      presentByClasses += presentClasses || 0;
      totalByClasses += totalClasses || 0;
    }

    const status = String(entry.status || "").trim().toLowerCase();
    if (status === "p" || status.includes("present")) {
      presentByStatus += 1;
    } else if (status === "a" || status.includes("absent")) {
      absentByStatus += 1;
    }
  });

  if (hasClassTotals && totalByClasses > 0) {
    const presentDays = Math.max(0, Math.round(presentByClasses));
    const totalDays = Math.max(0, Math.round(totalByClasses));
    const absentDays = Math.max(0, totalDays - presentDays);
    const percentage = totalDays ? (presentDays / totalDays) * 100 : 0;
    return { presentDays, absentDays, percentage };
  }

  const totalByStatus = presentByStatus + absentByStatus;
  if (totalByStatus > 0) {
    return {
      presentDays: presentByStatus,
      absentDays: absentByStatus,
      percentage: (presentByStatus / totalByStatus) * 100
    };
  }

  const firstPercentage = attendanceNumericValue(entries[0]?.percentage);
  return {
    presentDays: 0,
    absentDays: 0,
    percentage: firstPercentage !== undefined ? firstPercentage : 0
  };
}

let studentQuizState = {
  quizId: "",
  title: "",
  description: "",
  questions: [],
  answers: [],
  currentIndex: 0,
  submitted: false
};
let adminDraftQuizQuestions = [];

function onQuizQuestionTypeChange() {
  const typeEl = document.getElementById("quizQuestionTypeInput");
  const objectiveFields = document.getElementById("quizObjectiveFields");
  const subjectiveAnswerEl = document.getElementById("quizSubjectiveAnswerInput");
  if (!typeEl || !objectiveFields || !subjectiveAnswerEl) return;

  const isObjective = typeEl.value === "objective";
  objectiveFields.classList.toggle("d-none", !isObjective);
  subjectiveAnswerEl.classList.toggle("d-none", isObjective);
}

function parseQuizTextToPairs(rawText = "") {
  const lines = String(rawText || "").replace(/\r/g, "").split("\n");
  const pairs = [];

  let question = "";
  let answer = "";
  let mode = "";

  const pushPair = () => {
    const q = question.trim();
    const a = answer.trim();
    if (q && a) pairs.push({ question: q, answer: a });
    question = "";
    answer = "";
    mode = "";
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (mode === "question") question += "\n";
      if (mode === "answer") answer += "\n";
      return;
    }

    const qMatch = trimmed.match(/^(?:q(?:uestion)?\s*\d*[:.)-]?|\d+[.)])\s*(.+)$/i);
    if (qMatch) {
      if (question || answer) pushPair();
      question = qMatch[1].trim();
      mode = "question";
      return;
    }

    const aMatch = trimmed.match(/^(?:a(?:nswer)?\s*[:.)-]?)\s*(.+)$/i);
    if (aMatch) {
      answer = aMatch[1].trim();
      mode = "answer";
      return;
    }

    if (mode === "answer") answer += `\n${trimmed}`;
    else if (mode === "question") question += `\n${trimmed}`;
  });

  if (question || answer) pushPair();
  return pairs;
}

function extractObjectiveOptionsFromQuestionText(questionText = "") {
  const text = String(questionText || "").replace(/\r/g, "");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const byLine = [];
  lines.forEach((line) => {
    const match = line.match(/^([A-D])[\).:-]\s*(.+)$/i);
    if (match) {
      byLine.push({ key: match[1].toUpperCase(), value: match[2].trim() });
    }
  });
  if (byLine.length >= 4) {
    const map = new Map(byLine.map((x) => [x.key, x.value]));
    if (map.has("A") && map.has("B") && map.has("C") && map.has("D")) {
      return [map.get("A"), map.get("B"), map.get("C"), map.get("D")];
    }
  }
  return [];
}

function getObjectiveOptions(question = {}) {
  const direct = Array.isArray(question.options)
    ? question.options.map((o) => String(o || "").trim()).filter(Boolean).slice(0, 4)
    : [];
  if (direct.length === 4) return direct;
  return extractObjectiveOptionsFromQuestionText(question.question || "");
}

function isObjectiveQuizQuestion(question = {}) {
  const type = String(question.type || "").trim().toLowerCase();
  const options = getObjectiveOptions(question);
  const correct = String(question.correctOption || question.answer || "").trim().toUpperCase();
  return type === "objective" || options.length === 4 || ["A", "B", "C", "D"].includes(correct);
}

function renderDraftQuizQuestions() {
  const list = document.getElementById("adminDraftQuizQuestionList");
  if (!list) return;

  list.innerHTML = adminDraftQuizQuestions.length
    ? adminDraftQuizQuestions.map((q, index) => {
      if (q.type === "objective") {
        const options = (q.options || []).map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join(" | ");
        return `<li><strong>Q${index + 1} [Objective]</strong>: ${escapeHtml(q.question)}<br><small>${escapeHtml(options)} | Correct: ${escapeHtml(q.correctOption || "")}</small></li>`;
      }
      return `<li><strong>Q${index + 1} [Subjective]</strong>: ${escapeHtml(q.question)}<br><small>Answer: ${escapeHtml(q.answer || "")}</small></li>`;
    }).join("")
    : "<li>No manually added questions yet.</li>";
}

function addDraftQuizQuestion() {
  const questionEl = document.getElementById("quizQuestionInput");
  const typeEl = document.getElementById("quizQuestionTypeInput");
  const subjectiveAnswerEl = document.getElementById("quizSubjectiveAnswerInput");
  const optionAEl = document.getElementById("quizOptionAInput");
  const optionBEl = document.getElementById("quizOptionBInput");
  const optionCEl = document.getElementById("quizOptionCInput");
  const optionDEl = document.getElementById("quizOptionDInput");
  const correctEl = document.getElementById("quizCorrectOptionInput");
  if (!questionEl || !typeEl || !subjectiveAnswerEl || !optionAEl || !optionBEl || !optionCEl || !optionDEl || !correctEl) return;

  const question = questionEl.value.trim();
  const type = typeEl.value === "objective" ? "objective" : "subjective";
  if (!question) {
    alert("Question is required");
    return;
  }

  if (type === "objective") {
    const options = [optionAEl.value.trim(), optionBEl.value.trim(), optionCEl.value.trim(), optionDEl.value.trim()];
    if (options.some((opt) => !opt)) {
      alert("All objective options A/B/C/D are required");
      return;
    }
    adminDraftQuizQuestions.push({
      question,
      type: "objective",
      options,
      correctOption: correctEl.value
    });
    optionAEl.value = "";
    optionBEl.value = "";
    optionCEl.value = "";
    optionDEl.value = "";
    correctEl.value = "A";
  } else {
    const answer = subjectiveAnswerEl.value.trim();
    if (!answer) {
      alert("Subjective answer is required");
      return;
    }
    adminDraftQuizQuestions.push({
      question,
      type: "subjective",
      answer
    });
    subjectiveAnswerEl.value = "";
  }

  questionEl.value = "";
  renderDraftQuizQuestions();
}

function clearDraftQuizQuestions() {
  adminDraftQuizQuestions = [];
  renderDraftQuizQuestions();
}

async function createQuizFromText() {
  const titleEl = document.getElementById("quizTitleInput");
  const descriptionEl = document.getElementById("quizDescriptionInput");
  const textEl = document.getElementById("quizTextInput");
  const marksPerQuestionEl = document.getElementById("quizMarksPerQuestionInput");
  const passingMarksEl = document.getElementById("quizPassingMarksInput");
  if (!titleEl || !descriptionEl || !textEl) return;

  const title = titleEl.value.trim();
  const description = descriptionEl.value.trim();
  const marksPerQuestion = Number(marksPerQuestionEl?.value) || 1;
  const passingMarks = Number(passingMarksEl?.value) || 0;
  const textQuestions = parseQuizTextToPairs(textEl.value).map((q) => ({
    question: q.question,
    type: "subjective",
    answer: q.answer
  }));
  const questions = [...adminDraftQuizQuestions, ...textQuestions];

  if (!title) {
    alert("Quiz title is required");
    return;
  }
  if (!questions.length) {
    alert("Add questions or use Q: and A: format.");
    return;
  }

  try {
    await apiRequest("/quiz/admin/create", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ title, description, questions, marksPerQuestion, passingMarks })
    });
    textEl.value = "";
    marksPerQuestionEl.value = "";
    passingMarksEl.value = "";
    clearDraftQuizQuestions();
    alert("Quiz created");
    await loadAdminQuizzes();
  } catch (err) {
    alert(err.message);
  }
}

async function importQuizFromFile() {
  const titleEl = document.getElementById("quizTitleInput");
  const descriptionEl = document.getElementById("quizDescriptionInput");
  const fileEl = document.getElementById("quizImportFile");
  const marksPerQuestionEl = document.getElementById("quizMarksPerQuestionInput");
  const passingMarksEl = document.getElementById("quizPassingMarksInput");
  if (!titleEl || !descriptionEl || !fileEl) return;

  const title = titleEl.value.trim();
  const description = descriptionEl.value.trim();
  const marksPerQuestion = Number(marksPerQuestionEl?.value) || 1;
  const passingMarks = Number(passingMarksEl?.value) || 0;
  const file = fileEl.files[0];
  if (!title) {
    alert("Quiz title is required");
    return;
  }
  if (!file) {
    alert("Please choose PDF, DOCX, or TXT file");
    return;
  }

  const formData = new FormData();
  formData.append("title", title);
  formData.append("description", description);
  formData.append("marksPerQuestion", marksPerQuestion);
  formData.append("passingMarks", passingMarks);
  formData.append("file", file);

  try {
    const response = await fetch(`${API}/quiz/admin/import-file`, {
      method: "POST",
      headers: authHeaders(),
      body: formData
    });

    const text = await response.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : {};
    if (!response.ok) {
      throw new Error(typeof data === "string" ? data : data.error || `Request failed (${response.status})`);
    }

    fileEl.value = "";
    marksPerQuestionEl.value = "";
    passingMarksEl.value = "";
    alert(`Quiz imported with ${data.parsedQuestions || 0} questions`);
    await loadAdminQuizzes();
  } catch (err) {
    alert(err.message);
  }
}

async function loadAdminQuizzes() {
  const list = document.getElementById("adminQuizList");
  if (!list) return;

  try {
    const quizzes = await apiRequest("/quiz/admin/list", { headers: authHeaders() });
    list.innerHTML = quizzes.length
      ? quizzes.map((quiz) => {
        const statusButton = quiz.isActive
          ? `<button class="btn btn-sm btn-outline-danger" onclick="setQuizStatus('${quiz.id}', false)">Deactivate</button>`
          : `<button class="btn btn-sm btn-outline-success" onclick="setQuizStatus('${quiz.id}', true)">Activate</button>`;
        const deleteButton = `<button class="btn btn-sm btn-danger ms-2" onclick="deleteQuiz('${quiz.id}')">Delete</button>`;
        const resultsButton = `<button class="btn btn-sm btn-info ms-2" onclick="viewQuizResults('${quiz.id || ''}')">View Results</button>`;
        return `<li><strong>${escapeHtml(quiz.title)}</strong> (${quiz.totalQuestions} questions) | Attempts: ${quiz.totalAttempts} | Submitted: ${quiz.submittedAttempts}<br><small>${escapeHtml(quiz.description || "")}</small><div class="mt-2">${statusButton}${deleteButton}${resultsButton}</div></li>`;
      }).join("")
      : "<li>No quizzes created yet</li>";
  } catch (err) {
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

async function deleteQuiz(quizId) {
  if (!confirm("Delete this quiz and all student attempts?")) return;
  try {
    await apiRequest(`/quiz/admin/${quizId}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    await loadAdminQuizzes();
  } catch (err) {
    alert(err.message);
  }
}

async function setQuizStatus(quizId, isActive) {
  try {
    await apiRequest(`/quiz/admin/${quizId}/status`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ isActive })
    });
    await loadAdminQuizzes();
  } catch (err) {
    alert(err.message);
  }
}

async function viewQuizResults(quizId) {
  if (!quizId) {
    alert('Quiz ID is missing');
    return;
  }
  try {
    const data = await apiRequest(`/quiz/admin/${quizId}/results`, { headers: authHeaders() });
    
    // Hide quiz list and show results
    document.getElementById('adminQuizList').classList.add('d-none');
    document.getElementById('adminQuizResultsPane').classList.remove('d-none');
    
    // Update header
    const header = document.getElementById('quizResultsHeader');
    header.innerHTML = `
      <h5>${escapeHtml(data.quiz.title)}</h5>
      <p class="mb-1">${escapeHtml(data.quiz.description || '')}</p>
      <small class="text-muted">Passing Marks: ${data.quiz.passingMarks} | Total Marks: ${data.quiz.totalMarks}</small>
    `;
    
    // Update results table
    const tbody = document.getElementById('quizResultsTableBody');
    if (data.results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No submissions yet</td></tr>';
    } else {
      tbody.innerHTML = data.results.map(result => `
        <tr>
          <td><a href="#" onclick="viewStudentDetails('${result.studentId}', '${escapeHtml(result.studentName)}')" class="text-decoration-none">${escapeHtml(result.studentName)}</a></td>
          <td><a href="#" onclick="viewStudentDetails('${result.studentId}', '${escapeHtml(result.studentEmail)}')" class="text-decoration-none">${escapeHtml(result.studentEmail)}</a></td>
          <td>${escapeHtml(result.course)}</td>
          <td>${result.semester || 'N/A'}</td>
          <td>${result.obtainedMarks}/${result.totalMarks}</td>
          <td>${result.score}/${result.totalQuestions}</td>
          <td>
            <span class="badge ${result.isPassed ? 'text-bg-success' : 'text-bg-danger'}">
              ${result.isPassed ? 'PASS' : 'FAIL'}
            </span>
          </td>
          <td>${new Date(result.submittedAt).toLocaleString()}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    alert('Failed to load quiz results: ' + err.message);
  }
}

function showQuizManager() {
  document.getElementById('adminQuizList').classList.remove('d-none');
  document.getElementById('adminQuizResultsPane').classList.add('d-none');
  document.getElementById('adminStudentDetailsPane').classList.add('d-none');
}

async function viewStudentDetails(studentId, studentName) {
  console.log('viewStudentDetails called with:', studentId, studentName);
  try {
    console.log('Making API request to:', `/quiz/admin/student/${studentId}/details`);
    const data = await apiRequest(`/quiz/admin/student/${studentId}/details`, { headers: authHeaders() });
    console.log('API response received:', data);
    
    // Hide results and show student details
    document.getElementById('adminQuizResultsPane').classList.add('d-none');
    document.getElementById('adminStudentDetailsPane').classList.remove('d-none');
    
    // Update student info
    const studentInfo = document.getElementById('studentDetailsInfo');
    const student = data.student;
    studentInfo.innerHTML = `
      <h5>${escapeHtml(student.name)}</h5>
      <p class="mb-1"><strong>Email:</strong> ${escapeHtml(student.email)}</p>
      <p class="mb-1"><strong>Course:</strong> ${escapeHtml(student.course || 'N/A')}</p>
      <p class="mb-1"><strong>Semester:</strong> ${student.semester || 'N/A'}</p>
      <p class="mb-1"><strong>Role:</strong> ${escapeHtml(student.role)}</p>
    `;
    
    // Update quiz attempts
    const attemptsContainer = document.getElementById('studentQuizAttempts');
    if (data.quizAttempts.length === 0) {
      attemptsContainer.innerHTML = '<p class="text-muted">No quiz attempts found.</p>';
    } else {
      attemptsContainer.innerHTML = data.quizAttempts.map((attempt, index) => `
        <div class="card mb-3">
          <div class="card-header">
            <h6 class="mb-0">${escapeHtml(attempt.quizTitle)}</h6>
            <small class="text-muted">${escapeHtml(attempt.quizDescription || '')}</small>
          </div>
          <div class="card-body">
            <div class="row mb-2">
              <div class="col-md-3"><strong>Submitted:</strong> ${new Date(attempt.submittedAt).toLocaleString()}</div>
              <div class="col-md-3"><strong>Score:</strong> ${attempt.score}/${attempt.totalQuestions}</div>
              <div class="col-md-3"><strong>Marks:</strong> ${attempt.obtainedMarks}/${attempt.totalMarks}</div>
              <div class="col-md-3">
                <span class="badge ${attempt.isPassed ? 'text-bg-success' : 'text-bg-danger'}">
                  ${attempt.isPassed ? 'PASS' : 'FAIL'} (${attempt.passingMarks} required)
                </span>
              </div>
            </div>
            
            <details class="mb-2">
              <summary class="btn btn-sm btn-outline-primary">View Question Details</summary>
              <div class="mt-3">
                ${attempt.questionDetails.map(q => `
                  <div class="border rounded p-2 mb-2 ${q.isCorrect ? 'bg-light-success' : 'bg-light-danger'}">
                    <div class="d-flex justify-content-between align-items-start">
                      <div class="flex-grow-1">
                        <strong>Q${q.questionNumber}:</strong> ${escapeHtml(q.question)}
                        ${q.type === 'objective' && q.options ? `
                          <div class="mt-1">
                            <small class="text-muted">Options: ${q.options.map((opt, i) => `${String.fromCharCode(65+i)}. ${opt}`).join(', ')}</small>
                          </div>
                        ` : ''}
                        <div class="mt-1">
                          <small>
                            <strong>Correct Answer:</strong> ${q.type === 'objective' ? `Option ${q.correctAnswer}` : escapeHtml(q.correctAnswer || 'N/A')}<br>
                            <strong>Your Answer:</strong> ${escapeHtml(q.studentAnswer || 'Not answered')}<br>
                            <strong>Status:</strong> <span class="${q.isCorrect ? 'text-success' : 'text-danger'}">${q.isCorrect ? 'Correct' : 'Incorrect'}</span> 
                            (${q.marks} marks)
                          </small>
                        </div>
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </details>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    alert('Failed to load student details: ' + err.message);
  }
}

function saveCurrentQuizAnswerToState() {
  const currentQuestion = studentQuizState.questions[studentQuizState.currentIndex] || {};
  if (isObjectiveQuizQuestion(currentQuestion)) {
    const selected = document.querySelector('input[name="studentQuizOption"]:checked');
    studentQuizState.answers[studentQuizState.currentIndex] = selected ? selected.value : "";
    return;
  }
  const answerEl = document.getElementById("studentQuizAnswerInput");
  if (!answerEl || !studentQuizState.questions.length) return;
  studentQuizState.answers[studentQuizState.currentIndex] = answerEl.value;
}

async function saveCurrentQuizAnswerToServer() {
  if (!studentQuizState.quizId || studentQuizState.submitted) return;
  try {
    await apiRequest(`/quiz/student/${studentQuizState.quizId}/answer`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        questionIndex: studentQuizState.currentIndex,
        answer: studentQuizState.answers[studentQuizState.currentIndex] || ""
      })
    });
  } catch (_err) {
    // Keep local progress even if autosave fails.
  }
}

function renderStudentQuizReview() {
  const review = document.getElementById("studentQuizReviewList");
  if (!review || !studentQuizState.questions.length) return;

  review.innerHTML = studentQuizState.questions.map((_q, index) => {
    const answered = Boolean((studentQuizState.answers[index] || "").trim());
    const isCurrent = index === studentQuizState.currentIndex;
    const cls = isCurrent ? "btn-primary" : (answered ? "btn-success" : "btn-outline-secondary");
    return `<button class="btn btn-sm ${cls}" onclick="goToQuizQuestion(${index})">Q${index + 1}</button>`;
  }).join("");
}

function renderStudentQuizQuestion() {
  const card = document.getElementById("studentQuizAttemptCard");
  const title = document.getElementById("studentQuizTitle");
  const description = document.getElementById("studentQuizDescription");
  const progress = document.getElementById("studentQuizProgressText");
  const questionText = document.getElementById("studentQuizQuestionText");
  const objectiveOptionsEl = document.getElementById("studentQuizObjectiveOptions");
  const answerInput = document.getElementById("studentQuizAnswerInput");
  if (!card || !title || !description || !progress || !questionText || !answerInput || !objectiveOptionsEl) return;

  if (!studentQuizState.quizId || !studentQuizState.questions.length) {
    card.classList.add("d-none");
    return;
  }

  card.classList.remove("d-none");
  title.textContent = studentQuizState.title || "Quiz";
  description.textContent = studentQuizState.description || "";

  const total = studentQuizState.questions.length;
  const answeredCount = studentQuizState.answers.filter((a) => String(a || "").trim()).length;
  const currentIndex = studentQuizState.currentIndex;
  const currentQuestion = studentQuizState.questions[currentIndex] || {};

  progress.textContent = `Question ${currentIndex + 1} of ${total} | Answered ${answeredCount}/${total}`;
  questionText.textContent = currentQuestion.question || "";

  if (isObjectiveQuizQuestion(currentQuestion)) {
    answerInput.classList.add("d-none");
    objectiveOptionsEl.classList.remove("d-none");
    const selected = String(studentQuizState.answers[currentIndex] || "").toUpperCase();
    const options = getObjectiveOptions(currentQuestion);
    objectiveOptionsEl.innerHTML = options.map((opt, i) => {
      const key = String.fromCharCode(65 + i);
      const checked = selected === key ? "checked" : "";
      const disabled = studentQuizState.submitted ? "disabled" : "";
      return `<label class="d-block border rounded px-2 py-1 mb-1"><input type="radio" name="studentQuizOption" value="${key}" ${checked} ${disabled}> <strong>${key}.</strong> ${escapeHtml(opt)}</label>`;
    }).join("");
    if (!studentQuizState.submitted) {
      const radios = objectiveOptionsEl.querySelectorAll('input[name="studentQuizOption"]');
      radios.forEach((radio) => {
        radio.addEventListener("change", () => {
          saveCurrentQuizAnswerToState();
          renderStudentQuizReview();
        });
      });
    }
  } else {
    objectiveOptionsEl.classList.add("d-none");
    objectiveOptionsEl.innerHTML = "";
    answerInput.classList.remove("d-none");
    answerInput.value = studentQuizState.answers[currentIndex] || "";
    answerInput.disabled = studentQuizState.submitted;
  }

  renderStudentQuizReview();
}

async function goToQuizQuestion(index) {
  if (!studentQuizState.questions.length) return;
  saveCurrentQuizAnswerToState();
  await saveCurrentQuizAnswerToServer();
  studentQuizState.currentIndex = Math.max(0, Math.min(index, studentQuizState.questions.length - 1));
  renderStudentQuizQuestion();
}

async function goToFirstQuizQuestion() {
  await goToQuizQuestion(0);
}

async function goToPreviousQuizQuestion() {
  await goToQuizQuestion(studentQuizState.currentIndex - 1);
}

async function goToNextQuizQuestion() {
  await goToQuizQuestion(studentQuizState.currentIndex + 1);
}

async function goToLastQuizQuestion() {
  await goToQuizQuestion(studentQuizState.questions.length - 1);
}

async function startQuizAttempt(quizId) {
  try {
    const data = await apiRequest(`/quiz/student/${quizId}`, { headers: authHeaders() });
    const questions = Array.isArray(data.quiz?.questions) ? data.quiz.questions : [];
    const answers = Array.isArray(data.attempt?.answers) ? data.attempt.answers : [];

    studentQuizState = {
      quizId: data.quiz?.id || "",
      title: data.quiz?.title || "Quiz",
      description: data.quiz?.description || "",
      questions,
      answers: Array.from({ length: questions.length }, (_, i) => answers[i] || ""),
      currentIndex: 0,
      submitted: Boolean(data.attempt?.submitted)
    };

    renderStudentQuizQuestion();
    if (studentQuizState.submitted) {
      alert("This quiz is already submitted. Answers are read-only.");
    }
  } catch (err) {
    alert(err.message);
  }
}

async function submitStudentQuiz() {
  if (!studentQuizState.quizId || !studentQuizState.questions.length) return;
  if (studentQuizState.submitted) {
    alert("Quiz already submitted");
    return;
  }

  saveCurrentQuizAnswerToState();
  const confirmSubmit = confirm("Submit quiz now? You cannot edit answers after submission.");
  if (!confirmSubmit) return;

  try {
    const data = await apiRequest(`/quiz/student/${studentQuizState.quizId}/submit`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ answers: studentQuizState.answers })
    });

    studentQuizState.submitted = true;
    renderStudentQuizQuestion();
    const result = data.result || {};
    const passStatus = result.isPassed ? "✅ PASS" : "❌ FAIL";
    alert(`Quiz submitted!\n\nMarks: ${result.obtainedMarks ?? 0} out of ${result.totalMarks ?? studentQuizState.questions.length}\nCorrect Answers: ${result.score ?? 0}/${result.totalQuestions ?? studentQuizState.questions.length}\nStatus: ${passStatus}`);
    await loadStudentQuizzes();
  } catch (err) {
    alert(err.message);
  }
}

async function loadStudentQuizzes() {
  const list = document.getElementById("studentQuizList");
  if (!list) return;

  try {
    const quizzes = studentDashboardCache.quizzes || await apiRequest("/quiz/student/list", { headers: authHeaders() });
    list.innerHTML = quizzes.length
      ? quizzes.map((quiz) => {
        let action = '';
        if (quiz.submitted && quiz.result) {
          const passStatus = quiz.result.isPassed ? '✅ PASS' : '❌ FAIL';
          action = `<div class="mt-2">
            <span class="badge text-bg-success">Submitted</span>
            <small class="text-muted ms-2">
              Marks: ${quiz.result.obtainedMarks}/${quiz.result.totalMarks} | 
              Correct: ${quiz.result.score}/${quiz.result.totalQuestions} | 
              Status: ${passStatus}
            </small>
          </div>`;
        } else if (quiz.submitted) {
          action = '<span class="badge text-bg-success">Submitted</span>';
        } else {
          action = `<button class="btn btn-sm btn-primary" onclick="startQuizAttempt('${quiz.id}')">Attempt Quiz</button>`;
        }
        return `<li><strong>${escapeHtml(quiz.title)}</strong> (${quiz.totalQuestions} questions)<br><small>${escapeHtml(quiz.description || "")}</small>${action}</li>`;
      }).join("")
      : "<li>No active quizzes available</li>";
  } catch (err) {
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

async function importAttendanceFromSheet() {
  const sheetUrlEl = document.getElementById("attendanceSheetUrl");
  if (!sheetUrlEl) return;

  const sheetUrl = sheetUrlEl.value.trim();
  if (!sheetUrl) {
    alert("Please enter Google Sheet URL");
    return;
  }

  try {
    const result = await apiRequest("/attendance/import-google-sheet", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ sheetUrl })
    });

    const importedRows = Number(result.importedRows || 0);
    const skippedRows = Array.isArray(result.skippedRows) ? result.skippedRows.length : 0;
    alert(`Attendance imported. Imported: ${importedRows}, Skipped: ${skippedRows}`);
    adminDashboardCache.attendance = null;
    studentDashboardCache.attendance = null;
    await loadAdminAttendance();
  } catch (err) {
    alert(err.message);
  }
}

async function loadAdminAttendance() {
  const list = document.getElementById("adminAttendanceList");
  if (!list) return;

  try {
    const entries = adminDashboardCache.attendance || await apiRequest("/attendance/admin/list", { headers: authHeaders() });
    list.innerHTML = entries.length
      ? entries.map((entry) => {
        const line1 = `<strong>${escapeHtml(entry.studentUsername || entry.studentId || "-")}</strong> | ${escapeHtml(entry.subject || "-")} | Date: ${escapeHtml(attendanceDisplayDate(entry))}`;
        const line2 = escapeHtml(attendanceStatusText(entry));
        const note = entry.remarks ? `<br><small>${escapeHtml(entry.remarks)}</small>` : "";
        return `<li>${line1}<br><small>${line2}</small>${note}</li>`;
      }).join("")
      : "<li>No attendance records imported yet</li>";
  } catch (err) {
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

async function loadStudentAttendance() {
  const list = document.getElementById("studentAttendanceList");
  if (!list) return;

  try {
    const entries = studentDashboardCache.attendance || await apiRequest("/attendance/me", { headers: authHeaders() });
    setStudentAttendanceSummary(summarizeAttendance(entries));
    list.innerHTML = entries.length
      ? entries.map((entry) => {
        const subject = escapeHtml(entry.subject || "-");
        const date = escapeHtml(attendanceDisplayDate(entry));
        const status = escapeHtml(attendanceStatusText(entry));
        const note = entry.remarks ? `<br><small>${escapeHtml(entry.remarks)}</small>` : "";
        return `<li><strong>${subject}</strong> | Date: ${date}<br><small>${status}</small>${note}</li>`;
      }).join("")
      : "<li>No attendance records available yet</li>";
  } catch (err) {
    setStudentAttendanceSummary({ presentDays: 0, absentDays: 0, percentage: 0 });
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

async function loadStudentActionCenter() {
  const summaryEl = document.getElementById("studentActionCenterSummary");
  const listEl = document.getElementById("studentActionCenterList");
  if (!summaryEl || !listEl) return;

  summaryEl.textContent = "Loading your priorities...";
  listEl.innerHTML = "<li>Preparing action items...</li>";

  try {
    const attendanceEntries = studentDashboardCache.attendance || await apiRequest("/attendance/me", { headers: authHeaders() });
    const quizzes = studentDashboardCache.quizzes || await apiRequest("/quiz/student/list", { headers: authHeaders() });
    const files = studentDashboardCache.files || await apiRequest("/files", { headers: authHeaders() });
    const deadlines = studentDashboardCache.deadlines || await apiRequest("/files/assignment-deadlines/me", { headers: authHeaders() });

    const attendanceSummary = summarizeAttendance(attendanceEntries);
    const attendancePct = Number(attendanceSummary.percentage || 0);
    const pendingQuizzes = quizzes.filter((q) => !q.submitted).length;
    const uploadedAssignments = files.filter((f) => f.fileType === "assignment").length;
    const unreadNotices = getUnreadNotices(latestNoticeCache).length;
    const pendingDeadlines = deadlines.filter((d) => {
      if (!d.dueDate) return false;
      return new Date(d.dueDate).getTime() >= Date.now();
    }).length;

    const uploadsStatEl = document.getElementById("studentStatUploads");
    const quizStatEl = document.getElementById("studentStatQuizzes");
    const noticeStatEl = document.getElementById("studentStatNotices");
    if (uploadsStatEl) uploadsStatEl.textContent = String(uploadedAssignments);
    if (quizStatEl) quizStatEl.textContent = String(pendingQuizzes);
    if (noticeStatEl) noticeStatEl.textContent = String(unreadNotices);

    const actions = [];
    if (attendancePct < 75) {
      actions.push(`<span class="portal-action-alert">Attendance is ${attendancePct.toFixed(2)}%. Reach at least 75% to stay safe.</span>`);
    } else {
      actions.push(`Attendance is ${attendancePct.toFixed(2)}%. Keep consistency.`);
    }

    if (pendingQuizzes > 0) {
      actions.push(`${pendingQuizzes} pending quiz${pendingQuizzes === 1 ? "" : "zes"}: open "Take Quiz" and submit.`);
    }

    if (unreadNotices > 0) {
      actions.push(`${unreadNotices} unread notice${unreadNotices === 1 ? "" : "s"}: open notifications and review.`);
    }
    if (pendingDeadlines > 0) {
      actions.push(`${pendingDeadlines} active assignment deadline${pendingDeadlines === 1 ? "" : "s"} are scheduled for your class.`);
    }

    if (actions.length === 1 && pendingQuizzes === 0 && unreadNotices === 0 && attendancePct >= 75) {
      actions.push("No urgent actions right now. Keep uploads and quiz practice regular.");
    }

    summaryEl.textContent = "Your high-priority tasks are generated from attendance, quizzes, and notices.";
    listEl.innerHTML = actions.map((a) => `<li>${a}</li>`).join("");
  } catch (err) {
    summaryEl.textContent = "Could not build Action Center right now.";
    listEl.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

function onNoticeScopeChange() {
  const scopeEl = document.getElementById("noticeScope");
  const usernamesEl = document.getElementById("targetUsernames");
  const groupEl = document.getElementById("noticeGroupFilters");
  const courseEl = document.getElementById("targetCourse");
  const semesterEl = document.getElementById("targetSemester");
  if (!scopeEl || !usernamesEl || !groupEl) return;

  const scope = scopeEl.value;
  usernamesEl.classList.toggle("d-none", scope !== "user");
  groupEl.classList.toggle("d-none", scope !== "group");

  if (courseEl && semesterEl) {
    const maxAllowed = maxSemesterByCourse(courseEl.value);
    [...semesterEl.options].forEach((option) => {
      if (!option.value) return;
      option.hidden = Number(option.value) > maxAllowed;
    });
    if (semesterEl.value && Number(semesterEl.value) > maxAllowed) {
      semesterEl.value = "";
    }
  }
}

function onRegisterUsernameChange() {
  const usernameEl = document.getElementById("username") || document.getElementById("email");
  const courseEl = document.getElementById("registerCourse");
  const semesterEl = document.getElementById("registerSemester");
  if (!usernameEl || !courseEl || !semesterEl) return;

  const course = deriveCourseFromUsernameClient(usernameEl.value.trim().toLowerCase());
  courseEl.value = course || "";

  const maxAllowed = maxSemesterByCourse(course);
  [...semesterEl.options].forEach((option) => {
    if (!option.value) return;
    option.hidden = Number(option.value) > maxAllowed;
  });
  if (semesterEl.value && Number(semesterEl.value) > maxAllowed) {
    semesterEl.value = "";
  }
}

async function register() {
  const nameEl = document.getElementById("name");
  const usernameEl = document.getElementById("username") || document.getElementById("email");
  const passwordEl = document.getElementById("password");
  const semesterEl = document.getElementById("registerSemester");
  const courseEl = document.getElementById("registerCourse");

  try {
    if (!nameEl || !usernameEl || !passwordEl || !semesterEl || !courseEl) {
      throw new Error("Registration form is missing required fields");
    }

    const normalizedUsername = usernameEl.value.trim().toLowerCase();
    if (!isValidStudentUsernameFormat(normalizedUsername)) {
      throw new Error("Username format invalid. Use 21bca56051, 22bsccs55005, or 23mscit56012.");
    }
    const course = deriveCourseFromUsernameClient(normalizedUsername);
    const semester = Number(semesterEl.value);
    if (!Number.isInteger(semester)) {
      throw new Error("Please select semester");
    }
    const maxAllowed = maxSemesterByCourse(course);
    if (semester < 1 || semester > maxAllowed) {
      throw new Error(`For ${course || "student course"}, semester must be between 1 and ${maxAllowed}.`);
    }

    await apiRequest("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nameEl.value.trim(),
        username: normalizedUsername,
        email: normalizedUsername,
        password: passwordEl.value,
        semester
      })
    });
    alert("Registered successfully");
    window.location = "login.html";
  } catch (err) {
    alert(err.message);
  }
}

async function login() {
  const usernameEl = document.getElementById("username") || document.getElementById("email");
  const passwordEl = document.getElementById("password");

  try {
    if (!usernameEl || !passwordEl) {
      throw new Error("Login form is missing username or password field");
    }

    const data = await apiRequest("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameEl.value.trim(),
        email: usernameEl.value.trim(),
        password: passwordEl.value
      })
    });

    localStorage.setItem("token", data.token);
    localStorage.setItem("role", data.role);
    localStorage.setItem("userId", data.user.id);
    localStorage.setItem("userName", data.user.name);
    localStorage.setItem("userEmail", data.user.email || data.user.username || "");
    localStorage.removeItem("justLoggedOut");

    const isAdminRole = data.role === "admin" || data.role === "master_admin";
    window.location = isAdminRole ? "admin-dashboard.html" : "student-dashboard.html";
  } catch (err) {
    alert(err.message);
  }
}

function forgotPasswordInfo() {
  alert("If you are a student and forgot your password, please go to Lab 1 and meet the lab assistant for password reset.");
}

function logout() {
  localStorage.clear();
  localStorage.setItem("justLoggedOut", "1");
  window.location.replace("index.html");
}

async function uploadFile() {
  const fileInput = document.getElementById("file");
  const subjectEl = document.getElementById("assignmentSubject");
  const subjectFacultyEl = document.getElementById("subjectFacultyUsername");
  if (!fileInput.files.length) {
    alert("Please choose a file");
    return;
  }

  const subject = subjectEl ? subjectEl.value.trim() : "";
  const subjectFacultyUsername = subjectFacultyEl ? subjectFacultyEl.value.trim().toLowerCase() : "";
  if (!subject || !subjectFacultyUsername) {
    alert("Subject and Subject Faculty Username are required for assignment upload.");
    return;
  }

  const formData = new FormData();
  for (let i = 0; i < fileInput.files.length; i++) {
    formData.append("file", fileInput.files[i]);
  }
  formData.append("fileType", "assignment");
  formData.append("subject", subject);
  formData.append("subjectFacultyUsername", subjectFacultyUsername);

  try {
    const uploaded = await apiRequest("/files/upload", {
      method: "POST",
      headers: authHeaders(),
      body: formData
    });
    fileInput.value = "";
    if (subjectEl) subjectEl.value = "";
    if (subjectFacultyEl) subjectFacultyEl.value = "";
    studentDashboardCache.files = null;
    studentDashboardCache.deadlines = null;
    await Promise.all([loadFiles(), loadStudentAssignmentDeadlines()]);
    const wasLate = Boolean(uploaded?.file?.lateSubmission);
    const count = uploaded?.files?.length || 1;
    alert(wasLate ? `${count} file(s) uploaded. Submission marked as late.` : `${count} file(s) uploaded.`);
  } catch (err) {
    alert(err.message);
  }
}

async function uploadForStudents() {
  const fileInput = document.getElementById("adminFile");
  if (!fileInput || !fileInput.files.length) {
    alert("Please choose a document");
    return;
  }

  const formData = new FormData();
  for (let i = 0; i < fileInput.files.length; i++) {
    formData.append("file", fileInput.files[i]);
  }
  formData.append("audience", "students");

  try {
    const uploaded = await apiRequest("/files/upload", {
      method: "POST",
      headers: authHeaders(),
      body: formData
    });
    fileInput.value = "";
    adminDashboardCache.files = null;
    await loadAdminDocuments();
    const count = uploaded?.files?.length || 1;
    alert(`${count} document(s) uploaded for students`);
  } catch (err) {
    alert(err.message);
  }
}

async function downloadFile(fileId, fallbackNameEncoded = "") {
  try {
    const response = await fetch(`${API}/files/download/${fileId}`, {
      headers: authHeaders()
    });

    if (!response.ok) {
      const text = await response.text();
      let message = "Download failed";
      try {
        const parsed = JSON.parse(text);
        message = parsed.error || message;
      } catch {
        if (text) {
          message = text;
        }
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const fallbackName = fallbackNameEncoded ? decodeURIComponent(fallbackNameEncoded) : "";
    link.download = fallbackName || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
}

function refreshFileListsForCurrentPage() {
  studentDashboardCache.files = null;
  adminDashboardCache.files = null;
  const page = window.location.pathname.split("/").pop() || "index.html";
  if (page === "student-dashboard.html") {
    return loadFiles();
  }
  if (page === "admin-dashboard.html") {
    return loadAdminDocuments();
  }
  return Promise.resolve();
}

async function loadStudentAssignmentDeadlines() {
  const list = document.getElementById("studentAssignmentDeadlinesList");
  if (!list) return;

  try {
    const items = studentDashboardCache.deadlines || await apiRequest("/files/assignment-deadlines/me", { headers: authHeaders() });
    const now = Date.now();
    list.innerHTML = items.length
      ? items.map((item) => {
        const due = item.dueDate ? new Date(item.dueDate) : null;
        const isOverdue = due ? due.getTime() < now : false;
        const statusBadge = isOverdue
          ? '<span class="badge text-bg-danger ms-2">Due Passed</span>'
          : '<span class="badge text-bg-success ms-2">Upcoming</span>';
        return `<li><strong>${escapeHtml(item.subject || "-")}</strong>${statusBadge}<br><small>Faculty: ${escapeHtml(item.facultyUsername || "-")} | ${escapeHtml(item.targetCourse || "-")} Sem ${escapeHtml(String(item.targetSemester || "-"))} | Due: ${due ? due.toLocaleString() : "-"}</small>${item.instructions ? `<br><small>${escapeHtml(item.instructions)}</small>` : ""}</li>`;
      }).join("")
      : "<li>No assignment deadlines published for your class yet.</li>";
  } catch (err) {
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

async function createAssignmentDeadline() {
  const subjectEl = document.getElementById("assignmentPlanSubject");
  const facultyEl = document.getElementById("assignmentPlanFacultyUsername");
  const courseEl = document.getElementById("assignmentPlanCourse");
  const semesterEl = document.getElementById("assignmentPlanSemester");
  const dueDateEl = document.getElementById("assignmentPlanDueDate");
  const instructionsEl = document.getElementById("assignmentPlanInstructions");
  if (!subjectEl || !facultyEl || !courseEl || !semesterEl || !dueDateEl || !instructionsEl) return;

  const payload = {
    subject: subjectEl.value.trim(),
    facultyUsername: facultyEl.value.trim().toLowerCase(),
    targetCourse: courseEl.value,
    targetSemester: semesterEl.value ? Number(semesterEl.value) : null,
    dueDate: dueDateEl.value ? new Date(dueDateEl.value).toISOString() : "",
    instructions: instructionsEl.value.trim()
  };

  if (!payload.subject || !payload.targetCourse || !Number.isInteger(payload.targetSemester) || !payload.dueDate) {
    alert("Subject, course, semester and due date are required");
    return;
  }

  try {
    await apiRequest("/admin/assignments/deadlines", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });
    subjectEl.value = "";
    facultyEl.value = "";
    courseEl.value = "";
    semesterEl.value = "";
    dueDateEl.value = "";
    instructionsEl.value = "";
    studentDashboardCache.deadlines = null;
    await loadAssignmentDeadlinesAdmin();
    alert("Assignment deadline created");
  } catch (err) {
    alert(err.message);
  }
}

async function deactivateAssignmentDeadline(planId) {
  if (!confirm("Deactivate this assignment deadline?")) return;
  try {
    await apiRequest(`/admin/assignments/deadlines/${planId}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ isActive: false })
    });
    studentDashboardCache.deadlines = null;
    await loadAssignmentDeadlinesAdmin();
  } catch (err) {
    alert(err.message);
  }
}

async function loadAssignmentDeadlinesAdmin() {
  const list = document.getElementById("adminAssignmentDeadlinesList");
  if (!list) return;

  try {
    const plans = await apiRequest("/admin/assignments/deadlines", { headers: authHeaders() });
    list.innerHTML = plans.length
      ? plans.map((p) => `<li><strong>${escapeHtml(p.subject || "-")}</strong> <span class="badge text-bg-info ms-2">${escapeHtml(p.targetCourse || "-")} Sem ${escapeHtml(String(p.targetSemester || "-"))}</span><br><small>Faculty: ${escapeHtml(p.facultyUsername || "-")} | Due: ${p.dueDate ? new Date(p.dueDate).toLocaleString() : "-"}</small>${p.instructions ? `<br><small>${escapeHtml(p.instructions)}</small>` : ""}<br><button class="btn btn-sm btn-outline-danger mt-1" onclick="deactivateAssignmentDeadline('${p.id}')">Deactivate</button></li>`).join("")
      : "<li>No active assignment deadlines.</li>";
    await loadDeadlineReminders();
  } catch (err) {
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

async function loadDeadlineReminders() {
  const list = document.getElementById("adminDeadlineRemindersList");
  if (!list) return;
  try {
    const reminders = await apiRequest("/admin/assignments/deadlines/reminders?days=3", { headers: authHeaders() });
    list.innerHTML = reminders.length
      ? reminders.map((r) => `<li><strong>${escapeHtml(r.subject || "-")}</strong> <span class="badge text-bg-warning ms-2">${escapeHtml(r.targetCourse || "-")} Sem ${escapeHtml(String(r.targetSemester || "-"))}</span><br><small>Due: ${r.dueDate ? new Date(r.dueDate).toLocaleString() : "-"} | Faculty: ${escapeHtml(r.facultyUsername || "-")}</small></li>`).join("")
      : "<li>No deadlines due in next 3 days.</li>";
  } catch (err) {
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

async function importAssignmentDeadlinesCsv() {
  const fileEl = document.getElementById("assignmentPlanCsvFile");
  const metaEl = document.getElementById("assignmentPlannerImportMeta");
  if (!fileEl || !fileEl.files.length) {
    alert("Please select a CSV file");
    return;
  }

  const formData = new FormData();
  formData.append("file", fileEl.files[0]);

  try {
    const result = await apiRequest("/admin/assignments/deadlines/import-csv", {
      method: "POST",
      headers: authHeaders(),
      body: formData
    });
    fileEl.value = "";
    if (metaEl) {
      const skippedCount = Array.isArray(result.skippedRows) ? result.skippedRows.length : 0;
      metaEl.textContent = `Imported: ${result.importedRows || 0}, Skipped: ${skippedCount}, Total Rows: ${result.totalRows || 0}`;
    }
    studentDashboardCache.deadlines = null;
    await loadAssignmentDeadlinesAdmin();
    alert("CSV import complete");
  } catch (err) {
    if (metaEl) metaEl.textContent = err.message;
    alert(err.message);
  }
}

async function renameUploadedFile(fileId, currentNameEncoded = "") {
  const currentName = currentNameEncoded ? decodeURIComponent(currentNameEncoded) : "";
  const nextName = prompt("Enter new file name", currentName);
  if (nextName === null) return;
  const trimmed = nextName.trim();
  if (!trimmed) {
    alert("File name cannot be empty");
    return;
  }

  try {
    await apiRequest(`/files/${fileId}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ originalName: trimmed })
    });
    await refreshFileListsForCurrentPage();
    alert("File renamed");
  } catch (err) {
    alert(err.message);
  }
}

async function editUploadedFileDetails(fileId, fileType, currentSubjectEncoded = "", currentFacultyEncoded = "") {
  if (fileType !== "assignment") {
    alert("Only assignment metadata can be edited.");
    return;
  }

  const currentSubject = currentSubjectEncoded ? decodeURIComponent(currentSubjectEncoded) : "";
  const currentFaculty = currentFacultyEncoded ? decodeURIComponent(currentFacultyEncoded) : "";
  const subject = prompt("Edit subject", currentSubject);
  if (subject === null) return;
  const subjectFacultyUsername = prompt("Edit subject faculty username", currentFaculty);
  if (subjectFacultyUsername === null) return;

  if (!subject.trim() || !subjectFacultyUsername.trim()) {
    alert("Subject and faculty username are required");
    return;
  }

  try {
    await apiRequest(`/files/${fileId}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        subject: subject.trim(),
        subjectFacultyUsername: subjectFacultyUsername.trim().toLowerCase()
      })
    });
    await refreshFileListsForCurrentPage();
    alert("File details updated");
  } catch (err) {
    alert(err.message);
  }
}

async function deleteUploadedFile(fileId) {
  if (!confirm("Delete this uploaded file?")) return;
  try {
    await apiRequest(`/files/${fileId}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    await refreshFileListsForCurrentPage();
    alert("File deleted");
  } catch (err) {
    alert(err.message);
  }
}

function renderFilesIntoList(list, files, emptyMessage, includeAudienceLabel = false) {
  const listId = list.id;
  const type = listId === "fileList" ? "student" : "admin";
  const bulkContainer = document.getElementById(`${type}BulkActions`);
  const selectAllCheckbox = document.getElementById(`${type}SelectAllFiles`);
  
  if (selectAllCheckbox) selectAllCheckbox.checked = false;

  if (!files.length) {
    list.innerHTML = `<li>${emptyMessage}</li>`;
    if (bulkContainer) {
      bulkContainer.classList.add("d-none");
      bulkContainer.classList.remove("d-flex");
    }
    return;
  }

  if (bulkContainer) {
    bulkContainer.classList.remove("d-none");
    bulkContainer.classList.add("d-flex");
  }

  const masterAdmin = isMasterAdminUser();
  list.innerHTML = files.map((f) => {
    const rawName = f.originalName || f.filename || "file";
    const displayName = escapeHtml(rawName);
    const fallbackNameEncoded = encodeURIComponent(rawName);
    const label = includeAudienceLabel && f.isPublic
      ? '<span class="badge text-bg-info ms-2">Admin document</span>'
      : "";
    const assignmentMeta = f.fileType === "assignment"
      ? ` <small class="text-muted">(Assignment | Subject: ${escapeHtml(f.subject || "-")} | Faculty: ${escapeHtml(f.subjectFacultyUsername || "-")} | ${escapeHtml(f.targetCourse || "-")} Sem ${escapeHtml(String(f.targetSemester || "-"))}${f.assignmentDueDate ? ` | Due: ${new Date(f.assignmentDueDate).toLocaleString()}` : ""})</small>`
      : "";
    const lateBadge = f.fileType === "assignment"
      ? (f.lateSubmission ? '<span class="badge text-bg-danger ms-2">Late</span>' : '<span class="badge text-bg-success ms-2">On time</span>')
      : "";
    const canManage = Boolean(f.canManage) || masterAdmin;
    const ownershipBadge = canManage
      ? '<span class="badge text-bg-success ms-2">Owner</span>'
      : '<span class="badge text-bg-secondary ms-2">Read-only</span>';
    const subjectEncoded = encodeURIComponent(f.subject || "");
    const facultyEncoded = encodeURIComponent(f.subjectFacultyUsername || "");
    const actions = [
      `<button class="btn btn-sm btn-outline-primary ms-2" onclick="downloadFile('${f._id}','${fallbackNameEncoded}')">Download</button>`
    ];
    if (canManage) {
      actions.push(`<button class="btn btn-sm btn-outline-secondary ms-2" onclick="renameUploadedFile('${f._id}','${fallbackNameEncoded}')">Rename</button>`);
      if (f.fileType === "assignment") {
        actions.push(`<button class="btn btn-sm btn-outline-info ms-2" onclick="editUploadedFileDetails('${f._id}','${f.fileType}','${subjectEncoded}','${facultyEncoded}')">Edit</button>`);
      }
      actions.push(`<button class="btn btn-sm btn-outline-danger ms-2" onclick="deleteUploadedFile('${f._id}')">Delete</button>`);
    }

    const checkboxHtml = `<input type="checkbox" class="form-check-input file-checkbox me-2" data-file-id="${f._id}">`;

    return `<li class="mb-2 d-flex align-items-center">${checkboxHtml}<span>${displayName}${label}${ownershipBadge}${lateBadge}${assignmentMeta}</span> ${actions.join("")}</li>`;
  }).join("");
}

function toggleSelectAllFiles(type) {
  const selectAll = document.getElementById(`${type}SelectAllFiles`);
  const checkboxes = document.querySelectorAll(type === 'student' ? '#fileList .file-checkbox' : '#sharedFileList .file-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = selectAll.checked;
  });
}

function getSelectedFileIds(type) {
  const checkboxes = document.querySelectorAll(type === 'student' ? '#fileList .file-checkbox:checked' : '#sharedFileList .file-checkbox:checked');
  return Array.from(checkboxes).map(cb => cb.getAttribute('data-file-id'));
}

async function bulkDownloadFiles(type) {
  const ids = getSelectedFileIds(type);
  if (ids.length === 0) {
    alert("Please select at least one file to download");
    return;
  }
  
  try {
    const response = await fetch(`${API}/files/download-bulk`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ids })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Bulk download failed');
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bulk-download-${Date.now()}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
}

async function bulkDeleteFiles(type) {
  const ids = getSelectedFileIds(type);
  if (ids.length === 0) {
    alert("Please select at least one file to delete");
    return;
  }
  
  if (!confirm(`Are you sure you want to delete the ${ids.length} selected file(s)?`)) {
    return;
  }
  
  try {
    const response = await apiRequest("/files/delete-bulk", {
      method: "POST",
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ids })
    });
    
    await refreshFileListsForCurrentPage();
    alert(response.message || "Files deleted successfully");
  } catch (err) {
    alert(err.message);
  }
}

async function bulkUpdateFiles(type) {
  const ids = getSelectedFileIds(type);
  if (ids.length === 0) {
    alert("Please select at least one file to edit");
    return;
  }
  
  const option = prompt("What would you like to update for the selected files?\n1. Subject (Assignments only)\n2. Faculty Username (Assignments only)\n3. Rename (Add prefix to filename)");
  if (option === null) return;
  
  const choice = option.trim();
  let updates = {};
  
  if (choice === "1") {
    const subject = prompt("Enter new subject:");
    if (subject === null) return;
    if (!subject.trim()) {
      alert("Subject cannot be empty");
      return;
    }
    updates.subject = subject.trim();
  } else if (choice === "2") {
    const faculty = prompt("Enter new subject faculty username:");
    if (faculty === null) return;
    if (!faculty.trim()) {
      alert("Faculty username cannot be empty");
      return;
    }
    updates.subjectFacultyUsername = faculty.trim().toLowerCase();
  } else if (choice === "3") {
    const prefix = prompt("Enter prefix to add to all filenames (e.g. 'HW1_'):");
    if (prefix === null) return;
    if (!prefix.trim()) {
      alert("Prefix cannot be empty");
      return;
    }
    updates.originalNamePrefix = prefix.trim();
  } else {
    alert("Invalid option selected");
    return;
  }
  
  try {
    const response = await apiRequest("/files/update-bulk", {
      method: "PATCH",
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ids, updates })
    });
    
    await refreshFileListsForCurrentPage();
    alert(response.message || "Files updated successfully");
  } catch (err) {
    alert(err.message);
  }
}

async function loadFiles() {
  const list = document.getElementById("fileList");
  if (!list) return;

  try {
    const files = studentDashboardCache.files || await apiRequest("/files", { headers: authHeaders() });
    renderFilesIntoList(list, files, "No files found", true);
  } catch (err) {
    list.innerHTML = `<li>${err.message}</li>`;
  }
}

async function loadAdminDocuments() {
  const list = document.getElementById("sharedFileList");
  if (!list) return;

  try {
    const files = adminDashboardCache.files || await apiRequest("/files", { headers: authHeaders() });
    renderFilesIntoList(list, files, "No documents available for your faculty account", true);
  } catch (err) {
    list.innerHTML = `<li>${err.message}</li>`;
  }
}

async function addNotice() {
  const titleEl = document.getElementById("title");
  const messageEl = document.getElementById("message");
  const scopeEl = document.getElementById("noticeScope");
  const usernamesEl = document.getElementById("targetUsernames");
  const targetCourseEl = document.getElementById("targetCourse");
  const targetSemesterEl = document.getElementById("targetSemester");

  try {
    const scope = scopeEl ? scopeEl.value : "all";
    const payload = {
      title: titleEl.value.trim(),
      message: messageEl.value.trim(),
      scope
    };

    if (scope === "user" && usernamesEl) {
      payload.targetUsernames = usernamesEl.value
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
    }

    if (scope === "group") {
      if (targetCourseEl && targetCourseEl.value) {
        payload.targetCourses = [targetCourseEl.value];
      }
      if (targetSemesterEl && targetSemesterEl.value) {
        payload.targetSemesters = [Number(targetSemesterEl.value)];
      }
    }

    await apiRequest("/notice", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });
    titleEl.value = "";
    messageEl.value = "";
    if (usernamesEl) usernamesEl.value = "";
    if (targetCourseEl) targetCourseEl.value = "";
    if (targetSemesterEl) targetSemesterEl.value = "";
    if (scopeEl) {
      scopeEl.value = "all";
      onNoticeScopeChange();
    }
    alert("Notice posted");
    adminDashboardCache.notices = null;
    studentDashboardCache.notices = null;
    await loadNotices();
  } catch (err) {
    alert(err.message);
  }
}

async function editNotice(noticeId, titleEncoded = "", messageEncoded = "") {
  const currentTitle = titleEncoded ? decodeURIComponent(titleEncoded) : "";
  const currentMessage = messageEncoded ? decodeURIComponent(messageEncoded) : "";
  const nextTitle = prompt("Edit notice title", currentTitle);
  if (nextTitle === null) return;
  const nextMessage = prompt("Edit notice message", currentMessage);
  if (nextMessage === null) return;

  if (!nextTitle.trim() || !nextMessage.trim()) {
    alert("Title and message are required");
    return;
  }

  try {
    await apiRequest(`/notice/${noticeId}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        title: nextTitle.trim(),
        message: nextMessage.trim()
      })
    });
    adminDashboardCache.notices = null;
    studentDashboardCache.notices = null;
    await loadNotices();
    alert("Notice updated");
  } catch (err) {
    alert(err.message);
  }
}

async function deleteNotice(noticeId) {
  if (!confirm("Delete this notice?")) return;
  try {
    await apiRequest(`/notice/${noticeId}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    adminDashboardCache.notices = null;
    studentDashboardCache.notices = null;
    await loadNotices();
    alert("Notice deleted");
  } catch (err) {
    alert(err.message);
  }
}

async function loadNotices() {
  const list = document.getElementById("noticeList");
  const tabList = document.getElementById("noticeListTab") || document.getElementById("adminNoticeListTab");

  try {
    const notices = studentDashboardCache.notices || adminDashboardCache.notices || await apiRequest("/notice", { headers: authHeaders() });
    latestNoticeCache = Array.isArray(notices) ? notices : [];
    renderNoticeCenter(latestNoticeCache);
    
    const html = renderNoticeListHtml(notices);
    
    if (list) {
      const isFeedPage = Boolean(document.getElementById("noticeFeedMeta"));
      if (isFeedPage) {
        applyNoticeFeedFilters();
      } else {
        list.innerHTML = html;
      }
    }
    
    if (tabList) {
      tabList.innerHTML = html;
    }
  } catch (err) {
    if (list) {
      list.innerHTML = `<li>${err.message}</li>`;
    }
    if (tabList) {
      tabList.innerHTML = `<li>${err.message}</li>`;
    }
  }
}

async function addMarks() {
  const studentIdEl = document.getElementById("studentId");
  const subjectEl = document.getElementById("subject");
  const marksCourseEl = document.getElementById("marksCourse");
  const marksSemesterEl = document.getElementById("marksSemester");
  const marksEl = document.getElementById("marks");

  try {
    await apiRequest("/marks", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        studentId: studentIdEl.value.trim(),
        subject: subjectEl.value.trim(),
        marks: Number(marksEl.value),
        course: marksCourseEl ? marksCourseEl.value : "",
        semester: marksSemesterEl && marksSemesterEl.value ? Number(marksSemesterEl.value) : null
      })
    });
    subjectEl.value = "";
    if (marksCourseEl) marksCourseEl.value = "";
    if (marksSemesterEl) marksSemesterEl.value = "";
    marksEl.value = "";
    adminDashboardCache.marks = null;
    studentDashboardCache.marks = null;
    await loadAdminMarks();
    alert("Marks added");
  } catch (err) {
    alert(err.message);
  }
}

async function loadAdminMarks() {
  const list = document.getElementById("adminMarksList");
  if (!list) return;

  try {
    const entries = adminDashboardCache.marks || await apiRequest("/marks", { headers: authHeaders() });
    list.innerHTML = entries.length
      ? entries.map((m) => {
        const subjectEncoded = encodeURIComponent(m.subject || "");
        const studentIdEncoded = encodeURIComponent(m.studentId || "");
        const marksEncoded = encodeURIComponent(String(m.marks ?? ""));
        const courseEncoded = encodeURIComponent(m.course || "");
        const semesterEncoded = encodeURIComponent(String(m.semester ?? ""));
        const ownershipBadge = m.canManage
          ? '<span class="badge text-bg-success ms-2">Owner</span>'
          : '<span class="badge text-bg-secondary ms-2">Read-only</span>';
        const actions = m.canManage === false
          ? ""
          : ` <button class="btn btn-sm btn-outline-secondary ms-2" onclick="editMarksEntry('${m._id}','${studentIdEncoded}','${subjectEncoded}','${marksEncoded}','${courseEncoded}','${semesterEncoded}')">Edit</button><button class="btn btn-sm btn-outline-danger ms-2" onclick="deleteMarksEntry('${m._id}')">Delete</button>`;
        return `<li class="mb-2"><strong>${escapeHtml(m.subject || "-")}</strong>${ownershipBadge} | Student ID: ${escapeHtml(m.studentId || "-")} | Marks: ${escapeHtml(String(m.marks ?? "-"))} | ${escapeHtml(m.course || "-")} Sem ${escapeHtml(String(m.semester || "-"))}${actions}</li>`;
      }).join("")
      : "<li>No marks entries found</li>";
  } catch (err) {
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
  }
}

async function editMarksEntry(entryId, studentIdEncoded = "", subjectEncoded = "", currentMarks = "", currentCourse = "", currentSemester = "") {
  const nextStudentId = prompt("Edit student ID", studentIdEncoded ? decodeURIComponent(studentIdEncoded) : "");
  if (nextStudentId === null) return;
  const nextSubject = prompt("Edit subject", subjectEncoded ? decodeURIComponent(subjectEncoded) : "");
  if (nextSubject === null) return;
  const marksInput = prompt("Edit marks", currentMarks ? decodeURIComponent(currentMarks) : "");
  if (marksInput === null) return;
  const nextCourse = prompt("Edit course (leave blank to clear)", currentCourse ? decodeURIComponent(currentCourse) : "");
  if (nextCourse === null) return;
  const nextSemester = prompt("Edit semester (leave blank to clear)", currentSemester ? decodeURIComponent(currentSemester) : "");
  if (nextSemester === null) return;

  const markValue = Number(marksInput);
  if (!nextStudentId.trim() || !nextSubject.trim() || Number.isNaN(markValue)) {
    alert("Student ID, subject and numeric marks are required");
    return;
  }

  const payload = {
    studentId: nextStudentId.trim(),
    subject: nextSubject.trim(),
    marks: markValue,
    course: nextCourse.trim(),
    semester: nextSemester.trim() ? Number(nextSemester.trim()) : null
  };

  try {
    await apiRequest(`/marks/entry/${entryId}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });
    adminDashboardCache.marks = null;
    studentDashboardCache.marks = null;
    await loadAdminMarks();
    alert("Marks updated");
  } catch (err) {
    alert(err.message);
  }
}

async function deleteMarksEntry(entryId) {
  if (!confirm("Delete this marks entry?")) return;
  try {
    await apiRequest(`/marks/entry/${entryId}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    adminDashboardCache.marks = null;
    studentDashboardCache.marks = null;
    await loadAdminMarks();
    alert("Marks deleted");
  } catch (err) {
    alert(err.message);
  }
}

async function fetchAdminReport(limit = 200) {
  return apiRequest(`/admin/report?limit=${limit}`, {
    headers: authHeaders()
  });
}

function updateAdminStats(summary = {}) {
  const pendingUploadsValue = document.getElementById("pendingUploadsValue");
  const totalNoticesValue = document.getElementById("totalNoticesValue");
  const activeStudentsValue = document.getElementById("activeStudentsValue");

  if (pendingUploadsValue) pendingUploadsValue.textContent = summary.pendingUploads ?? 0;
  if (totalNoticesValue) totalNoticesValue.textContent = summary.totalNotices ?? 0;
  if (activeStudentsValue) activeStudentsValue.textContent = summary.totalStudents ?? 0;
}

function updateSyncStatus(generatedAt) {
  const statusEl = document.getElementById("adminSyncStatus");
  if (!statusEl || !generatedAt) return;

  const syncedAt = new Date(generatedAt);
  statusEl.textContent = `Last synced: ${syncedAt.toLocaleString()}`;
}

function reportFileName(prefix = "admin-report", extension = "json") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}.${extension}`;
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function formatObjectIdDate(id) {
  const raw = typeof id === "string" ? id : (id && typeof id.toString === "function" ? id.toString() : "");
  if (!raw || raw.length < 8) return "";

  const timestamp = Number.parseInt(raw.substring(0, 8), 16);
  if (!Number.isFinite(timestamp)) return "";

  return new Date(timestamp * 1000).toLocaleString();
}

function reportSummaryRows(summary = {}, generatedAt = "") {
  return [
    { Metric: "Generated At", Value: generatedAt },
    { Metric: "Total Students", Value: summary.totalStudents ?? 0 },
    { Metric: "Total Notices", Value: summary.totalNotices ?? 0 },
    { Metric: "Total Files", Value: summary.totalFiles ?? 0 },
    { Metric: "Shared Files", Value: summary.sharedFiles ?? 0 },
    { Metric: "Pending Uploads", Value: summary.pendingUploads ?? 0 },
    { Metric: "Total Marks Entries", Value: summary.totalMarksEntries ?? 0 },
    { Metric: "Total Attendance Entries", Value: summary.totalAttendanceEntries ?? 0 }
  ];
}

function reportNoticesRows(notices = []) {
  return notices.map((notice) => ({
    Title: notice.title || "",
    Message: notice.message || "",
    Audience: notice.scope === "user"
      ? `Users: ${(notice.targetUsernames || []).join(", ")}`
      : notice.scope === "group"
        ? `Course: ${(notice.targetCourses || []).join(", ") || "Any"} | Semester: ${(notice.targetSemesters || []).join(", ") || "Any"}`
        : "All users",
    Date: notice.date ? new Date(notice.date).toLocaleString() : ""
  }));
}

function reportFilesRows(files = []) {
  return files.map((file) => ({
    Name: file.originalName || file.filename || "",
    Audience: file.isPublic ? "Students" : "Private",
    UploadedBy: file.user || "",
    UploadedAt: formatObjectIdDate(file._id)
  }));
}

function reportMarksRows(marks = []) {
  return marks.map((entry) => ({
    StudentId: entry.studentId || "",
    Subject: entry.subject || "",
    Course: entry.course || "",
    Semester: entry.semester ?? "",
    Faculty: entry.facultyUsername || "",
    Marks: entry.marks ?? "",
    RecordedAt: formatObjectIdDate(entry._id)
  }));
}

function reportAttendanceRows(attendance = []) {
  return attendance.map((entry) => ({
    StudentId: entry.studentId || "",
    StudentUsername: entry.studentUsername || "",
    Subject: entry.subject || "",
    Date: entry.attendanceDate ? new Date(entry.attendanceDate).toLocaleDateString() : "",
    Status: entry.status || "",
    Percentage: entry.percentage ?? "",
    PresentClasses: entry.presentClasses ?? "",
    TotalClasses: entry.totalClasses ?? "",
    Remarks: entry.remarks || "",
    SourceSheetId: entry.sourceSheetId || ""
  }));
}

function exportReportAsExcel(report) {
  if (!window.XLSX) {
    throw new Error("Excel export library failed to load. Refresh and retry.");
  }

  const workbook = window.XLSX.utils.book_new();
  const generatedAt = report.generatedAt ? new Date(report.generatedAt).toLocaleString() : "";
  const summaryRows = reportSummaryRows(report.summary, generatedAt);

  const summarySheet = window.XLSX.utils.json_to_sheet(summaryRows);
  const noticesSheet = window.XLSX.utils.json_to_sheet(reportNoticesRows(report.notices));
  const filesSheet = window.XLSX.utils.json_to_sheet(reportFilesRows(report.files));
  const marksSheet = window.XLSX.utils.json_to_sheet(reportMarksRows(report.marks));
  const attendanceSheet = window.XLSX.utils.json_to_sheet(reportAttendanceRows(report.attendance || []));

  window.XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  window.XLSX.utils.book_append_sheet(workbook, noticesSheet, "Notices");
  window.XLSX.utils.book_append_sheet(workbook, filesSheet, "Files");
  window.XLSX.utils.book_append_sheet(workbook, marksSheet, "Marks");
  window.XLSX.utils.book_append_sheet(workbook, attendanceSheet, "Attendance");

  window.XLSX.writeFile(workbook, reportFileName("admin-report", "xlsx"));
}

function exportReportAsPdf(report) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("PDF export library failed to load. Refresh and retry.");
  }

  const jsPDF = window.jspdf.jsPDF;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const addTable = typeof doc.autoTable === "function";

  doc.setFontSize(16);
  doc.text("Admin Report", 40, 44);
  doc.setFontSize(10);
  const generatedAt = report.generatedAt ? new Date(report.generatedAt).toLocaleString() : new Date().toLocaleString();
  doc.text(`Generated: ${generatedAt}`, 40, 62);

  if (!addTable) {
    doc.text("Auto table plugin not loaded. PDF table export unavailable.", 40, 84);
    doc.save(reportFileName("admin-report", "pdf"));
    return;
  }

  let y = 80;
  doc.autoTable({
    startY: y,
    head: [["Metric", "Value"]],
    body: reportSummaryRows(report.summary, generatedAt).map((row) => [row.Metric, String(row.Value)]),
    theme: "grid"
  });

  y = doc.lastAutoTable.finalY + 20;
  doc.text("Notices", 40, y);
  doc.autoTable({
    startY: y + 8,
    head: [["Title", "Message", "Audience", "Date"]],
    body: reportNoticesRows(report.notices).map((row) => [row.Title, row.Message, row.Audience, row.Date]),
    theme: "striped"
  });

  y = doc.lastAutoTable.finalY + 20;
  doc.text("Files", 40, y);
  doc.autoTable({
    startY: y + 8,
    head: [["Name", "Audience", "UploadedBy", "UploadedAt"]],
    body: reportFilesRows(report.files).map((row) => [row.Name, row.Audience, row.UploadedBy, row.UploadedAt]),
    theme: "striped"
  });

  y = doc.lastAutoTable.finalY + 20;
  doc.text("Marks", 40, y);
  doc.autoTable({
    startY: y + 8,
    head: [["StudentId", "Subject", "Course", "Semester", "Faculty", "Marks", "RecordedAt"]],
    body: reportMarksRows(report.marks).map((row) => [row.StudentId, row.Subject, row.Course, String(row.Semester), row.Faculty, String(row.Marks), row.RecordedAt]),
    theme: "striped"
  });

  y = doc.lastAutoTable.finalY + 20;
  doc.text("Attendance", 40, y);
  doc.autoTable({
    startY: y + 8,
    head: [["StudentId", "Username", "Subject", "Date", "Status", "%", "Present", "Total"]],
    body: reportAttendanceRows(report.attendance || []).map((row) => [
      row.StudentId,
      row.StudentUsername,
      row.Subject,
      row.Date,
      row.Status,
      String(row.Percentage),
      String(row.PresentClasses),
      String(row.TotalClasses)
    ]),
    theme: "striped"
  });

  doc.save(reportFileName("admin-report", "pdf"));
}

async function syncAdminData(options = {}) {
  const { silent = false } = options;

  try {
    const report = await fetchAdminReport(200);
    adminDashboardCache = {
      notices: report.notices || [],
      files: report.files || [],
      marks: report.marks || [],
      attendance: report.attendance || []
    };
    updateAdminStats(report.summary);
    updateSyncStatus(report.generatedAt);
    await Promise.all([loadNotices(), loadAdminDocuments(), loadAdminMarks(), loadAdminAttendance(), loadAtRiskStudents(), loadAssignmentDeadlinesAdmin()]);

    if (!silent) {
      alert("Dashboard data synced");
    }
  } catch (err) {
    if (!silent) {
      alert(err.message);
    }
  }
}

async function exportAdminReport(format = "xlsx") {
  try {
    const report = await fetchAdminReport(1000);

    if (format === "pdf") {
      exportReportAsPdf(report);
      alert("PDF report generated and downloaded");
      return;
    }

    if (format === "xlsx") {
      exportReportAsExcel(report);
      alert("Excel report generated and downloaded");
      return;
    }

    downloadJsonFile(reportFileName("admin-report", "json"), report);
    alert("JSON report generated and downloaded");
  } catch (err) {
    alert(err.message);
  }
}

async function loadAtRiskStudents() {
  const body = document.getElementById("atRiskStudentsBody");
  if (!body) return;

  body.innerHTML = '<tr><td colspan="8" class="text-muted">Loading at-risk students...</td></tr>';
  try {
    const students = await apiRequest("/admin/at-risk-students?limit=100", { headers: authHeaders() });
    body.innerHTML = students.length
      ? students.map((s) => `<tr>
        <td>${escapeHtml(s.name || "")}</td>
        <td>${escapeHtml(s.username || "")}</td>
        <td>${escapeHtml(s.course || "")}</td>
        <td>${escapeHtml(String(s.semester || ""))}</td>
        <td>${s.avgAttendance === null ? "-" : `${escapeHtml(String(s.avgAttendance))}%`}</td>
        <td>${s.avgMarks === null ? "-" : escapeHtml(String(s.avgMarks))}</td>
        <td>${escapeHtml(Array.isArray(s.reasons) ? s.reasons.join(" | ") : "-")}</td>
        <td>
          ${s.latestIntervention ? `<small class="d-block text-muted mb-1">Latest: ${escapeHtml(s.latestIntervention.status || "-")} (${s.latestIntervention.updatedAt ? new Date(s.latestIntervention.updatedAt).toLocaleDateString() : "-"})</small>` : ""}
          <div class="d-flex flex-wrap gap-1">
            <button class="btn btn-sm btn-outline-secondary" onclick="selectInterventionStudent('${s.id}','${encodeURIComponent(s.name || s.username || "Student")}')">Open</button>
            <button class="btn btn-sm btn-outline-primary" onclick="selectInterventionStudent('${s.id}','${encodeURIComponent(s.name || s.username || "Student")}'); openInterventionModal();">Add Note</button>
          </div>
        </td>
      </tr>`).join("")
      : '<tr><td colspan="8" class="text-muted">No at-risk students found for your scope.</td></tr>';
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
  }
}

function openInterventionModal() {
  if (!selectedInterventionStudent || !selectedInterventionStudent.id) {
    alert("Select a student first");
    return;
  }

  const backdrop = document.getElementById("interventionModalBackdrop");
  const label = document.getElementById("interventionModalStudentLabel");
  const noteEl = document.getElementById("interventionNoteInput");
  const priorityEl = document.getElementById("interventionPriorityInput");
  const statusEl = document.getElementById("interventionStatusInput");
  const followUpEl = document.getElementById("interventionFollowUpInput");
  if (!backdrop || !label || !noteEl || !priorityEl || !statusEl || !followUpEl) return;

  label.textContent = `Student: ${selectedInterventionStudent.name || "Unknown"}`;
  noteEl.value = "";
  priorityEl.value = "medium";
  statusEl.value = "open";
  followUpEl.value = "";
  backdrop.classList.remove("d-none");
}

function closeInterventionModal() {
  const backdrop = document.getElementById("interventionModalBackdrop");
  if (backdrop) backdrop.classList.add("d-none");
}

async function submitInterventionNoteFromModal() {
  if (!selectedInterventionStudent || !selectedInterventionStudent.id) {
    alert("Select a student first");
    return;
  }

  const noteEl = document.getElementById("interventionNoteInput");
  const priorityEl = document.getElementById("interventionPriorityInput");
  const statusEl = document.getElementById("interventionStatusInput");
  const followUpEl = document.getElementById("interventionFollowUpInput");
  if (!noteEl || !priorityEl || !statusEl || !followUpEl) return;

  const note = noteEl.value.trim();
  if (!note) {
    alert("Note is required");
    return;
  }

  const payload = {
    note,
    priority: priorityEl.value,
    status: statusEl.value
  };
  if (followUpEl.value) {
    payload.followUpDate = new Date(`${followUpEl.value}T00:00:00`).toISOString();
  }

  try {
    await apiRequest(`/admin/interventions/${selectedInterventionStudent.id}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });
    closeInterventionModal();
    await loadAtRiskStudents();
    interventionPageState = 1;
    await loadInterventionHistoryForSelected(1);
    alert("Intervention note saved");
  } catch (err) {
    alert(err.message);
  }
}

async function selectInterventionStudent(studentId, encodedName = "") {
  const displayName = encodedName ? decodeURIComponent(encodedName) : "Student";
  selectedInterventionStudent = { id: studentId, name: displayName };
  interventionPageState = 1;
  const selectedEl = document.getElementById("interventionSelectedStudent");
  const addBtn = document.getElementById("openInterventionModalBtn");
  if (selectedEl) selectedEl.textContent = `Selected: ${displayName}`;
  if (addBtn) addBtn.disabled = false;
  await loadInterventionHistoryForSelected(1);
}

function resetInterventionSearch() {
  const searchEl = document.getElementById("interventionSearchInput");
  if (searchEl) searchEl.value = "";
  interventionPageState = 1;
  loadInterventionHistoryForSelected(1);
}

function changeInterventionPage(delta) {
  interventionPageState += Number(delta) || 0;
  if (interventionPageState < 1) interventionPageState = 1;
  loadInterventionHistoryForSelected(interventionPageState);
}

async function loadInterventionHistoryForSelected(page = interventionPageState) {
  const list = document.getElementById("interventionHistoryList");
  const metaEl = document.getElementById("interventionPaginationMeta");
  const prevBtn = document.getElementById("interventionPrevBtn");
  const nextBtn = document.getElementById("interventionNextBtn");
  if (!list) return;
  if (!selectedInterventionStudent || !selectedInterventionStudent.id) {
    list.innerHTML = "<li>Select a student to view intervention history.</li>";
    if (metaEl) metaEl.textContent = "";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  try {
    interventionPageState = Math.max(1, Number(page) || 1);
    const searchEl = document.getElementById("interventionSearchInput");
    const q = String(searchEl ? searchEl.value : "").trim();
    const query = new URLSearchParams({
      page: String(interventionPageState),
      limit: String(INTERVENTION_PAGE_LIMIT)
    });
    if (q) query.set("q", q);

    const data = await apiRequest(`/admin/interventions/${selectedInterventionStudent.id}?${query.toString()}`, { headers: authHeaders() });
    const notes = Array.isArray(data.items) ? data.items : [];

    if (!notes.length) {
      list.innerHTML = `<li>No intervention notes found for ${escapeHtml(selectedInterventionStudent.name || "student")}.</li>`;
      if (metaEl) metaEl.textContent = `Page ${interventionPageState}`;
      if (prevBtn) prevBtn.disabled = interventionPageState <= 1;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }

    list.innerHTML = notes.map((n) => `<li><strong>[${escapeHtml(n.priority || "-")}/${escapeHtml(n.status || "-")}]</strong> ${escapeHtml(n.note || "")}<br><small>By: ${escapeHtml(n.adminUsername || "-")} | ${n.createdAt ? new Date(n.createdAt).toLocaleString() : "-"}${n.followUpDate ? ` | Follow-up: ${new Date(n.followUpDate).toLocaleDateString()}` : ""}</small></li>`).join("");
    if (metaEl) {
      const totalPages = Math.max(1, Math.ceil(Number(data.total || 0) / Number(data.limit || INTERVENTION_PAGE_LIMIT)));
      metaEl.textContent = `Page ${Number(data.page || interventionPageState)} of ${totalPages} | Total ${Number(data.total || notes.length)} notes`;
    }
    if (prevBtn) prevBtn.disabled = interventionPageState <= 1;
    if (nextBtn) nextBtn.disabled = !Boolean(data.hasNext);
  } catch (err) {
    list.innerHTML = `<li>${escapeHtml(err.message)}</li>`;
    if (metaEl) metaEl.textContent = "";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
  }
}

async function fetchMentees() {
  return apiRequest("/admin/mentees", { headers: authHeaders() });
}

function menteeRows(mentees = []) {
  return mentees.map((m) => ({
    Name: m.name || "",
    Username: m.username || "",
    Course: m.course || "",
    Semester: m.semester ?? "",
    LinkedBy: m.mentorMappedBy || ""
  }));
}

async function loadMentees() {
  const body = document.getElementById("menteeTableBody");
  if (!body) return;

  body.innerHTML = '<tr><td colspan="5" class="text-muted">Loading mentees...</td></tr>';
  try {
    const mentees = await fetchMentees();
    body.innerHTML = mentees.length
      ? mentees.map((m) => `<tr><td>${escapeHtml(m.name || "")}</td><td>${escapeHtml(m.username || "")}</td><td>${escapeHtml(m.course || "")}</td><td>${escapeHtml(String(m.semester || ""))}</td><td>${escapeHtml(m.mentorMappedBy || "")}</td></tr>`).join("")
      : '<tr><td colspan="5" class="text-muted">No mentees mapped yet. Update mentoring details in Profile tab.</td></tr>';
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
  }
}

function exportMenteesAsExcel(mentees = []) {
  if (!window.XLSX) {
    throw new Error("Excel export library failed to load. Refresh and retry.");
  }
  const workbook = window.XLSX.utils.book_new();
  const sheet = window.XLSX.utils.json_to_sheet(menteeRows(mentees));
  window.XLSX.utils.book_append_sheet(workbook, sheet, "Mentees");
  window.XLSX.writeFile(workbook, reportFileName("mentee-details", "xlsx"));
}

function exportMenteesAsPdf(mentees = [], reportTitle = "Mentee Details", fileBaseName = "mentee-details") {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("PDF export library failed to load. Refresh and retry.");
  }
  const jsPDF = window.jspdf.jsPDF;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const addTable = typeof doc.autoTable === "function";

  doc.setFontSize(16);
  doc.text(reportTitle, 40, 44);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 62);

  if (!addTable) {
    doc.text("Auto table plugin not loaded. PDF table export unavailable.", 40, 84);
    doc.save(reportFileName(fileBaseName, "pdf"));
    return;
  }

  doc.autoTable({
    startY: 80,
    head: [["Name", "Username", "Course", "Semester", "Linked By"]],
    body: menteeRows(mentees).map((r) => [r.Name, r.Username, r.Course, String(r.Semester), r.LinkedBy]),
    theme: "striped"
  });

  doc.save(reportFileName(fileBaseName, "pdf"));
}

async function exportMenteeDetails(format = "xlsx") {
  try {
    const mentees = await fetchMentees();
    if (!mentees.length) {
      alert("No mentee data to export");
      return;
    }
    if (format === "pdf") {
      exportMenteesAsPdf(mentees);
      alert("Mentee PDF exported");
      return;
    }
    exportMenteesAsExcel(mentees);
    alert("Mentee Excel exported");
  } catch (err) {
    alert(err.message);
  }
}

let masterAdminDetailRowsState = [];
let masterAdminDetailTitleState = "Detailed Report";
let masterAdminDetailFileBaseState = "master-admin-report";

async function loadMasterAdminFacultyReport(username, displayName = "") {
  const body = document.getElementById("masterAdminDetailBody");
  if (body) {
    body.innerHTML = '<tr><td colspan="5" class="text-muted">Loading faculty mentee report...</td></tr>';
  }
  try {
    const data = await apiRequest(`/admin/master-reports/faculty/${encodeURIComponent(username)}`, { headers: authHeaders() });
    const facultyName = data.faculty?.name || displayName || username;
    const rows = Array.isArray(data.mentees) ? data.mentees : [];
    const subtitle = `Faculty/Admin: ${facultyName} (${username}) | Total Mentees: ${rows.length}`;
    renderMasterAdminDetail(`Faculty Mentee Report`, subtitle, rows, `faculty-${username}-mentees`);
  } catch (err) {
    if (body) body.innerHTML = `<tr><td colspan="5" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadMasterAdminCourseReport(course) {
  const body = document.getElementById("masterAdminDetailBody");
  if (body) {
    body.innerHTML = '<tr><td colspan="5" class="text-muted">Loading course-wise report...</td></tr>';
  }
  try {
    const data = await apiRequest(`/admin/master-reports/course?course=${encodeURIComponent(course)}`, { headers: authHeaders() });
    const rows = Array.isArray(data.students) ? data.students : [];
    const subtitle = `Course: ${course} | Total Students: ${rows.length}`;
    renderMasterAdminDetail(`Course Student Report`, subtitle, rows, `course-${course.replaceAll(" ", "-").replaceAll(".", "")}-students`);
  } catch (err) {
    if (body) body.innerHTML = `<tr><td colspan="5" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderMasterAdminDetail(title, subtitle, rows, fileBase) {
  const section = document.getElementById("masterAdminDetailSection");
  const titleEl = document.getElementById("masterAdminDetailTitle");
  const subtitleEl = document.getElementById("masterAdminDetailSubtitle");
  const body = document.getElementById("masterAdminDetailBody");
  if (!section || !titleEl || !subtitleEl || !body) return;

  section.classList.remove("d-none");
  titleEl.textContent = title;
  subtitleEl.textContent = subtitle;

  masterAdminDetailRowsState = Array.isArray(rows) ? rows : [];
  masterAdminDetailTitleState = title;
  masterAdminDetailFileBaseState = fileBase || "master-admin-report";

  body.innerHTML = masterAdminDetailRowsState.length
    ? masterAdminDetailRowsState.map((m) => `<tr><td>${escapeHtml(m.name || "")}</td><td>${escapeHtml(m.username || "")}</td><td>${escapeHtml(m.course || "")}</td><td>${escapeHtml(String(m.semester ?? ""))}</td><td>${escapeHtml(m.mentorMappedBy || "")}</td></tr>`).join("")
    : '<tr><td colspan="5" class="text-muted">No records found</td></tr>';
}

function exportMasterAdminDetail(format = "xlsx") {
  if (!masterAdminDetailRowsState.length) {
    alert("No detailed report data to export");
    return;
  }
  try {
    if (format === "pdf") {
      exportMenteesAsPdf(masterAdminDetailRowsState, masterAdminDetailTitleState, masterAdminDetailFileBaseState);
      alert("Detailed PDF exported");
      return;
    }

    if (!window.XLSX) {
      throw new Error("Excel export library failed to load. Refresh and retry.");
    }
    const workbook = window.XLSX.utils.book_new();
    const sheet = window.XLSX.utils.json_to_sheet(menteeRows(masterAdminDetailRowsState));
    window.XLSX.utils.book_append_sheet(workbook, sheet, "Report");
    window.XLSX.writeFile(workbook, reportFileName(masterAdminDetailFileBaseState, "xlsx"));
    alert("Detailed Excel exported");
  } catch (err) {
    alert(err.message);
  }
}

async function loadMasterAdminReports() {
  const section = document.getElementById("masterAdminReportsSection");
  const facultyBody = document.getElementById("facultyAdminReportBody");
  const studentBody = document.getElementById("studentCourseReportBody");
  const detailSection = document.getElementById("masterAdminDetailSection");
  if (!section || !facultyBody || !studentBody) return;

  if (!isMasterAdminUser()) {
    section.classList.add("d-none");
    return;
  }

  section.classList.remove("d-none");
  if (detailSection) detailSection.classList.add("d-none");
  facultyBody.innerHTML = '<tr><td colspan="4" class="text-muted">Loading faculty/admin report...</td></tr>';
  studentBody.innerHTML = '<tr><td colspan="3" class="text-muted">Loading student course report...</td></tr>';

  try {
    const users = await apiRequest("/admin/users", { headers: authHeaders() });

    const facultyAdmins = users.filter((u) => u.role === "admin" || u.role === "master_admin");
    facultyBody.innerHTML = facultyAdmins.length
      ? facultyAdmins.map((u) => {
        const mentoring = u.role === "admin" && Array.isArray(u.mentorCourses) && Array.isArray(u.mentorSemesters) && u.mentorCourses.length && u.mentorSemesters.length
          ? `${u.mentorCourses.join(", ")} | Sem ${u.mentorSemesters.join(", ")}`
          : (u.role === "master_admin" ? "Not mentoring (Master Admin)" : "Not configured");
        const nameCell = u.role === "admin"
          ? (() => {
            const encodedUsername = encodeURIComponent(u.username || "");
            const encodedName = encodeURIComponent(u.name || "");
            return `<button class="btn btn-link btn-sm p-0" onclick="loadMasterAdminFacultyReport(decodeURIComponent('${encodedUsername}'),decodeURIComponent('${encodedName}'))">${escapeHtml(u.name || "")}</button>`;
          })()
          : `<span>${escapeHtml(u.name || "")}</span>`;
        return `<tr><td>${nameCell}</td><td>${escapeHtml(u.username || "")}</td><td>${escapeHtml(u.role || "")}</td><td>${escapeHtml(mentoring)}</td></tr>`;
      }).join("")
      : '<tr><td colspan="4" class="text-muted">No admin/faculty users found</td></tr>';

    const students = users.filter((u) => u.role === "student");
    const grouped = new Map();
    students.forEach((u) => {
      const course = u.course || "Unknown";
      if (!grouped.has(course)) {
        grouped.set(course, { total: 0, semesters: new Map() });
      }
      const item = grouped.get(course);
      item.total += 1;
      const semKey = Number.isInteger(u.semester) ? String(u.semester) : "-";
      item.semesters.set(semKey, (item.semesters.get(semKey) || 0) + 1);
    });

    const rows = [...grouped.entries()]
      .map(([course, value]) => {
        const semText = [...value.semesters.entries()]
          .sort((a, b) => {
            const aSem = Number(a[0]);
            const bSem = Number(b[0]);
            if (!Number.isFinite(aSem) && !Number.isFinite(bSem)) return 0;
            if (!Number.isFinite(aSem)) return 1;
            if (!Number.isFinite(bSem)) return -1;
            return aSem - bSem;
          })
          .map(([sem, total]) => `Sem ${sem}: ${total}`)
          .join(" | ");
        return { course, total: value.total, semText };
      })
      .sort((a, b) => a.course.localeCompare(b.course));

    studentBody.innerHTML = rows.length
      ? rows.map((r) => {
        const encodedCourse = encodeURIComponent(r.course || "");
        return `<tr><td><button class="btn btn-link btn-sm p-0" onclick="loadMasterAdminCourseReport(decodeURIComponent('${encodedCourse}'))">${escapeHtml(r.course)}</button></td><td>${r.total}</td><td>${escapeHtml(r.semText || "-")}</td></tr>`;
      }).join("")
      : '<tr><td colspan="3" class="text-muted">No student course data found</td></tr>';
  } catch (err) {
    facultyBody.innerHTML = `<tr><td colspan="4" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
    studentBody.innerHTML = `<tr><td colspan="3" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadMyMarks() {
  const list = document.getElementById("marksList");
  if (!list) return;

  try {
    const marks = await apiRequest("/marks/me/list", { headers: authHeaders() });
    list.innerHTML = marks.length
      ? marks.map((m) => `<li>${m.subject} (${m.course || "-"} Sem ${m.semester || "-"}) - Faculty: ${m.facultyUsername || "-"}: <strong>${m.marks}</strong></li>`).join("")
      : "<li>No marks found</li>";
  } catch (err) {
    list.innerHTML = `<li>${err.message}</li>`;
  }
}

async function loadProfile() {
  const profileData = document.getElementById("profileData");
  if (!profileData) return;

  try {
    const user = await apiRequest("/auth/me", { headers: authHeaders() });
    const role = user.role || "";
    const isAdminRole = role === "admin" || role === "master_admin";
    const isFacultyAdmin = role === "admin";
    const isStudentRole = role === "student";
    const mentorCourses = Array.isArray(user.mentorCourses) && user.mentorCourses.length
      ? user.mentorCourses.join(", ")
      : "-";
    const mentorSemesters = Array.isArray(user.mentorSemesters) && user.mentorSemesters.length
      ? user.mentorSemesters.join(", ")
      : "-";
    const summaryLines = [
      `<p><strong>Name:</strong> ${user.name}</p>`,
      `<p><strong>Username:</strong> ${user.username || user.email}</p>`,
      `<p><strong>Role:</strong> ${user.role}</p>`
    ];
    if (isStudentRole) {
      summaryLines.push(`<p><strong>Course:</strong> ${user.course || "-"}</p>`);
      summaryLines.push(`<p><strong>Semester:</strong> ${user.semester || "-"}</p>`);
    }
    if (isFacultyAdmin) {
      summaryLines.push(`<p><strong>Mentoring Courses:</strong> ${mentorCourses}</p>`);
      summaryLines.push(`<p><strong>Mentoring Semesters:</strong> ${mentorSemesters}</p>`);
    }
    summaryLines.push(`<p><strong>User ID:</strong> ${user._id}</p>`);
    profileData.innerHTML = summaryLines.join("");

    const nameInput = document.getElementById("profileNameInput");
    const usernameInput = document.getElementById("profileUsernameInput");
    const passwordInput = document.getElementById("profilePasswordInput");
    const profileUpdateSection = document.getElementById("profileUpdateSection");
    if (nameInput) nameInput.value = user.name || "";
    if (usernameInput) usernameInput.value = user.username || user.email || "";
    if (passwordInput) passwordInput.value = "";
    if (profileUpdateSection) {
      profileUpdateSection.classList.toggle("d-none", isStudentRole);
    }

    const backLink = document.getElementById("profileBackLink");
    if (backLink) {
      backLink.href = isAdminRole ? "admin-dashboard.html" : "student-dashboard.html";
    }

    const studentAcademicSection = document.getElementById("profileStudentAcademicSection");
    const studentCourseInput = document.getElementById("studentCourseInput");
    const studentSemesterInput = document.getElementById("studentSemesterInput");
    if (studentAcademicSection && studentCourseInput && studentSemesterInput) {
      studentAcademicSection.classList.toggle("d-none", true);
      if (isStudentRole) {
        studentCourseInput.value = user.course || "";
        studentSemesterInput.value = user.semester ? String(user.semester) : "";
        applyStudentSemesterLimits(user.course || "");
      }
    }

    const mentoringSection = document.getElementById("profileMentoringSection");
    const facultyDetailsSection = document.getElementById("profileFacultyDetailsSection");
    const mentorCourseEl = document.getElementById("mentorCourse");
    const mentorSemEls = document.querySelectorAll(".mentor-semester-checkbox");
    if (mentoringSection && mentorCourseEl && mentorSemEls.length) {
      mentoringSection.classList.toggle("d-none", !isFacultyAdmin);
      if (isFacultyAdmin) {
        const courses = Array.isArray(user.mentorCourses) ? user.mentorCourses : [];
        const semesters = Array.isArray(user.mentorSemesters) ? user.mentorSemesters.map(Number) : [];
        mentorCourseEl.value = courses[0] || "";
        applyMentorSemesterLimits(mentorCourseEl.value);
        mentorSemEls.forEach((el) => {
          const value = Number(el.value);
          if (!el.disabled) el.checked = semesters.includes(value);
        });
        mentorCourseEl.onchange = () => applyMentorSemesterLimits(mentorCourseEl.value);
      }
    }

    const designationEl = document.getElementById("facultyDesignationInput");
    const departmentEl = document.getElementById("facultyDepartmentInput");
    const contactEl = document.getElementById("facultyContactInput");
    const cabinEl = document.getElementById("facultyCabinInput");
    const aboutEl = document.getElementById("facultyAboutInput");
    if (facultyDetailsSection && designationEl && departmentEl && contactEl && cabinEl && aboutEl) {
      facultyDetailsSection.classList.toggle("d-none", !isAdminRole);
      if (isAdminRole) {
        const d = user.facultyDetails || {};
        designationEl.value = d.designation || "";
        departmentEl.value = d.department || "";
        contactEl.value = d.contactNumber || "";
        cabinEl.value = d.cabin || "";
        aboutEl.value = d.about || "";
      }
    }
  } catch (err) {
    profileData.innerHTML = `<p>${err.message}</p>`;
  }
}

async function saveStudentAcademicDetails() {
  const semesterEl = document.getElementById("studentSemesterInput");
  if (!semesterEl) return;

  if (!semesterEl.value) {
    alert("Please select semester");
    return;
  }

  try {
    await apiRequest("/auth/me/student-details", {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ semester: Number(semesterEl.value) })
    });
    alert("Academic details updated");
    await loadProfile();
  } catch (err) {
    alert(err.message);
  }
}

async function saveProfileDetails() {
  const nameInput = document.getElementById("profileNameInput");
  const usernameInput = document.getElementById("profileUsernameInput");
  const passwordInput = document.getElementById("profilePasswordInput");
  if (!nameInput || !usernameInput || !passwordInput) return;

  const payload = {
    name: nameInput.value.trim(),
    username: usernameInput.value.trim().toLowerCase()
  };

  if (!payload.name || !payload.username) {
    alert("Name and username are required");
    return;
  }

  if (passwordInput.value.trim()) {
    payload.password = passwordInput.value.trim();
  }

  try {
    const data = await apiRequest("/auth/me", {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });

    if (data && data.user) {
      localStorage.setItem("userName", data.user.name || payload.name);
      localStorage.setItem("userEmail", data.user.email || payload.username);
    }
    passwordInput.value = "";
    alert("Profile updated");
    await loadProfile();
  } catch (err) {
    alert(err.message);
  }
}

async function saveFacultyDetails() {
  const designationEl = document.getElementById("facultyDesignationInput");
  const departmentEl = document.getElementById("facultyDepartmentInput");
  const contactEl = document.getElementById("facultyContactInput");
  const cabinEl = document.getElementById("facultyCabinInput");
  const aboutEl = document.getElementById("facultyAboutInput");
  if (!designationEl || !departmentEl || !contactEl || !cabinEl || !aboutEl) return;

  const payload = {
    designation: designationEl.value.trim(),
    department: departmentEl.value.trim(),
    contactNumber: contactEl.value.trim(),
    cabin: cabinEl.value.trim(),
    about: aboutEl.value.trim()
  };

  try {
    await apiRequest("/auth/me/faculty-details", {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });
    alert("Faculty details updated");
    await loadProfile();
  } catch (err) {
    alert(err.message);
  }
}

function managedUsersTableRow(user) {
  const roleOptions = ["student", "admin", "master_admin"]
    .map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${role}</option>`)
    .join("");

  const protectedDelete = user.role === "master_admin" ? "disabled" : "";
  const rowMaxSemester = maxSemesterByCourse(user.course || "");

  return `
    <tr data-user-id="${user.id}">
      <td><input class="form-control form-control-sm ma-name" value="${escapeHtml(user.name || "")}"></td>
      <td><input class="form-control form-control-sm ma-username" value="${escapeHtml(user.username || "")}"></td>
      <td>
        <select class="form-select form-select-sm ma-role">
          ${roleOptions}
        </select>
      </td>
      <td><span class="badge text-bg-light border">${escapeHtml(user.course || "-")}</span></td>
      <td><input class="form-control form-control-sm ma-semester" type="number" min="1" max="${rowMaxSemester}" value="${escapeHtml(String(user.semester || ""))}" placeholder="1-${rowMaxSemester}"></td>
      <td><input class="form-control form-control-sm ma-password" type="password" placeholder="Leave blank"></td>
      <td class="d-flex flex-wrap gap-2">
        <button class="btn btn-sm btn-success" onclick="saveManagedUser('${user.id}')">Save</button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteManagedUser('${user.id}')" ${protectedDelete}>Delete</button>
      </td>
    </tr>
  `;
}

function onNewUserRoleChange() {
  const roleEl = document.getElementById("newUserRole");
  const semesterEl = document.getElementById("newUserSemester");
  const usernameEl = document.getElementById("newUsername");
  if (!roleEl || !semesterEl || !usernameEl) return;
  const course = deriveCourseFromUsernameClient(usernameEl.value);
  const maxAllowed = maxSemesterByCourse(course);
  semesterEl.max = String(maxAllowed);
  semesterEl.placeholder = `Semester (1-${maxAllowed}, course-wise)`;
  semesterEl.disabled = roleEl.value !== "student";
  if (semesterEl.disabled) semesterEl.value = "";
  if (semesterEl.value && Number(semesterEl.value) > maxAllowed) {
    semesterEl.value = "";
  }
}

async function createManagedUser() {
  const nameEl = document.getElementById("newUserName");
  const usernameEl = document.getElementById("newUsername");
  const roleEl = document.getElementById("newUserRole");
  const semesterEl = document.getElementById("newUserSemester");
  const passwordEl = document.getElementById("newUserPassword");
  if (!nameEl || !usernameEl || !roleEl || !semesterEl || !passwordEl) return;

  const name = nameEl.value.trim();
  const username = usernameEl.value.trim().toLowerCase();
  const role = roleEl.value;
  const password = passwordEl.value;
  const semester = semesterEl.value ? Number(semesterEl.value) : null;

  if (!name || !username || !password) {
    alert("Name, username and password are required");
    return;
  }

  if (role === "student" && !isValidStudentUsernameFormat(username)) {
    alert("Student username format invalid. Use 21bca56051, 22bsccs55005, or 23mscit56012.");
    return;
  }

  if (role === "student" && semester !== null) {
    const course = deriveCourseFromUsernameClient(username);
    const maxAllowed = maxSemesterByCourse(course);
    if (semester < 1 || semester > maxAllowed) {
      alert(`For ${course || "student course"}, semester must be between 1 and ${maxAllowed}.`);
      return;
    }
  }

  try {
    await apiRequest("/admin/users", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name, username, role, semester, password })
    });
    nameEl.value = "";
    usernameEl.value = "";
    passwordEl.value = "";
    roleEl.value = "student";
    semesterEl.value = "";
    onNewUserRoleChange();
    alert("User created");
    await loadManagedUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function loadManagedUsers() {
  const section = document.getElementById("masterAdminSection");
  const body = document.getElementById("managedUsersBody");
  if (!section || !body) return;

  if (!isMasterAdminUser()) {
    section.classList.add("d-none");
    return;
  }

  section.classList.remove("d-none");
  body.innerHTML = '<tr><td colspan="7" class="text-muted">Loading users...</td></tr>';

  try {
    const users = await apiRequest("/admin/users", { headers: authHeaders() });
    body.innerHTML = users.length
      ? users.map((user) => managedUsersTableRow(user)).join("")
      : '<tr><td colspan="7" class="text-muted">No users found</td></tr>';
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function saveManagedUser(userId) {
  const row = document.querySelector(`tr[data-user-id="${userId}"]`);
  if (!row) return;

  const nameEl = row.querySelector(".ma-name");
  const usernameEl = row.querySelector(".ma-username");
  const roleEl = row.querySelector(".ma-role");
  const semesterEl = row.querySelector(".ma-semester");
  const passwordEl = row.querySelector(".ma-password");

  if (!nameEl || !usernameEl || !roleEl || !passwordEl || !semesterEl) return;

  const payload = {
    name: nameEl.value.trim(),
    username: usernameEl.value.trim(),
    role: roleEl.value,
    semester: semesterEl.value ? Number(semesterEl.value) : null
  };

  if (payload.role === "student" && payload.semester !== null) {
    const course = deriveCourseFromUsernameClient(payload.username);
    const maxAllowed = maxSemesterByCourse(course);
    if (payload.semester < 1 || payload.semester > maxAllowed) {
      alert(`For ${course || "student course"}, semester must be between 1 and ${maxAllowed}.`);
      return;
    }
  }

  if (passwordEl.value.trim()) {
    payload.password = passwordEl.value.trim();
  }

  try {
    await apiRequest(`/admin/users/${userId}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });
    alert("User updated");
    await loadManagedUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteManagedUser(userId) {
  if (!confirm("Delete this user account?")) return;

  try {
    await apiRequest(`/admin/users/${userId}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    alert("User deleted");
    await loadManagedUsers();
  } catch (err) {
    alert(err.message);
  }
}

function toggleSidebar() {
  const sidebar = document.querySelector(".portal-sidebar");
  const overlay = document.querySelector(".sidebar-overlay");
  if (sidebar) sidebar.classList.toggle("show-sidebar");
  if (overlay) overlay.classList.toggle("show");
}

function injectSidebar() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  const token = getToken();
  if (!token || !isProtectedPage(page) || page === "dashboard.html") return;

  const body = document.body;
  if (body.querySelector(".portal-layout-wrapper")) return;

  const layoutWrapper = document.createElement("div");
  layoutWrapper.className = "portal-layout-wrapper";

  const mainWrapper = document.createElement("div");
  mainWrapper.className = "portal-main-wrapper";

  // Create mobile top nav
  const mobileTopNav = document.createElement("div");
  mobileTopNav.className = "mobile-top-nav d-lg-none d-flex align-items-center justify-content-between";
  mobileTopNav.innerHTML = `
    <div class="d-flex align-items-center">
      <button class="sidebar-toggle-btn me-3" onclick="toggleSidebar()"><i class="bi bi-list"></i></button>
      <h5 class="m-0 fw-bold" style="color: var(--portal-navy); font-size: 1.15rem;">SMMPISR-SVKMICS</h5>
    </div>
  `;
  mainWrapper.appendChild(mobileTopNav);

  // Overlay for mobile
  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  overlay.onclick = toggleSidebar;
  body.appendChild(overlay);

  // Move existing children to main wrapper
  const children = Array.from(body.children);
  children.forEach(child => {
    if (child.tagName !== "SCRIPT" && child.id !== "interventionModalBackdrop" && child !== overlay && !child.classList.contains("sidebar-overlay")) {
      mainWrapper.appendChild(child);
    }
  });

  const role = localStorage.getItem("role") || "student";
  const userName = localStorage.getItem("userName") || "User";
  const initials = userName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const displayRole = role.replace("_", " ");

  const sidebar = document.createElement("aside");
  sidebar.className = "portal-sidebar";

  let menuItemsHtml = "";

  if (role === "student") {
    menuItemsHtml = `
      <li class="sidebar-menu-category">Main</li>
      <li class="sidebar-item">
        <a href="student-dashboard.html" class="sidebar-link ${page === 'student-dashboard.html' && !window.location.search ? 'active' : ''}">
          <i class="bi bi-speedometer2"></i> Dashboard
        </a>
      </li>
      <li class="sidebar-menu-category">Workspace Tabs</li>
      <li class="sidebar-item">
        <a href="student-dashboard.html?tab=studentUploadPane" class="sidebar-link ${window.location.search.includes('studentUploadPane') ? 'active' : ''}">
          <i class="bi bi-upload"></i> Upload Assignment
        </a>
      </li>
      <li class="sidebar-item">
        <a href="student-dashboard.html?tab=studentFilesPane" class="sidebar-link ${window.location.search.includes('studentFilesPane') ? 'active' : ''}">
          <i class="bi bi-file-earmark-text"></i> My Files & Docs
        </a>
      </li>
      <li class="sidebar-item">
        <a href="student-dashboard.html?tab=studentQuizPane" class="sidebar-link ${window.location.search.includes('studentQuizPane') ? 'active' : ''}">
          <i class="bi bi-journal-check"></i> Take Quiz
        </a>
      </li>
      <li class="sidebar-item">
        <a href="student-dashboard.html?tab=studentPracticalPane" class="sidebar-link ${window.location.search.includes('studentPracticalPane') ? 'active' : ''}">
          <i class="bi bi-pc-display-horizontal"></i> Practical Exam
        </a>
      </li>
      <li class="sidebar-menu-category">Feed & Tools</li>
      <li class="sidebar-item">
        <a href="student-dashboard.html?tab=studentTimelinePane" class="sidebar-link ${window.location.search.includes('studentTimelinePane') ? 'active' : ''}">
          <i class="bi bi-clock-history"></i> Academic Timeline
        </a>
      </li>
      <li class="sidebar-item">
        <a href="student-dashboard.html?tab=studentNoticesPane" class="sidebar-link ${window.location.search.includes('studentNoticesPane') ? 'active' : ''}">
          <i class="bi bi-megaphone"></i> Notice Board
        </a>
      </li>
      <li class="sidebar-item">
        <a href="student-dashboard.html?tab=studentCalendarPane" class="sidebar-link ${window.location.search.includes('studentCalendarPane') ? 'active' : ''}">
          <i class="bi bi-calendar-event"></i> Academic Calendar
        </a>
      </li>
      <li class="sidebar-item">
        <a href="marks.html" class="sidebar-link ${page === 'marks.html' ? 'active' : ''}">
          <i class="bi bi-award"></i> My Marks
        </a>
      </li>
      <li class="sidebar-menu-category">User</li>
      <li class="sidebar-item">
        <a href="profile.html" class="sidebar-link ${page === 'profile.html' ? 'active' : ''}">
          <i class="bi bi-person-circle"></i> My Profile
        </a>
      </li>
    `;
  } else {
    menuItemsHtml = `
      <li class="sidebar-menu-category">Main</li>
      <li class="sidebar-item">
        <a href="admin-dashboard.html" class="sidebar-link ${page === 'admin-dashboard.html' && !window.location.search ? 'active' : ''}">
          <i class="bi bi-speedometer2"></i> Dashboard
        </a>
      </li>
      <li class="sidebar-menu-category">Workbench Tabs</li>
      <li class="sidebar-item">
        <a href="admin-dashboard.html?tab=adminNoticePane" class="sidebar-link ${window.location.search.includes('adminNoticePane') ? 'active' : ''}">
          <i class="bi bi-megaphone"></i> Post Notice
        </a>
      </li>
      <li class="sidebar-item">
        <a href="admin-dashboard.html?tab=adminMarksPane" class="sidebar-link ${window.location.search.includes('adminMarksPane') ? 'active' : ''}">
          <i class="bi bi-award"></i> Add Marks
        </a>
      </li>
      <li class="sidebar-item">
        <a href="admin-dashboard.html?tab=adminUploadPane" class="sidebar-link ${window.location.search.includes('adminUploadPane') ? 'active' : ''}">
          <i class="bi bi-file-earmark-arrow-up"></i> Upload Document
        </a>
      </li>
      <li class="sidebar-item">
        <a href="admin-dashboard.html?tab=adminFilesPane" class="sidebar-link ${window.location.search.includes('adminFilesPane') ? 'active' : ''}">
          <i class="bi bi-folder2-open"></i> Faculty Files
        </a>
      </li>
      <li class="sidebar-item">
        <a href="admin-dashboard.html?tab=adminAttendancePane" class="sidebar-link ${window.location.search.includes('adminAttendancePane') ? 'active' : ''}">
          <i class="bi bi-calendar-check"></i> Attendance Import
        </a>
      </li>
      <li class="sidebar-item">
        <a href="admin-dashboard.html?tab=adminAssignmentPlannerPane" class="sidebar-link ${window.location.search.includes('adminAssignmentPlannerPane') ? 'active' : ''}">
          <i class="bi bi-calendar-date"></i> Assignment Planner
        </a>
      </li>
      <li class="sidebar-item">
        <a href="admin-dashboard.html?tab=adminQuizPane" class="sidebar-link ${window.location.search.includes('adminQuizPane') ? 'active' : ''}">
          <i class="bi bi-journal-text"></i> Quiz Manager
        </a>
      </li>
      <li class="sidebar-item">
        <a href="admin-dashboard.html?tab=adminPracticalExamPane" class="sidebar-link ${window.location.search.includes('adminPracticalExamPane') ? 'active' : ''}">
          <i class="bi bi-pc-display"></i> Practical Exams
        </a>
      </li>
      <li class="sidebar-menu-category">Feed & Tools</li>
      <li class="sidebar-item">
        <a href="admin-dashboard.html?tab=adminNoticesPane" class="sidebar-link ${window.location.search.includes('adminNoticesPane') ? 'active' : ''}">
          <i class="bi bi-megaphone"></i> Notice Board
        </a>
      </li>
      <li class="sidebar-menu-category">User</li>
      <li class="sidebar-item">
        <a href="profile.html" class="sidebar-link ${page === 'profile.html' ? 'active' : ''}">
          <i class="bi bi-person-circle"></i> My Profile
        </a>
      </li>
    `;
  }

  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <div class="sidebar-brand-title">College Portal</div>
      <div class="sidebar-brand-subtitle">SMMPISR-SVKMICS</div>
    </div>
    <div class="sidebar-user">
      <div class="sidebar-user-avatar">${initials}</div>
      <div class="sidebar-user-info">
        <div class="sidebar-user-name">${userName}</div>
        <div class="sidebar-user-role">${displayRole}</div>
      </div>
    </div>
    <ul class="sidebar-menu">
      ${menuItemsHtml}
    </ul>
    <div class="sidebar-footer">
      <button class="btn btn-outline-danger w-100 d-flex align-items-center justify-content-center gap-2" onclick="logout()">
        <i class="bi bi-box-arrow-left"></i> Logout
      </button>
    </div>
  `;

  layoutWrapper.appendChild(sidebar);
  layoutWrapper.appendChild(mainWrapper);
  body.appendChild(layoutWrapper);

  const sidebarLinks = sidebar.querySelectorAll(".sidebar-link");
  sidebarLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      const isDashboardHome = href && !href.includes("?tab=") && (href.includes("student-dashboard.html") || href.includes("admin-dashboard.html"));
      
      if (href && href.startsWith(page) && (href.includes("?tab=") || isDashboardHome)) {
        e.preventDefault();
        const tabId = href.includes("?tab=") ? new URLSearchParams(href.split("?")[1]).get("tab") : "home";
        activateTabPaneDirectly(tabId);
        
        const sidebarEl = document.querySelector(".portal-sidebar");
        const overlayEl = document.querySelector(".sidebar-overlay");
        if (sidebarEl && sidebarEl.classList.contains("show-sidebar")) {
          sidebarEl.classList.remove("show-sidebar");
        }
        if (overlayEl && overlayEl.classList.contains("show")) {
          overlayEl.classList.remove("show");
        }
      }
    });
  });
}

function activateTabPaneDirectly(tabId) {
  const container = document.querySelector("[data-tab-container]");
  
  const studentHomePanels = document.querySelectorAll(".student-home-panel");
  const adminHomePanels = document.querySelectorAll(".admin-home-panel");
  
  const isHome = !tabId || tabId === "home";
  
  if (isHome) {
    studentHomePanels.forEach((el) => {
      if (el.id !== "noticeCenterPanel") {
        el.classList.remove("d-none");
      }
    });
    adminHomePanels.forEach((el) => {
      if (el.id !== "noticeCenterPanel" && el.id !== "masterAdminSection" && el.id !== "masterAdminReportsSection") {
        el.classList.remove("d-none");
      }
    });
    
    if (container) container.classList.add("d-none");
    
    // Sync active class in sidebar links
    const sidebar = document.querySelector(".portal-sidebar");
    if (sidebar) {
      sidebar.querySelectorAll(".sidebar-link").forEach(link => {
        const href = link.getAttribute("href");
        const isDashboardLink = href && !href.includes("?tab=") && (href.includes("student-dashboard.html") || href.includes("admin-dashboard.html"));
        link.classList.toggle("active", !!isDashboardLink);
      });
    }
    
    const newUrl = window.location.pathname;
    window.history.replaceState({ path: newUrl }, '', newUrl);
    return;
  }
  
  // Tab view: hide all home panels, show container
  studentHomePanels.forEach((el) => el.classList.add("d-none"));
  adminHomePanels.forEach((el) => el.classList.add("d-none"));
  if (container) container.classList.remove("d-none");

  if (!container) return;
  const tabButtons = [...container.querySelectorAll("[data-tab-btn]")];
  const tabPanes = [...container.querySelectorAll("[data-tab-pane]")];
  if (!tabPanes.length) return;

  tabButtons.forEach((btn) => {
    const isActive = btn.getAttribute("data-tab-target") === tabId;
    btn.classList.toggle("btn-primary", isActive);
    btn.classList.toggle("btn-outline-primary", !isActive);
  });

  tabPanes.forEach((pane) => {
    const isActive = pane.id === tabId;
    pane.classList.toggle("d-none", !isActive);
    if (isActive && pane.id === 'adminQuizPane') {
      showQuizManager();
    }
    if (isActive && pane.id === 'studentCalendarPane') {
      renderCalendar();
    }
  });

  // Sync active class in sidebar links if sidebar is present
  const sidebar = document.querySelector(".portal-sidebar");
  if (sidebar) {
    sidebar.querySelectorAll(".sidebar-link").forEach(link => {
      const href = link.getAttribute("href");
      const isActive = href && href.includes(`?tab=${tabId}`);
      link.classList.toggle("active", !!isActive);
    });
  }

  const newUrl = `${window.location.pathname}?tab=${tabId}`;
  window.history.replaceState({ path: newUrl }, '', newUrl);
}

function initPage() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  const token = getToken();

  if (!token && isJustLoggedOut() && isProtectedPage(page)) {
    window.location.replace("index.html");
    return;
  }

  // Inject sidebar for protected pages if authenticated
  if (token && isProtectedPage(page)) {
    injectSidebar();
  }

  window.addEventListener("pageshow", () => {
    const activePage = window.location.pathname.split("/").pop() || "index.html";
    if (!getToken() && isJustLoggedOut() && isProtectedPage(activePage)) {
      window.location.replace("index.html");
    }
  });

  if (page === "index.html" || page === "") {
    loadNotices();
  }
  if (page === "register.html") {
    const usernameEl = document.getElementById("username") || document.getElementById("email");
    if (usernameEl) {
      usernameEl.addEventListener("input", onRegisterUsernameChange);
    }
    onRegisterUsernameChange();
  }
  if (page === "login.html") {
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        login();
      });
    }
  }
  if (page === "dashboard.html") {
    const role = localStorage.getItem("role");
    if (!getToken()) {
      window.location = "login.html";
      return;
    }
    const isAdminRole = role === "admin" || role === "master_admin";
    window.location = isAdminRole ? "admin-dashboard.html" : "student-dashboard.html";
  }
  if (page === "student-dashboard.html") {
    if (requireAuth(["student"])) {
      initDashboardTabContainers();
      updateStudentGreeting();
      preloadStudentDashboardData().then(() => {
        loadFiles();
        loadStudentAssignmentDeadlines();
        loadNotices().finally(() => {
          loadStudentActionCenter();
        });
        loadLinkedFacultyDetails();
        loadStudentAttendance();
        loadStudentQuizzes();
        loadStudentTimeline();
      });
      const quizAnswerInput = document.getElementById("studentQuizAnswerInput");
      if (quizAnswerInput) {
        quizAnswerInput.addEventListener("input", () => {
          saveCurrentQuizAnswerToState();
          renderStudentQuizReview();
        });
      }
    }
  }
  if (page === "admin-dashboard.html") {
    if (requireAuth(["admin"])) {
      initDashboardTabContainers();
      updateAdminGreeting();
      onQuizQuestionTypeChange();
      renderDraftQuizQuestions();
      const targetCourseEl = document.getElementById("targetCourse");
      if (targetCourseEl) targetCourseEl.addEventListener("change", onNoticeScopeChange);
      const newUsernameEl = document.getElementById("newUsername");
      if (newUsernameEl) newUsernameEl.addEventListener("input", onNewUserRoleChange);
      onNoticeScopeChange();
      onNewUserRoleChange();
      syncAdminData({ silent: true });
      loadNotices();
      const masterAdmin = isMasterAdminUser();
      const menteesSection = document.getElementById("myMenteesSection");
      if (menteesSection) {
        menteesSection.classList.toggle("d-none", masterAdmin);
      }
      if (masterAdmin) {
        loadMasterAdminReports();
      } else {
        loadMentees();
      }
      loadAdminAttendance();
      loadAdminQuizzes();
      loadManagedUsers();
      loadAtRiskStudents();
      loadAssignmentDeadlinesAdmin();
      const modalBackdrop = document.getElementById("interventionModalBackdrop");
      if (modalBackdrop) {
        modalBackdrop.addEventListener("click", (event) => {
          if (event.target === modalBackdrop) {
            closeInterventionModal();
          }
        });
      }
    }
  }
  if (page === "marks.html") {
    if (requireAuth(["student"])) {
      loadMyMarks();
    }
  }
  if (page === "profile.html") {
    if (requireAuth()) {
      loadProfile();
    }
  }
  if (page === "notices.html") {
    if (requireAuth()) {
      loadNotices();
    }
  }
  if (page === "timeline.html") {
    if (requireAuth(["student"])) {
      loadStudentTimeline();
    }
  }
}

let currentCalendarYear = new Date().getFullYear();
let currentCalendarMonth = new Date().getMonth();

function navigateCalendarMonth(delta) {
  currentCalendarMonth += delta;
  if (currentCalendarMonth < 0) {
    currentCalendarMonth = 11;
    currentCalendarYear -= 1;
  } else if (currentCalendarMonth > 11) {
    currentCalendarMonth = 0;
    currentCalendarYear += 1;
  }
  renderCalendar();
}

function renderCalendar() {
  const monthLabel = document.getElementById("calendarMonthYearLabel");
  const gridBody = document.getElementById("calendarGridBody");
  if (!monthLabel || !gridBody) return;

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  monthLabel.textContent = `${monthNames[currentCalendarMonth]} ${currentCalendarYear}`;

  const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();
  const totalDays = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
  const events = studentTimelineCache || [];
  
  let html = "";
  let day = 1;
  const today = new Date();

  for (let i = 0; i < 6; i++) {
    if (day > totalDays) break;

    html += "<tr>";
    for (let j = 0; j < 7; j++) {
      if (i === 0 && j < firstDay) {
        html += "<td class='bg-light text-muted' style='height: 100px;'></td>";
      } else if (day > totalDays) {
        html += "<td class='bg-light text-muted' style='height: 100px;'></td>";
      } else {
        const isToday = today.getDate() === day && today.getMonth() === currentCalendarMonth && today.getFullYear() === currentCalendarYear;
        const cellClass = `calendar-day-cell${isToday ? ' today' : ''}`;
        const dayEvents = events.filter(e => {
          if (!e.ts) return false;
          const eDate = new Date(e.ts);
          return eDate.getDate() === day && eDate.getMonth() === currentCalendarMonth && eDate.getFullYear() === currentCalendarYear;
        });

        let eventsHtml = "";
        dayEvents.forEach(e => {
          let indicatorClass = "event-notice";
          if (e.type === "deadline") indicatorClass = "event-deadline";
          if (e.type === "quiz") indicatorClass = "event-quiz";
          if (e.type === "marks") indicatorClass = "event-marks";
          if (e.type === "attendance") indicatorClass = "event-attendance";

          eventsHtml += `
            <div class="calendar-event-indicator ${indicatorClass}" title="${escapeHtml(e.title)}: ${escapeHtml(e.message)}">
              ${escapeHtml(e.title)}
            </div>
          `;
        });

        html += `
          <td class="${cellClass}">
            <div class="calendar-day-number">${day}</div>
            <div style="max-height: 70px; overflow-y: auto;">${eventsHtml}</div>
          </td>
        `;
        day += 1;
      }
    }
    html += "</tr>";
  }

  gridBody.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", initPage);
