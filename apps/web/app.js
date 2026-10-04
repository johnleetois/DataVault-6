/**
 * DATAVAULT6 - Frontend Client Application
 * Real Backend API Integration, Operational Activity Logging & Data Management
 */

(function () {
  "use strict";

  // =========================================================================
  // 1. CENTRALIZED API CLIENT
  // =========================================================================

  const STORAGE_KEY_TOKEN = "datavault6_access_token";
  const STORAGE_KEY_USER = "datavault6_user";

  const apiClient = {
    getToken() {
      return localStorage.getItem(STORAGE_KEY_TOKEN) || "";
    },

    setToken(token) {
      if (token) {
        localStorage.setItem(STORAGE_KEY_TOKEN, token);
      } else {
        localStorage.removeItem(STORAGE_KEY_TOKEN);
      }
    },

    getUser() {
      try {
        const u = localStorage.getItem(STORAGE_KEY_USER);
        return u ? JSON.parse(u) : null;
      } catch {
        return null;
      }
    },

    setUser(user) {
      if (user) {
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
      } else {
        localStorage.removeItem(STORAGE_KEY_USER);
      }
    },

    clearAuth() {
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      localStorage.removeItem(STORAGE_KEY_USER);
    },

    async request(endpoint, options = {}) {
      const headers = new Headers(options.headers || {});
      const token = this.getToken();
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
      }

      const fetchOptions = {
        ...options,
        headers,
        credentials: "include"
      };

      let response;
      try {
        response = await fetch(endpoint, fetchOptions);
      } catch (networkError) {
        console.error("Network error:", networkError);
        throw new Error("Unable to connect to the DataVault6 server. Please check your connection.");
      }

      // Handle 401 Unauthorized with token refresh attempt
      if (response.status === 401 && !options._isRetry && !endpoint.includes("/auth/")) {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          options._isRetry = true;
          return this.request(endpoint, options);
        } else {
          this.clearAuth();
          AuthManager.showLoginModal();
          throw new Error("Session expired. Please sign in again.");
        }
      }

      if (!response.ok) {
        let errorData = null;
        try {
          errorData = await response.json();
        } catch {
          // Non-JSON response
        }
        const message = errorData?.error?.message || errorData?.message || `Request failed with status ${response.status}`;
        const err = new Error(message);
        (err).status = response.status;
        (err).data = errorData;
        throw err;
      }

      if (response.status === 204) {
        return null;
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return response.json();
      }
      return response.blob();
    },

    async refreshToken() {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include"
        });
        if (res.ok) {
          const data = await res.json();
          if (data.accessToken) {
            this.setToken(data.accessToken);
            if (data.user) this.setUser(data.user);
            return true;
          }
        }
      } catch {
        // Refresh failed
      }
      return false;
    }
  };

  // =========================================================================
  // 2. TOAST NOTIFICATIONS
  // =========================================================================

  function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const iconSvg = type === "error"
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F43F5E" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;

    toast.innerHTML = `
      ${iconSvg}
      <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function escapeHtml(text) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function timeAgo(dateInput) {
    if (!dateInput) return "Recently";
    const date = new Date(dateInput);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // =========================================================================
  // 3. AUTHENTICATION & SESSION MANAGER
  // =========================================================================

  const AuthManager = {
    currentUser: null,
    dashboardLoaded: false,
    greetingTimer: null,

    async init() {
      this.bindEvents();
      this.updateGreeting(this.currentUser);
      if (!this.greetingTimer) {
        this.greetingTimer = setInterval(() => {
          this.updateGreeting(this.currentUser);
        }, 30000);
      }
      const params = new URLSearchParams(window.location.search);
      const hasVerifyToken = params.has("token") || window.location.pathname.includes("verify-email");

      // Try to fetch current user profile
      try {
        const user = await apiClient.request("/api/auth/me");
        this.setUser(user);
        this.showAppLayout();
      } catch {
        this.currentUser = null;
        if (!hasVerifyToken) {
          this.showLoginScreen();
        } else {
          this.hideAppLayout();
        }
      }
    },

    getDisplayName(user) {
      if (!user) return "User";
      if (user.name && String(user.name).trim()) {
        return String(user.name).trim();
      }
      if (user.role === "SUPER_ADMIN") {
        return "Super Admin";
      }
      if (user.email) {
        const local = String(user.email).split("@")[0] || "Admin";
        return local.charAt(0).toUpperCase() + local.slice(1);
      }
      return "Admin";
    },

    getTimeOfDayGreeting() {
      const hour = new Date().getHours();
      if (hour < 12) return "Good morning";
      if (hour < 18) return "Good afternoon";
      return "Good evening";
    },

    updateGreeting(user = this.currentUser) {
      const greetingEl = document.getElementById("heroGreeting") || document.querySelector(".hero-greeting");
      if (!greetingEl) return;
      const timeGreeting = this.getTimeOfDayGreeting();
      const displayName = this.getDisplayName(user);
      greetingEl.textContent = `${timeGreeting}, ${displayName}!`;
    },

    setUser(user) {
      this.currentUser = user;
      apiClient.setUser(user);
      this.updateProfileUI(user);
      this.updateGreeting(user);
    },

    updateProfileUI(user) {
      if (!user) return;
      const displayName = this.getDisplayName(user);
      const roleName = user.role === "SUPER_ADMIN" ? "Super Administrator" : "Data Administrator";
      const initials = displayName
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || displayName.slice(0, 2).toUpperCase();

      const nameEl = document.getElementById("userDisplayName");
      const roleEl = document.getElementById("userDisplayRole");
      const initialsEl = document.getElementById("userAvatarInitials");
      const menuNameEl = document.getElementById("menuUserName");
      const menuEmailEl = document.getElementById("menuUserEmail");

      if (nameEl) nameEl.textContent = displayName;
      if (roleEl) roleEl.textContent = roleName;
      if (initialsEl) initialsEl.textContent = initials;
      if (menuNameEl) menuNameEl.textContent = displayName;
      if (menuEmailEl) menuEmailEl.textContent = user.email || "";
    },

    showAppLayout() {
      const loginScreen = document.getElementById("loginScreen");
      const appLayout = document.getElementById("appLayout");
      if (loginScreen) loginScreen.style.display = "none";
      if (appLayout) appLayout.style.display = "flex";

      this.updateGreeting(this.currentUser);

      // Load data only after authentication
      if (!this.dashboardLoaded) {
        this.dashboardLoaded = true;
        DashboardManager.init();
        DatasetsManager.init();
        ActivityLogsManager.init();
        NotificationsManager.init();
      } else {
        DashboardManager.loadStats();
        DatasetsManager.loadDatasets();
        ActivityLogsManager.loadRecentActivity();
        NotificationsManager.loadNotifications();
      }
    },

    showLoginScreen() {
      const loginScreen = document.getElementById("loginScreen");
      const appLayout = document.getElementById("appLayout");
      if (appLayout) appLayout.style.display = "none";
      if (loginScreen) {
        loginScreen.style.display = "flex";
        const emailInput = document.getElementById("loginEmailInput");
        const pwdInput = document.getElementById("loginPasswordInput");
        const errorMsg = document.getElementById("loginErrorMsg");
        if (errorMsg) errorMsg.style.display = "none";
        if (pwdInput) pwdInput.value = "";
        if (emailInput && !emailInput.value) emailInput.focus();
      }
    },

    showLoginModal() {
      this.showLoginScreen();
    },

    hideLoginModal() {
      if (this.currentUser) {
        this.showAppLayout();
      }
    },

    hideAppLayout() {
      const appLayout = document.getElementById("appLayout");
      if (appLayout) appLayout.style.display = "none";
    },

    bindEvents() {
      const chip = document.getElementById("userProfileChip");
      const menu = document.getElementById("profileDropdownMenu");
      const btnLogout = document.getElementById("btnLogout");
      const btnOpenLogin = document.getElementById("btnOpenLoginModal");
      const loginForm = document.getElementById("mainLoginForm");
      const btnTogglePwd = document.getElementById("btnToggleLoginPwd");

      if (btnTogglePwd) {
        btnTogglePwd.addEventListener("click", () => {
          const pwdInput = document.getElementById("loginPasswordInput");
          const eyeOpen = document.getElementById("iconEyeOpen");
          const eyeClosed = document.getElementById("iconEyeClosed");
          if (!pwdInput) return;
          if (pwdInput.type === "password") {
            pwdInput.type = "text";
            if (eyeOpen) eyeOpen.style.display = "none";
            if (eyeClosed) eyeClosed.style.display = "block";
          } else {
            pwdInput.type = "password";
            if (eyeOpen) eyeOpen.style.display = "block";
            if (eyeClosed) eyeClosed.style.display = "none";
          }
        });
      }

      if (chip && menu) {
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          menu.classList.toggle("active");
        });

        document.addEventListener("click", (e) => {
          if (!chip.contains(e.target)) {
            menu.classList.remove("active");
          }
        });
      }

      if (btnOpenLogin) {
        btnOpenLogin.addEventListener("click", (e) => {
          e.preventDefault();
          if (menu) menu.classList.remove("active");
          this.showLoginScreen();
        });
      }

      if (btnLogout) {
        btnLogout.addEventListener("click", async (e) => {
          e.preventDefault();
          if (menu) menu.classList.remove("active");
          try {
            await apiClient.request("/api/auth/logout", { method: "POST" });
          } catch {
            // ignore
          }
          apiClient.clearAuth();
          this.currentUser = null;
          this.showLoginScreen();
          showToast("Signed out successfully", "info");
        });
      }

      if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          const email = document.getElementById("loginEmailInput")?.value.trim();
          const password = document.getElementById("loginPasswordInput")?.value;
          const errorMsg = document.getElementById("loginErrorMsg");
          const btnSubmit = document.getElementById("btnSubmitLogin");

          if (errorMsg) errorMsg.style.display = "none";
          if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 6px;"></span> Authenticating...`;
          }

          try {
            const result = await apiClient.request("/api/auth/login", {
              method: "POST",
              body: JSON.stringify({ email, password })
            });

            if (result.accessToken) {
              apiClient.setToken(result.accessToken);
              let userProfile = result.user || { email, role: "ADMIN" };
              if (!userProfile.name) {
                try {
                  const meProfile = await apiClient.request("/api/auth/me");
                  if (meProfile) userProfile = { ...userProfile, ...meProfile };
                } catch {
                  // fallback to result.user
                }
              }
              this.setUser(userProfile);
              this.showAppLayout();
              showToast(`Signed in successfully as ${this.getDisplayName(userProfile)}!`);
            }
          } catch (err) {
            if (errorMsg) {
              errorMsg.textContent = err.message || "Invalid credentials. Please verify your email and password.";
              errorMsg.style.display = "flex";
            }
          } finally {
            if (btnSubmit) {
              btnSubmit.disabled = false;
              btnSubmit.innerHTML = `<span>Sign In to Platform</span>`;
            }
          }
        });
      }
    }
  };

  // =========================================================================
  // 4. DASHBOARD & STATS MANAGER
  // =========================================================================

  const DashboardManager = {
    stats: null,
    currentDays: 7,

    async init() {
      this.bindEvents();
      await this.loadStats();
    },

    bindEvents() {
      const periodSelect = document.getElementById("activityPeriodSelect");
      if (periodSelect) {
        periodSelect.addEventListener("change", (e) => {
          this.currentDays = parseInt(e.target.value, 10) || 7;
          this.loadStats();
        });
      }
    },

    formatBytes(bytes) {
      const n = Number(bytes || 0);
      if (!n || n <= 0) return "0 B";
      const units = ["B", "KB", "MB", "GB", "TB"];
      const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
      const val = n / Math.pow(1024, i);
      return `${i === 0 ? Math.round(val) : Number(val.toFixed(1))} ${units[i]}`;
    },

    async loadStats() {
      try {
        const stats = await apiClient.request(`/api/dashboard/stats?days=${this.currentDays}`);
        this.stats = stats;
        this.renderKPIs(stats.kpis);
        this.renderActivityChart(stats.timeline || []);
        this.renderDonutChart(stats.databaseEngines || {}, stats.kpis?.totalDatasets || 0, stats.databaseStorage || {});
        this.renderDatabaseCards(stats.databaseEngines || {}, stats.databaseStorage || {});
      } catch (err) {
        console.error("Failed to load dashboard stats:", err);
      }
    },

    renderKPIs(kpis) {
      if (!kpis) return;
      const totalDatasetsEl = document.getElementById("kpiTotalDatasets");
      const totalContributorsEl = document.getElementById("kpiTotalContributors");
      const categoriesEl = document.getElementById("kpiCategories");
      const totalDownloadsEl = document.getElementById("kpiTotalDownloads");
      const donutTotalEl = document.getElementById("donutTotalDatasets");

      if (totalDatasetsEl) totalDatasetsEl.textContent = Number(kpis.totalDatasets || 0).toLocaleString();
      if (totalContributorsEl) totalContributorsEl.textContent = Number(kpis.totalContributors || 0).toLocaleString();
      if (categoriesEl) categoriesEl.textContent = Number(kpis.categoriesCount || 0).toLocaleString();
      if (totalDownloadsEl) totalDownloadsEl.textContent = Number(kpis.totalDownloads || 0).toLocaleString();
      if (donutTotalEl) donutTotalEl.textContent = Number(kpis.totalDatasets || 0).toLocaleString();
    },

    renderActivityChart(timeline) {
      const container = document.getElementById("activityChartContainer");
      if (!container) return;

      if (!timeline || timeline.length === 0) {
        // Fallback default buckets if no timeline returned
        return;
      }

      const width = 460;
      const height = 210;
      const paddingLeft = 45;
      const paddingRight = 20;
      const paddingTop = 25;
      const paddingBottom = 35;

      const chartW = width - paddingLeft - paddingRight;
      const chartH = height - paddingTop - paddingBottom;

      const counts = timeline.map(t => t.count || 0);
      const maxCount = Math.max(...counts, 10);
      // round max up to next nice round number
      const yMax = Math.ceil(maxCount / 5) * 5;

      const points = timeline.map((item, index) => {
        const x = paddingLeft + (index / Math.max(timeline.length - 1, 1)) * chartW;
        const y = paddingTop + chartH - ((item.count || 0) / yMax) * chartH;
        return { x, y, ...item };
      });

      // SVG path construction
      let linePathD = "";
      points.forEach((p, i) => {
        if (i === 0) {
          linePathD += `M ${p.x} ${p.y}`;
        } else {
          // Smooth curve using cubic bezier
          const prev = points[i - 1];
          const cx1 = prev.x + (p.x - prev.x) / 2;
          const cy1 = prev.y;
          const cx2 = prev.x + (p.x - prev.x) / 2;
          const cy2 = p.y;
          linePathD += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p.x} ${p.y}`;
        }
      });

      const areaPathD = `${linePathD} L ${points[points.length - 1].x} ${paddingTop + chartH} L ${points[0].x} ${paddingTop + chartH} Z`;

      // Y-axis grid lines (4 lines)
      let gridHtml = "";
      for (let i = 0; i <= 3; i++) {
        const val = Math.round((yMax / 3) * (3 - i));
        const y = paddingTop + (chartH / 3) * i;
        gridHtml += `
          <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="var(--grid-color)" stroke-dasharray="3 3"/>
          <text x="8" y="${y + 4}" class="axis-label">${val}</text>
        `;
      }

      // X-axis labels
      let labelsHtml = "";
      // Show at most 7 labels for readability
      const step = Math.ceil(points.length / 7);
      points.forEach((p, i) => {
        if (i % step === 0 || i === points.length - 1) {
          labelsHtml += `<text x="${p.x}" y="${height - 10}" text-anchor="middle" class="axis-label">${escapeHtml(p.label)}</text>`;
        }
      });

      // Dots
      let dotsHtml = "";
      points.forEach((p) => {
        dotsHtml += `
          <circle cx="${p.x}" cy="${p.y}" r="4" class="chart-dot" data-val="${p.count}" data-date="${escapeHtml(p.label)}" style="cursor: pointer; fill: #2563EB; stroke: #FFFFFF; stroke-width: 2; transition: r 0.15s ease;"/>
        `;
      });

      container.innerHTML = `
        <svg class="activity-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="activityGradientReal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3B82F6" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#3B82F6" stop-opacity="0.02"/>
            </linearGradient>
          </defs>
          <g class="grid-lines">
            ${gridHtml}
          </g>
          <path d="${areaPathD}" fill="url(#activityGradientReal)"/>
          <path d="${linePathD}" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-linecap="round"/>
          <g class="x-axis-labels">
            ${labelsHtml}
          </g>
          <g class="dots-group">
            ${dotsHtml}
          </g>
        </svg>
        <div class="chart-tooltip" id="chartTooltip" style="display: none;"></div>
      `;

      // Re-attach interactive tooltips
      const tooltip = document.getElementById("chartTooltip");
      const dots = container.querySelectorAll(".chart-dot");
      dots.forEach(dot => {
        dot.addEventListener("mouseenter", function () {
          if (!tooltip) return;
          const val = this.dataset.val;
          const date = this.dataset.date;
          tooltip.innerHTML = `<strong>${date}</strong>: ${val} activities`;
          tooltip.style.display = "block";

          const rect = this.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          tooltip.style.left = `${rect.left - containerRect.left - 30}px`;
          tooltip.style.top = `${rect.top - containerRect.top - 36}px`;
          this.setAttribute("r", "6");
        });

        dot.addEventListener("mouseleave", function () {
          if (tooltip) tooltip.style.display = "none";
          this.setAttribute("r", "4");
        });
      });
    },

    renderDonutChart(engines, total, storage = {}) {
      const enginesConfig = [
        { key: "MySQL", color: "#2563EB", class: "dot-db01" },
        { key: "SQLServer", color: "#10B981", class: "dot-db02" },
        { key: "PostgreSQL", color: "#06B6D4", class: "dot-db03" },
        { key: "MongoDB", color: "#F43F5E", class: "dot-db04" },
        { key: "Neo4J", color: "#8B5CF6", class: "dot-db05" },
        { key: "CouchBase", color: "#14B8A6", class: "dot-db06" }
      ];

      const circumference = 2 * Math.PI * 54; // ~339.292
      let accumulatedOffset = 0;
      let segmentsSvg = "";
      let legendHtml = "";

      const safeTotal = total > 0 ? total : Object.values(engines).reduce((a, b) => a + Number(b || 0), 0);

      enginesConfig.forEach(cfg => {
        const count = Number(engines[cfg.key] || 0);
        const storageInfo = storage[cfg.key];
        const formattedSize = storageInfo?.formatted || (storageInfo?.bytes !== undefined ? this.formatBytes(storageInfo.bytes) : "0 B");
        const percentage = safeTotal > 0 ? (count / safeTotal) : (1 / 6);
        const pctFormatted = safeTotal > 0 ? Math.round(percentage * 100) : 0;
        const segmentLength = percentage * circumference;
        const gapLength = circumference - segmentLength;

        segmentsSvg += `
          <circle cx="80" cy="80" r="54" fill="none" stroke="${cfg.color}" stroke-width="24"
            stroke-dasharray="${segmentLength.toFixed(1)} ${gapLength.toFixed(1)}"
            stroke-dashoffset="${(-accumulatedOffset).toFixed(1)}"
            class="donut-segment" data-db="${cfg.key}" data-count="${count} (${pctFormatted}%) &bull; ${formattedSize}"
            style="cursor: pointer; transition: stroke-width 0.15s ease;"
          />
        `;

        legendHtml += `
          <div class="legend-row" data-db="${cfg.key}" data-count="${count} (${pctFormatted}%) &bull; ${formattedSize}" style="cursor: pointer;">
            <span class="legend-dot ${cfg.class}"></span>
            <span class="legend-name">${cfg.key}</span>
            <span class="legend-stat">${count} (${pctFormatted}%) &bull; ${formattedSize}</span>
          </div>
        `;

        accumulatedOffset += segmentLength;
      });

      const donutVisualWrap = document.querySelector(".donut-visual-wrap");
      const donutLegend = document.querySelector(".donut-legend");

      if (donutVisualWrap) {
        donutVisualWrap.innerHTML = `
          <svg class="donut-svg" viewBox="0 0 160 160">
            <circle cx="80" cy="80" r="54" fill="none" stroke="#E2E8F0" stroke-width="24"/>
            ${segmentsSvg}
          </svg>
          <div class="donut-center-info">
            <span class="donut-total" id="donutTotalDatasets">${safeTotal.toLocaleString()}</span>
            <span class="donut-sub">Total Datasets</span>
          </div>
        `;
      }

      if (donutLegend) {
        donutLegend.innerHTML = legendHtml;
      }

      // Attach hover tooltips and click-to-open handlers to donut segments and legend rows
      const tooltip = document.getElementById("chartTooltip");
      document.querySelectorAll(".donut-segment, .legend-row").forEach(el => {
        el.style.cursor = "pointer";
        el.addEventListener("mouseenter", function () {
          const db = this.dataset.db;
          const count = this.dataset.count || (engines[db] || 0);
          if (tooltip) {
            tooltip.innerHTML = `<strong>${db}</strong>: ${count} &bull; Click to open screen`;
            tooltip.style.display = "block";
            tooltip.style.left = "45%";
            tooltip.style.top = "40%";
          }
        });
        el.addEventListener("mouseleave", function () {
          if (tooltip) tooltip.style.display = "none";
        });
        el.addEventListener("click", function () {
          const db = this.dataset.db;
          if (db && typeof DatabaseScreenManager !== "undefined") {
            DatabaseScreenManager.openDatabase(db);
          }
        });
      });
    },

    renderDatabaseCards(engines, storage = {}) {
      document.querySelectorAll(".db-card").forEach(card => {
        const dbName = card.dataset.dbName;
        if (!dbName) return;
        const count = Number(engines[dbName] ?? 0);
        const countEl = card.querySelector(".db-card-count");
        if (countEl) {
          countEl.textContent = `${count} ${count === 1 ? "dataset" : "datasets"}`;
        }
        const sizeEl = card.querySelector(".db-card-size");
        if (sizeEl) {
          const storageInfo = storage[dbName];
          const formattedSize = storageInfo?.formatted
            || (storageInfo?.bytes !== undefined ? this.formatBytes(storageInfo.bytes) : "0 B");
          sizeEl.textContent = formattedSize;
        }
      });
    }
  };

  // =========================================================================
  // 5. DATASETS TABLE MANAGER
  // =========================================================================

  const DatasetsManager = {
    items: [],
    bookmarkedIds: new Set(),
    currentPage: 1,
    pageSize: 10,
    totalPages: 1,
    totalCount: 0,
    searchQuery: "",
    categoryFilter: "",
    databaseFilter: "",
    visibilityFilter: "", // "PUBLIC" | "PRIVATE" | ""
    viewMode: "all", // "all" | "mine" | "bookmarked"

    async init() {
      this.bindEvents();
      await this.loadBookmarks();
      await this.loadDatasets();
    },

    async loadBookmarks() {
      try {
        const ids = await apiClient.request("/api/datasets/bookmarked/ids");
        if (Array.isArray(ids)) {
          this.bookmarkedIds = new Set(ids);
        }
      } catch {
        this.bookmarkedIds = new Set();
      }
    },

    async loadDatasets() {
      const tbody = document.getElementById("datasetsTableBody");
      if (tbody) {
        tbody.innerHTML = `
          <tr id="datasetsLoadingRow">
            <td colspan="8" style="text-align: center; padding: 36px; color: var(--text-muted);">
              <span class="spinner" style="border-color: rgba(37,99,235,0.2); border-top-color: var(--primary-600); margin-right: 8px; vertical-align: middle;"></span>
              Loading datasets from DataVault6...
            </td>
          </tr>
        `;
      }

      try {
        const params = new URLSearchParams();
        params.set("page", String(this.currentPage));
        params.set("limit", String(this.pageSize));
        if (this.searchQuery) params.set("search", this.searchQuery);
        if (this.categoryFilter) params.set("category", this.categoryFilter);
        if (this.databaseFilter) params.set("database", this.databaseFilter);
        if (this.visibilityFilter) params.set("visibility", this.visibilityFilter);

        let endpoint = "/api/datasets";
        if (this.viewMode === "mine") {
          endpoint = "/api/datasets/mine";
        } else if (this.viewMode === "bookmarked") {
          endpoint = "/api/datasets/bookmarked";
        }

        const data = await apiClient.request(`${endpoint}?${params.toString()}`);
        this.items = data.items || [];
        this.totalCount = data.total || 0;
        this.totalPages = data.totalPages || 1;
        this.renderTable();
        this.renderPagination();
      } catch (err) {
        console.error("Failed to load datasets:", err);
        if (tbody) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8" style="text-align: center; padding: 30px; color: var(--rose-500);">
                Failed to load datasets. ${escapeHtml(err.message)}
                <div style="margin-top: 8px;">
                  <button class="btn-secondary" id="btnRetryDatasets" style="padding: 4px 12px; font-size: 11px;">Retry</button>
                </div>
              </td>
            </tr>
          `;
          document.getElementById("btnRetryDatasets")?.addEventListener("click", () => this.loadDatasets());
        }
      }
    },

    renderTable() {
      const tbody = document.getElementById("datasetsTableBody");
      if (!tbody) return;

      if (this.items.length === 0) {
        if (this.databaseFilter) {
          const meta = (typeof DB_ENGINE_METADATA !== "undefined" && DB_ENGINE_METADATA[this.databaseFilter]) || {};
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="db-empty-state">
                  <div class="db-empty-icon">${meta.iconSvg || '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>'}</div>
                  <h4 class="db-empty-title">No Datasets Currently Stored in ${escapeHtml(this.databaseFilter)}</h4>
                  <p class="db-empty-desc">Upload a new dataset to run automated schema analysis and deploy it directly into ${escapeHtml(this.databaseFilter)}.</p>
                  <button class="btn-primary" id="btnEmptyUploadTarget" style="padding: 9px 18px; font-size: 13px; font-weight: 700;">
                    + Upload Dataset to ${escapeHtml(this.databaseFilter)}
                  </button>
                </div>
              </td>
            </tr>
          `;
          document.getElementById("btnEmptyUploadTarget")?.addEventListener("click", () => {
            const uploadModal = document.getElementById("uploadModal");
            if (uploadModal) uploadModal.style.display = "flex";
          });
          return;
        }

        if (this.visibilityFilter === "PUBLIC" || (typeof DatabaseScreenManager !== "undefined" && DatabaseScreenManager.activeMode === "explore")) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="db-empty-state">
                  <div class="db-empty-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </div>
                  <h4 class="db-empty-title">No Public Datasets Available</h4>
                  <p class="db-empty-desc">There are no public datasets matching your search or filters. Private and confidential datasets remain strictly protected and omitted.</p>
                  <button class="btn-primary" id="btnEmptyUploadPublic" style="padding: 9px 18px; font-size: 13px; font-weight: 700;">
                    + Upload Public Dataset
                  </button>
                </div>
              </td>
            </tr>
          `;
          document.getElementById("btnEmptyUploadPublic")?.addEventListener("click", () => {
            const uploadModal = document.getElementById("uploadModal");
            if (uploadModal) uploadModal.style.display = "flex";
          });
          return;
        }

        if (this.viewMode === "mine" || (typeof DatabaseScreenManager !== "undefined" && DatabaseScreenManager.activeMode === "mine")) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="db-empty-state">
                  <div class="db-empty-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </div>
                  <h4 class="db-empty-title">No Uploaded Datasets Found</h4>
                  <p class="db-empty-desc">You have not uploaded any datasets yet. Upload a dataset to inspect schemas, deploy to engines, and manage permissions.</p>
                  <button class="btn-primary" id="btnEmptyUploadMine" style="padding: 9px 18px; font-size: 13px; font-weight: 700;">
                    + Upload Your First Dataset
                  </button>
                </div>
              </td>
            </tr>
          `;
          document.getElementById("btnEmptyUploadMine")?.addEventListener("click", () => {
            const uploadModal = document.getElementById("uploadModal");
            if (uploadModal) uploadModal.style.display = "flex";
          });
          return;
        }

        if (this.viewMode === "bookmarked" || (typeof DatabaseScreenManager !== "undefined" && DatabaseScreenManager.activeMode === "bookmarked")) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="db-empty-state">
                  <div class="db-empty-icon" style="color: #F59E0B; background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.3);">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  </div>
                  <h4 class="db-empty-title">No Bookmarked Datasets Yet</h4>
                  <p class="db-empty-desc">You have not saved any datasets to your bookmarked collection yet. Click the bookmark option in the action menu of any dataset to pin it here.</p>
                  <button class="btn-secondary" id="btnEmptyExploreBookmarks" style="padding: 9px 18px; font-size: 13px; font-weight: 700;">
                    Explore Datasets &rarr;
                  </button>
                </div>
              </td>
            </tr>
          `;
          document.getElementById("btnEmptyExploreBookmarks")?.addEventListener("click", () => {
            if (typeof DatabaseScreenManager !== "undefined") DatabaseScreenManager.openExplore();
          });
          return;
        }

        if (typeof DatabaseScreenManager !== "undefined" && DatabaseScreenManager.activeMode === "search") {
          tbody.innerHTML = `
            <tr>
              <td colspan="8">
                <div class="db-empty-state">
                  <div class="db-empty-icon" style="color: #3B82F6; background: rgba(59, 130, 246, 0.12); border-color: rgba(59, 130, 246, 0.3);">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  </div>
                  <h4 class="db-empty-title">No Matching Search Results</h4>
                  <p class="db-empty-desc">We couldn't find any datasets matching "${escapeHtml(this.searchQuery || "your query")}". Try adjusting your keywords, database engine, or category filters.</p>
                  <button class="btn-secondary" id="btnClearSearchQuery" style="padding: 9px 18px; font-size: 13px; font-weight: 700;">
                    Clear Search Filters
                  </button>
                </div>
              </td>
            </tr>
          `;
          document.getElementById("btnClearSearchQuery")?.addEventListener("click", () => {
            const input = document.getElementById("globalSearchInput");
            if (input) input.value = "";
            DatasetsManager.searchQuery = "";
            DatasetsManager.databaseFilter = "";
            DatasetsManager.categoryFilter = "";
            DatasetsManager.currentPage = 1;
            DatasetsManager.loadDatasets();
          });
          return;
        }

        const emptyMsg = this.viewMode === "bookmarked"
          ? "No bookmarked datasets yet. Click the action menu on any dataset to bookmark it."
          : "No datasets found matching your search or filters.";

        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 8px; opacity: 0.5;">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <div style="font-weight: 500; font-size: 13px;">${escapeHtml(emptyMsg)}</div>
            </td>
          </tr>
        `;
        return;
      }

      const dbBadgeMap = {
        MySQL: "badge-db01",
        SQLServer: "badge-db02",
        PostgreSQL: "badge-db03",
        MongoDB: "badge-db04",
        Neo4J: "badge-db05",
        CouchBase: "badge-db06"
      };

      const formatBadgeMap = {
        CSV: "badge-format-csv",
        TSV: "badge-format-csv",
        XLSX: "badge-format-xlsx",
        JSON: "badge-format-json",
        NDJSON: "badge-format-json",
        XML: "badge-format-csv"
      };

      tbody.innerHTML = this.items.map(dataset => {
        const dbName = dataset.selectedEngine || dataset.recommendedEngine || dataset.targetDb || "PostgreSQL";
        const dbBadge = dbBadgeMap[dbName] || "badge-db03";

        const format = (dataset.fileFormat || dataset.fileType || "CSV").toUpperCase();
        const formatBadge = formatBadgeMap[format] || "badge-format-csv";

        const size = dataset.formattedSize || (dataset.fileSizeBytes ? `${(dataset.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB` : "1.0 MB");
        const category = dataset.category || "Education";
        const contributor = dataset.contributorName || "Super Admin";
        const initials = contributor.slice(0, 2).toUpperCase();
        const updatedTime = timeAgo(dataset.updatedAt || dataset.createdAt);
        const isBookmarked = this.bookmarkedIds.has(dataset.id);
        const isPublic = dataset.visibility === "PUBLIC";
        const visibilityBadge = isPublic
          ? `<span class="badge badge-visibility-public" title="Public Dataset &bull; Accessible to everyone"><span style="width: 5px; height: 5px; border-radius: 50%; background: #10B981; display: inline-block;"></span>Public</span>`
          : `<span class="badge badge-visibility-private" title="Private Dataset &bull; Restricted to author"><span style="width: 5px; height: 5px; border-radius: 50%; background: #F43F5E; display: inline-block;"></span>Private</span>`;

        return `
          <tr data-id="${dataset.id}" data-name="${escapeHtml(dataset.name)}" data-db="${escapeHtml(dbName)}">
            <td>
              <div class="dataset-name-cell">
                <div class="doc-icon icon-blue">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </div>
                <div class="dataset-meta">
                  <div class="dataset-title" style="cursor: pointer; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span>${escapeHtml(dataset.name)}</span>
                    ${visibilityBadge}
                    ${isBookmarked ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="#F59E0B" stroke="#F59E0B" stroke-width="1" style="vertical-align: -1px; margin-left: 2px;" title="Bookmarked"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>` : ""}
                  </div>
                  <div class="dataset-desc">${escapeHtml(dataset.description || "No description provided.")}</div>
                </div>
              </div>
            </td>
            <td><span class="badge ${dbBadge}">${escapeHtml(dbName)}</span></td>
            <td><span class="category-text">${escapeHtml(category)}</span></td>
            <td><span class="badge ${formatBadge}">${escapeHtml(format)}</span></td>
            <td><span class="size-text">${escapeHtml(size)}</span></td>
            <td>
              <div class="contributor-cell">
                <span class="avatar-small avatar-john">${initials}</span>
                <span class="contributor-name">${escapeHtml(contributor)}</span>
              </div>
            </td>
            <td><span class="time-text">${updatedTime}</span></td>
            <td>
              <button class="action-dots-btn" aria-label="Dataset Actions" data-id="${dataset.id}" data-bookmarked="${isBookmarked}">&vellip;</button>
            </td>
          </tr>
        `;
      }).join("");

      // Clicking dataset title opens analysis modal
      tbody.querySelectorAll(".dataset-title").forEach(titleEl => {
        titleEl.addEventListener("click", () => {
          const tr = titleEl.closest("tr");
          const datasetId = tr?.dataset.id;
          if (datasetId) ActionsManager.viewAnalysis(datasetId);
        });
      });

      // Attach action menu trigger
      tbody.querySelectorAll(".action-dots-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const datasetId = btn.dataset.id;
          const isBookmarked = btn.dataset.bookmarked === "true";
          ActionsManager.openMenu(btn, datasetId, isBookmarked);
        });
      });
    },

    renderPagination() {
      const infoEl = document.getElementById("paginationInfo");
      const indicatorEl = document.getElementById("pageIndicator");
      const prevBtn = document.getElementById("btnPrevPage");
      const nextBtn = document.getElementById("btnNextPage");

      if (infoEl) {
        const start = this.totalCount === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
        const end = Math.min(this.currentPage * this.pageSize, this.totalCount);
        infoEl.textContent = `Showing ${start}-${end} of ${this.totalCount} datasets`;
      }

      if (indicatorEl) {
        indicatorEl.textContent = `Page ${this.currentPage} of ${Math.max(this.totalPages, 1)}`;
      }

      if (prevBtn) {
        prevBtn.disabled = this.currentPage <= 1;
      }

      if (nextBtn) {
        nextBtn.disabled = this.currentPage >= this.totalPages;
      }

      if (typeof DatabaseScreenManager !== "undefined") {
        const tabCount = document.getElementById("dbTabDatasetsCount");
        const countPill = document.getElementById("dbHeroDatasetCountText");
        if (DatabaseScreenManager.activeMode === "database") {
          const activeDb = DatabaseScreenManager.activeDb || DatabaseScreenManager.activeDatabase;
          const storageFormatted = (activeDb && DashboardManager.stats?.databaseStorage?.[activeDb]?.formatted) || "0 B";
          if (tabCount) tabCount.textContent = String(this.totalCount);
          if (countPill) countPill.textContent = `${this.totalCount} Datasets Stored \u2022 ${storageFormatted}`;
        } else if (DatabaseScreenManager.activeMode === "explore") {
          if (tabCount) tabCount.textContent = String(this.totalCount);
          if (countPill) countPill.textContent = `${this.totalCount} Public Datasets`;
        } else if (DatabaseScreenManager.activeMode === "mine") {
          if (tabCount) tabCount.textContent = String(this.totalCount);
          if (countPill) countPill.textContent = `${this.totalCount} Uploaded Datasets`;
        } else if (DatabaseScreenManager.activeMode === "bookmarked") {
          if (tabCount) tabCount.textContent = String(this.totalCount);
          if (countPill) countPill.textContent = `${this.totalCount} Bookmarked Datasets`;
        } else if (DatabaseScreenManager.activeMode === "search") {
          if (tabCount) tabCount.textContent = String(this.totalCount);
          if (countPill) countPill.textContent = `${this.totalCount} Search Results`;
        }
      }
    },

    bindEvents() {
      const prevBtn = document.getElementById("btnPrevPage");
      const nextBtn = document.getElementById("btnNextPage");
      const searchInput = document.getElementById("globalSearchInput");

      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          if (this.currentPage > 1) {
            this.currentPage--;
            this.loadDatasets();
          }
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.loadDatasets();
          }
        });
      }

      // Search debounce
      let searchTimeout = null;
      if (searchInput) {
        searchInput.addEventListener("input", (e) => {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            this.searchQuery = e.target.value.trim();
            this.currentPage = 1;
            this.loadDatasets();
          }, 350);
        });

        // Ctrl+K shortcut
        window.addEventListener("keydown", (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            searchInput.focus();
            showToast("Search focused (Ctrl+K)", "info");
          }
        });
      }
    }
  };

  // =========================================================================
  // 6. DATASET ACTIONS & ANALYSIS MANAGER
  // =========================================================================

  const ActionsManager = {
    activeDatasetId: null,
    activeIsBookmarked: false,

    init() {
      this.bindMenuEvents();
      this.bindModalEvents();
    },

    openMenu(btnElement, datasetId, isBookmarked) {
      this.activeDatasetId = datasetId;
      this.activeIsBookmarked = isBookmarked;

      const menu = document.getElementById("datasetActionMenu");
      const bookmarkText = document.getElementById("menuBookmarkText");
      if (!menu) return;

      if (bookmarkText) {
        bookmarkText.textContent = isBookmarked ? "Remove Bookmark" : "Bookmark Dataset";
      }

      const rect = btnElement.getBoundingClientRect();
      menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
      menu.style.left = `${Math.max(rect.right - 180, 10)}px`;
      menu.classList.add("active");
    },

    closeMenu() {
      const menu = document.getElementById("datasetActionMenu");
      if (menu) menu.classList.remove("active");
    },

    bindMenuEvents() {
      const menu = document.getElementById("datasetActionMenu");
      if (!menu) return;

      document.addEventListener("click", (e) => {
        if (!menu.contains(e.target) && !e.target.classList.contains("action-dots-btn")) {
          this.closeMenu();
        }
      });

      menu.querySelectorAll(".dropdown-item").forEach(item => {
        item.addEventListener("click", async () => {
          const action = item.dataset.action;
          const id = this.activeDatasetId;
          this.closeMenu();
          if (!id) return;

          if (action === "download-csv") {
            this.downloadDataset(id, "csv");
          } else if (action === "download-json") {
            this.downloadDataset(id, "json");
          } else if (action === "download-xlsx") {
            this.downloadDataset(id, "xlsx");
          } else if (action === "toggle-bookmark") {
            await this.toggleBookmark(id);
          } else if (action === "view-analysis") {
            await this.viewAnalysis(id);
          }
        });
      });
    },

    async downloadDataset(id, format) {
      showToast(`Preparing ${format.toUpperCase()} export...`, "info");
      try {
        const token = apiClient.getToken();
        const res = await fetch(`/api/datasets/${id}/download?format=${format}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: "include"
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          const msg = errData?.error?.message || `Download failed (${res.status})`;
          throw new Error(msg);
        }

        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") || "";
        let filename = `dataset_${id}.${format}`;
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        showToast(`Downloaded ${filename}`);
        // Refresh KPIs to show incremented download count
        DashboardManager.loadStats();
      } catch (err) {
        showToast(`Export failed: ${err.message}`, "error");
      }
    },

    async toggleBookmark(id) {
      try {
        const res = await apiClient.request(`/api/datasets/${id}/bookmark`, { method: "POST" });
        if (res.bookmarked) {
          DatasetsManager.bookmarkedIds.add(id);
          showToast("Added to Bookmarked datasets");
        } else {
          DatasetsManager.bookmarkedIds.delete(id);
          showToast("Removed from Bookmarked datasets", "info");
        }
        DatasetsManager.renderTable();
      } catch (err) {
        showToast(`Failed to update bookmark: ${err.message}`, "error");
      }
    },

    async viewAnalysis(id) {
      const modal = document.getElementById("datasetDetailsModal");
      const titleEl = document.getElementById("analysisModalTitle");
      const subEl = document.getElementById("analysisModalSubtitle");
      const bodyEl = document.getElementById("analysisModalBody");
      if (!modal || !bodyEl) return;

      modal.style.display = "flex";
      bodyEl.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          <span class="spinner" style="border-color: rgba(37,99,235,0.2); border-top-color: var(--primary-600); margin-right: 8px; vertical-align: middle;"></span>
          Analyzing dataset schema and structure...
        </div>
      `;

      try {
        let dataset = null;
        try {
          dataset = await apiClient.request(`/api/datasets/${id}`);
        } catch {
          // ignore
        }

        if (titleEl && dataset) {
          titleEl.textContent = `${dataset.name} — Analysis`;
          if (subEl) subEl.textContent = `Category: ${dataset.category || "General"} • Format: ${dataset.fileFormat || "CSV"} • Size: ${dataset.formattedSize || "N/A"}`;
        }

        let analysisData = null;
        try {
          analysisData = await apiClient.request(`/api/datasets/${id}/analysis`);
        } catch {
          // If not analyzed yet, run analyze
          analysisData = await apiClient.request(`/api/datasets/${id}/analyze`, { method: "POST" });
        }

        this.renderAnalysisDetails(bodyEl, dataset, analysisData);
      } catch (err) {
        bodyEl.innerHTML = `
          <div style="padding: 24px; color: var(--rose-500); text-align: center;">
            Failed to analyze dataset: ${escapeHtml(err.message)}
          </div>
        `;
      }
    },

    renderAnalysisDetails(container, dataset, analysisData) {
      const analysis = analysisData?.analysis || analysisData;
      const scores = analysisData?.recommendationScores || analysis?.scores || analysis?.recommendationScores || {};
      const reasons = analysis?.reasons || (analysisData?.recommendationReason ? [analysisData.recommendationReason] : ["Structural analysis completed successfully."]);
      const chars = analysis?.characteristics || {};
      const fields = chars.fields || [];
      const compatibleEngines = (analysis?.compatibleEngines || []).map(e => String(e).toUpperCase());

      const recommendedEngine = (analysis?.recommendedEngine || dataset?.selectedEngine || "POSTGRESQL").toUpperCase();
      const classification = (analysis?.classification || dataset?.classification || "RELATIONAL").toUpperCase();
      const currentSelectedEngine = dataset?.selectedEngine ? String(dataset.selectedEngine).toUpperCase() : null;

      const ALL_ENGINES = [
        { key: "POSTGRESQL", name: "PostgreSQL", type: "Relational (ACID, Complex Joins, Strict Schema)" },
        { key: "MYSQL", name: "MySQL", type: "Relational (Tabular Structure, High Performance)" },
        { key: "SQLSERVER", name: "SQL Server", type: "Relational (Enterprise Transactional / Analytical)" },
        { key: "MONGODB", name: "MongoDB", type: "Document (Hierarchical & Nested Schemas, Flexible)" },
        { key: "COUCHBASE", name: "Couchbase", type: "Document / Key-Value (High-Speed KV & Caching)" },
        { key: "NEO4J", name: "Neo4j", type: "Graph (Highly Connected Data, Edge Relationships)" }
      ];

      // Recommendation Hero Card
      const heroHtml = `
        <div class="recommendation-hero-card">
          <div class="recommendation-badge-pill">
            ★ Recommended Database Engine
          </div>
          <div class="recommendation-engine-name">
            <span>${recommendedEngine}</span>
            <span style="font-size: 13px; font-weight: 600; opacity: 0.85; background: rgba(255,255,255,0.15); padding: 3px 10px; border-radius: var(--radius-pill);">
              Match Score: ${scores[recommendedEngine] ?? 60}%
            </span>
          </div>
          <div class="recommendation-summary-text">
            <strong>Optimal Fit:</strong> Classified as <strong>${escapeHtml(classification)}</strong> data.
            ${reasons.map(r => `<div>• ${escapeHtml(r)}</div>`).join("")}
          </div>
        </div>
      `;

      // 3 Stat Cards
      const statsGridHtml = `
        <div class="analysis-overview-grid">
          <div class="analysis-stat-card">
            <div class="analysis-stat-label">Data Classification</div>
            <div class="analysis-stat-val" style="color: #2563EB;">${escapeHtml(classification)}</div>
          </div>
          <div class="analysis-stat-card">
            <div class="analysis-stat-label">Analyzed Records</div>
            <div class="analysis-stat-val">${Number(chars.analyzedRecordCount || chars.recordCount || dataset?.recordCount || 0).toLocaleString()}</div>
          </div>
          <div class="analysis-stat-card">
            <div class="analysis-stat-label">Detected Fields</div>
            <div class="analysis-stat-val">${Number(chars.fieldCount || fields.length || 0).toLocaleString()}</div>
          </div>
        </div>
      `;

      // Engine Compatibility Cards
      const engineCardsHtml = ALL_ENGINES.map(engine => {
        const isCompatible = compatibleEngines.includes(engine.key) || (engine.key === recommendedEngine);
        const isRecommended = (engine.key === recommendedEngine);
        const isActiveStorage = (currentSelectedEngine === engine.key);
        const rawScore = Number(scores[engine.key] || (isRecommended ? 60 : isCompatible ? 45 : 10));
        const scorePercent = Math.min(100, Math.max(5, rawScore));

        let badgeClass = "badge-inappropriate";
        let badgeText = "✕ Inappropriate";
        let reasonText = `Incompatible with ${classification} data. Data model mismatch.`;

        if (isActiveStorage) {
          badgeClass = "badge-active";
          badgeText = "✓ Active Storage";
          reasonText = `Currently configured as the primary active storage for this dataset.`;
        } else if (isRecommended) {
          badgeClass = "badge-appropriate";
          badgeText = "★ Top Recommendation";
          reasonText = `Best suited for this dataset's structure, candidate keys, and query patterns.`;
        } else if (isCompatible) {
          badgeClass = "badge-appropriate";
          badgeText = "✓ Appropriate";
          reasonText = `Compatible with ${classification} data model and can safely host this dataset.`;
        }

        let actionBtnHtml = "";
        if (isActiveStorage) {
          actionBtnHtml = `<button class="btn-engine-deploy btn-deployed" disabled>✓ Active Storage</button>`;
        } else if (isCompatible) {
          actionBtnHtml = `<button class="btn-engine-deploy" data-engine="${engine.key}" data-dataset-id="${dataset?.id || ""}">Deploy to ${engine.name}</button>`;
        } else {
          actionBtnHtml = `<button class="btn-engine-deploy" disabled style="opacity: 0.45; cursor: not-allowed;">Inappropriate</button>`;
        }

        return `
          <div class="engine-compat-card ${isRecommended ? "is-recommended" : ""} ${!isCompatible ? "is-incompatible" : ""}">
            <div class="engine-card-header">
              <div class="engine-card-title">
                <span>${engine.name}</span>
                <span style="font-size: 11px; font-weight: 500; color: var(--text-muted);">${engine.type.split(" ")[0]}</span>
              </div>
              <span class="engine-compat-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="engine-card-reason">
              ${escapeHtml(reasonText)}
            </div>
            <div class="engine-score-wrap">
              <span>Match: ${rawScore}%</span>
              <div class="engine-score-bar-bg">
                <div class="engine-score-bar-fill" style="width: ${scorePercent}%; background: ${isRecommended ? "#2563EB" : isCompatible ? "#10B981" : "#EF4444"};"></div>
              </div>
            </div>
            <div class="engine-card-actions">
              ${actionBtnHtml}
            </div>
          </div>
        `;
      }).join("");

      // Fields Schema Table
      let fieldsHtml = "";
      if (fields.length > 0) {
        fieldsHtml = `
          <div style="margin-top: 24px;">
            <h4 style="font-size: 13px; font-weight: 700; color: var(--text-main); margin-bottom: 8px;">Detected Schema Fields (${fields.length})</h4>
            <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
              <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                  <tr style="background: var(--bg-surface-alt); text-align: left; color: var(--text-muted);">
                    <th style="padding: 8px 12px;">Field Name</th>
                    <th style="padding: 8px 12px;">Detected Type</th>
                    <th style="padding: 8px 12px;">Null %</th>
                    <th style="padding: 8px 12px;">Unique %</th>
                    <th style="padding: 8px 12px;">Candidate Key</th>
                  </tr>
                </thead>
                <tbody>
                  ${fields.map(f => `
                    <tr style="border-bottom: 1px solid var(--border-subtle);">
                      <td style="padding: 8px 12px; font-weight: 600;">${escapeHtml(f.name)}</td>
                      <td style="padding: 8px 12px;"><span class="field-badge">${escapeHtml(Array.isArray(f.inferredTypes) ? f.inferredTypes.join(", ") : (f.inferredType || f.type || "string"))}</span></td>
                      <td style="padding: 8px 12px; color: var(--text-muted);">${f.nullPercentage !== undefined ? `${f.nullPercentage}%` : "0%"}</td>
                      <td style="padding: 8px 12px; color: var(--text-muted);">${f.uniquenessPercentage !== undefined ? `${f.uniquenessPercentage}%` : "N/A"}</td>
                      <td style="padding: 8px 12px;">${f.isCandidateKey || (chars.candidateIds && chars.candidateIds.includes(f.name)) ? `<span style="color: #10B981; font-weight: 700;">✓ Primary Key</span>` : "—"}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }

      container.innerHTML = `
        ${heroHtml}
        ${statsGridHtml}
        <div class="compatibility-section-title">
          <span>Database Engine Compatibility & Deployment</span>
          <span style="font-size: 11.5px; font-weight: 500; color: var(--text-muted);">Select an appropriate engine to provision storage</span>
        </div>
        <div class="compatibility-grid">
          ${engineCardsHtml}
        </div>
        ${fieldsHtml}
      `;

      // Attach deployment click handlers to buttons inside the container
      const deployBtns = container.querySelectorAll(".btn-engine-deploy");
      deployBtns.forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          const targetBtn = e.currentTarget;
          const engine = targetBtn.getAttribute("data-engine");
          const datasetId = targetBtn.getAttribute("data-dataset-id");
          if (!engine || !datasetId || targetBtn.disabled) return;

          targetBtn.disabled = true;
          const originalText = targetBtn.textContent;
          targetBtn.innerHTML = `<span class="spinner" style="width: 12px; height: 12px; vertical-align: middle;"></span> Deploying...`;

          try {
            await apiClient.request(`/api/datasets/${datasetId}/storage`, {
              method: "POST",
              body: JSON.stringify({ engine })
            });

            showToast(`Dataset successfully deployed to ${engine}! Storage table is now active.`);
            targetBtn.className = "btn-engine-deploy btn-deployed";
            targetBtn.innerHTML = "✓ Active Storage";

            // Mark other buttons as inactive
            deployBtns.forEach(other => {
              if (other !== targetBtn && other.classList.contains("btn-deployed")) {
                other.className = "btn-engine-deploy";
                other.disabled = false;
                other.textContent = `Deploy to ${other.getAttribute("data-engine")}`;
              }
            });

            // Refresh table, KPIs, and logs
            DatasetsManager.loadDatasets();
            DashboardManager.loadStats();
            ActivityLogsManager.loadRecentActivity();
          } catch (err) {
            showToast(`Storage deployment failed: ${err.message}`, "error");
            targetBtn.disabled = false;
            targetBtn.textContent = originalText;
          }
        });
      });
    },

    bindModalEvents() {
      const modal = document.getElementById("datasetDetailsModal");
      const closeBtn = document.getElementById("closeDetailsModal");
      const cancelBtn = document.getElementById("closeDetailsBtn");

      const closeModal = () => {
        if (modal) modal.style.display = "none";
      };

      if (closeBtn) closeBtn.addEventListener("click", closeModal);
      if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) closeModal();
        });
      }
    }
  };

  // =========================================================================
  // 7. UPLOAD DATASET MANAGER
  // =========================================================================

  const UploadManager = {
    init() {
      this.bindEvents();
    },

    bindEvents() {
      const modal = document.getElementById("uploadModal");
      const openBtn = document.getElementById("btnQuickUpload");
      const navUpload = document.getElementById("nav-upload");
      const closeBtn = document.getElementById("closeUploadModal");
      const cancelBtn = document.getElementById("cancelUploadBtn");
      const form = document.getElementById("uploadDatasetForm");
      const fileInput = document.getElementById("datasetFileInput");
      const nameInput = document.getElementById("datasetNameInput");
      const sizeInput = document.getElementById("datasetSizeInput");
      const errorMsg = document.getElementById("uploadErrorMsg");
      const submitBtn = document.getElementById("submitUploadBtn");
      const submitText = document.getElementById("submitUploadText");

      const openModal = (e) => {
        if (e) e.preventDefault();
        if (modal) {
          modal.style.display = "flex";
          if (fileInput) fileInput.focus();
        }
      };

      const closeModal = () => {
        if (modal) modal.style.display = "none";
        if (form) form.reset();
        if (errorMsg) errorMsg.style.display = "none";
      };

      if (openBtn) openBtn.addEventListener("click", openModal);
      if (navUpload) navUpload.addEventListener("click", openModal);
      if (closeBtn) closeBtn.addEventListener("click", closeModal);
      if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) closeModal();
        });
      }

      // Auto-populate Name and Size on File Selection
      if (fileInput) {
        fileInput.addEventListener("change", () => {
          const file = fileInput.files?.[0];
          if (!file) return;

          // Auto-name if empty
          if (nameInput && !nameInput.value.trim()) {
            const rawName = file.name.replace(/\.[^/.]+$/, "");
            nameInput.value = rawName.replace(/[-_]/g, " ").replace(/\b\w/g, l => l.toUpperCase());
          }

          // Format size
          if (sizeInput) {
            const bytes = file.size;
            if (bytes < 1024) sizeInput.value = `${bytes} B`;
            else if (bytes < 1024 * 1024) sizeInput.value = `${(bytes / 1024).toFixed(1)} KB`;
            else if (bytes < 1024 * 1024 * 1024) sizeInput.value = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
            else sizeInput.value = `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
          }
        });
      }

      // Handle Submission
      if (form) {
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (errorMsg) errorMsg.style.display = "none";

          const file = fileInput?.files?.[0];
          if (!file) {
            if (errorMsg) {
              errorMsg.textContent = "Please select a dataset file to upload.";
              errorMsg.style.display = "block";
            }
            return;
          }

          const name = document.getElementById("datasetNameInput")?.value.trim();
          const description = document.getElementById("datasetDescInput")?.value.trim();
          const visibility = document.getElementById("datasetVisibilityInput")?.value || "PRIVATE";

          const formData = new FormData();
          formData.append("file", file);
          formData.append("name", name || file.name);
          if (description) formData.append("description", description);
          formData.append("category", "Education");
          formData.append("visibility", visibility);

          if (submitBtn) submitBtn.disabled = true;
          if (submitText) submitText.innerHTML = `<span class="spinner"></span> Uploading & Analyzing...`;

          try {
            const result = await apiClient.request("/api/datasets/upload", {
              method: "POST",
              body: formData
            });

            closeModal();
            if (form) form.reset();
            showToast(`Dataset "${result.name}" uploaded! Analyzing data structure & compatibility...`);

            // Refresh table, KPIs, and activity logs
            DatasetsManager.loadDatasets();
            DashboardManager.loadStats();
            ActivityLogsManager.loadRecentActivity();
            NotificationsManager.loadNotifications();

            // Automatically open analysis & recommended database view
            setTimeout(() => {
              ActionsManager.viewAnalysis(result.id);
            }, 300);
          } catch (err) {
            if (errorMsg) {
              errorMsg.textContent = err.message || "Upload failed. Please verify the file and try again.";
              errorMsg.style.display = "block";
            }
          } finally {
            if (submitBtn) submitBtn.disabled = false;
            if (submitText) submitText.innerHTML = `<span>Upload & Analyze Dataset</span>`;
          }
        });
      }
    }
  };

  // =========================================================================
  // 8. ACTIVITY FEED & SYSTEM LOGS MODAL MANAGER
  // =========================================================================

  const ActivityLogsManager = {
    currentCategoryFilter: "ALL",
    logsSearchQuery: "",

    init() {
      this.bindEvents();
      this.loadRecentActivity();
    },

    bindEvents() {
      const openModalBtn = document.getElementById("viewAllActivityLink");
      const closeModalBtn = document.getElementById("closeActivityLogsModal");
      const modal = document.getElementById("activityLogsModal");
      const searchInput = document.getElementById("logsSearchInput");
      const exportBtn = document.getElementById("btnExportLogs");

      const openModal = (e) => {
        if (e) e.preventDefault();
        if (modal) {
          modal.style.display = "flex";
          this.loadFullLogs();
        }
      };

      const closeModal = () => {
        if (modal) modal.style.display = "none";
      };

      if (openModalBtn) openModalBtn.addEventListener("click", openModal);
      if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) closeModal();
        });
      }

      // Filter chips in activity logs modal
      document.querySelectorAll(".logs-filter-group .filter-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          document.querySelectorAll(".logs-filter-group .filter-chip").forEach(c => c.classList.remove("active"));
          chip.classList.add("active");
          this.currentCategoryFilter = chip.dataset.filter || "ALL";
          this.loadFullLogs();
        });
      });

      // Search input debounce
      let searchTimeout = null;
      if (searchInput) {
        searchInput.addEventListener("input", (e) => {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            this.logsSearchQuery = e.target.value.trim();
            this.loadFullLogs();
          }, 350);
        });
      }

      // Real JSON Export
      if (exportBtn) {
        exportBtn.addEventListener("click", async () => {
          showToast("Exporting system activity logs...", "info");
          try {
            const data = await apiClient.request("/api/logs?pageSize=100&stream=all");
            const logs = data.items || [];
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
            const dlAnchor = document.createElement("a");
            dlAnchor.setAttribute("href", dataStr);
            dlAnchor.setAttribute("download", `DataVault6_System_Activity_Logs_${Date.now()}.json`);
            document.body.appendChild(dlAnchor);
            dlAnchor.click();
            dlAnchor.remove();
            showToast("System Activity Logs exported as JSON!");
          } catch (err) {
            showToast(`Export failed: ${err.message}`, "error");
          }
        });
      }
    },

    formatActivityEntry(log) {
      const meta = (log.metadata && typeof log.metadata === "object") ? log.metadata : {};
      const rawActorEmail = log.actorEmail || "";
      const actorName = log.actorType === "SUPER_ADMIN"
        ? "Super Admin"
        : (rawActorEmail ? rawActorEmail.split("@")[0] : (log.actorType || "Admin"));
      const initials = actorName === "Super Admin"
        ? "SA"
        : actorName.slice(0, 2).toUpperCase();

      const action = (log.action || "").toUpperCase();
      let actionText = (log.action || "performed operation").replace(/_/g, " ").toLowerCase();
      let target = meta.adminName || meta.name || meta.datasetName || log.resourceType || log.resourceId || "System";

      if (action === "ADMIN_CREATED") {
        actionText = "created administrator";
        const createdName = meta.adminName || meta.name || "";
        const createdEmail = meta.adminEmail || meta.email || "";
        target = createdName && createdEmail
          ? `${createdName} (${createdEmail})`
          : (createdName || createdEmail || "New Admin");
      } else if (action === "ADMIN_STATUS_CHANGED") {
        if (meta.manuallyActivated || meta.status === "ACTIVE") {
          actionText = "activated administrator";
        } else if (meta.status === "DISABLED" && meta.previousStatus === "PENDING") {
          actionText = "revoked invitation for";
        } else if (meta.status === "DISABLED") {
          actionText = "disabled administrator";
        } else {
          actionText = "updated status for";
        }
        target = meta.adminName || meta.adminEmail || "Administrator";
      } else if (action === "ADMIN_DELETED") {
        actionText = "deleted administrator";
        target = meta.adminName || meta.name || meta.adminEmail || meta.email || "Administrator";
      } else if (action === "ADMIN_UPDATED") {
        actionText = "updated administrator";
        target = meta.adminName || meta.adminEmail || "Administrator";
      } else if (action === "VERIFICATION_RESENT") {
        actionText = "resent invitation to";
        target = meta.adminName || meta.adminEmail || "Administrator";
      } else if (action === "EMAIL_VERIFIED") {
        actionText = "verified email for";
        target = meta.adminName || meta.adminEmail || actorName;
      } else if (action === "PASSWORD_SETUP") {
        actionText = "set up password for";
        target = meta.adminName || meta.adminEmail || actorName;
      } else if (action === "DATASET_UPLOAD_SUCCESS" || action === "DATASET_CREATED") {
        actionText = "uploaded dataset";
        target = meta.name || meta.datasetName || meta.originalFilename || "Dataset";
      } else if (action === "DATASET_DELETED") {
        actionText = "deleted dataset";
        target = meta.name || meta.datasetName || "Dataset";
      } else if (action === "DATASET_UPDATED") {
        actionText = "updated dataset";
        target = meta.name || meta.datasetName || "Dataset";
      }

      return {
        actorName,
        initials,
        actionText,
        target,
        time: timeAgo(log.timestamp)
      };
    },

    async loadRecentActivity() {
      const container = document.getElementById("activityFeedList");
      if (!container) return;

      try {
        const [allData, auditData] = await Promise.all([
          apiClient.request("/api/logs?pageSize=25&stream=all").catch(() => ({ items: [] })),
          apiClient.request("/api/logs?pageSize=10&stream=audit").catch(() => ({ items: [] }))
        ]);

        const mergedMap = new Map();
        [...(allData.items || []), ...(auditData.items || [])].forEach(item => {
          if (item && item.id) mergedMap.set(item.id, item);
        });

        const allItems = Array.from(mergedMap.values()).sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        const passiveActions = new Set([
          "DATASET_LIST_VIEWED",
          "DATASET_MINE_VIEWED",
          "DATASET_BOOKMARKED_VIEWED",
          "DATASET_STATISTICS_VIEWED",
          "DATASET_CONTRIBUTORS_VIEWED",
          "DATASET_VIEWED",
          "ADMIN_LIST_VIEWED",
          "ADMIN_VIEWED",
          "USER_VIEWED",
          "TOKEN_REFRESH"
        ]);

        const meaningfulItems = allItems.filter(item => !passiveActions.has((item.action || "").toUpperCase()));
        const items = (meaningfulItems.length > 0 ? meaningfulItems : allItems).slice(0, 5);

        if (items.length === 0) {
          container.innerHTML = `
            <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 12px;">
              No recent operational activity recorded.
            </div>
          `;
          return;
        }

        container.innerHTML = items.map(log => {
          const formatted = this.formatActivityEntry(log);

          return `
            <div class="activity-item" data-id="${log.id}">
              <div class="activity-avatar avatar-john">${escapeHtml(formatted.initials)}</div>
              <div class="activity-info">
                <div class="activity-text">
                  <strong>${escapeHtml(formatted.actorName)}</strong> ${escapeHtml(formatted.actionText)} <span class="activity-target">${escapeHtml(formatted.target)}</span>
                </div>
                <div class="activity-time">${formatted.time}</div>
              </div>
            </div>
          `;
        }).join("");
      } catch (err) {
        console.error("Failed to load recent activity:", err);
      }
    },

    async loadFullLogs() {
      const tbody = document.getElementById("fullLogsTableBody");
      const countInfo = document.getElementById("logsCountInfo");
      if (!tbody) return;

      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">
            <span class="spinner" style="border-color: rgba(37,99,235,0.2); border-top-color: var(--primary-600); margin-right: 8px; vertical-align: middle;"></span>
            Loading system activity logs...
          </td>
        </tr>
      `;

      try {
        const params = new URLSearchParams();
        params.set("pageSize", "30");
        params.set("page", "1");
        if (this.logsSearchQuery) params.set("search", this.logsSearchQuery);

        if (this.currentCategoryFilter === "UPLOAD") params.set("stream", "dataset-activity");
        else if (this.currentCategoryFilter === "STORAGE") params.set("stream", "database-activity");
        else if (this.currentCategoryFilter === "QUERY") params.set("stream", "dataset-activity");
        else if (this.currentCategoryFilter === "AUDIT") params.set("stream", "audit");
        else params.set("stream", "all");

        const data = await apiClient.request(`/api/logs?${params.toString()}`);
        const items = data.items || [];

        if (countInfo) {
          countInfo.textContent = `Showing ${items.length} recorded system activities (${data.total || items.length} total)`;
        }

        if (items.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
                No system activity logs found matching the filter criteria.
              </td>
            </tr>
          `;
          return;
        }

        tbody.innerHTML = items.map(log => {
          const stream = log.stream || "audit";
          let badgeClass = "action-system";
          if (stream.includes("dataset")) badgeClass = "action-upload";
          else if (stream.includes("database")) badgeClass = "action-storage";
          else if (stream.includes("security")) badgeClass = "action-query";

          const actor = log.actorType === "SUPER_ADMIN"
            ? "Super Admin"
            : (log.actorEmail ? log.actorEmail.split("@")[0] : (log.actorType || "Admin"));
          const action = (log.action || "OPERATION").replace(/_/g, " ");
          const meta = (log.metadata && typeof log.metadata === "object") ? log.metadata : {};
          const target = meta.adminName || meta.adminEmail || log.resourceType || log.resourceId || "System";

          let details = "";
          if (log.action === "ADMIN_CREATED" && (meta.adminName || meta.adminEmail)) {
            details = `Created administrator ${meta.adminName || ""} (${meta.adminEmail || ""})`.trim();
          } else if (log.metadata && typeof log.metadata === "object") {
            const metaEntries = Object.entries(log.metadata)
              .filter(([k]) => !["method", "endpoint", "statusCode", "durationMs", "requestId"].includes(k))
              .map(([k, v]) => `${k}: ${v}`);
            details = metaEntries.slice(0, 3).join(", ");
          }
          if (!details) details = `Event logged under ${stream} stream.`;

          const timestampStr = new Date(log.timestamp).toLocaleString();
          const isSuccess = log.success !== false;

          return `
            <tr>
              <td style="color: var(--text-muted); font-size: 11px; white-space: nowrap;">${escapeHtml(timestampStr)}</td>
              <td><strong>${escapeHtml(actor)}</strong></td>
              <td><span class="action-badge ${badgeClass}">${escapeHtml(action)}</span></td>
              <td><strong style="color: var(--primary-600);">${escapeHtml(target)}</strong></td>
              <td style="color: var(--text-secondary); max-width: 320px;">${escapeHtml(details)}</td>
              <td>
                <span class="status-badge" style="color: ${isSuccess ? 'var(--emerald-500)' : 'var(--rose-500)'};">
                  &bull; ${isSuccess ? 'SUCCESS' : 'FAILED'}
                </span>
              </td>
            </tr>
          `;
        }).join("");
      } catch (err) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 24px; color: var(--rose-500);">
              Failed to load activity logs: ${escapeHtml(err.message)}
            </td>
          </tr>
        `;
      }
    }
  };

  // =========================================================================
  // 9. NOTIFICATIONS MANAGER
  // =========================================================================

  const NotificationsManager = {
    notifications: [],

    init() {
      this.bindEvents();
      this.loadNotifications();
    },

    bindEvents() {
      const btn = document.getElementById("notificationBtn");
      const panel = document.getElementById("notificationPanel");
      const btnMarkAll = document.getElementById("btnMarkAllRead");

      if (btn && panel) {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          panel.classList.toggle("active");
          if (panel.classList.contains("active")) {
            this.loadNotifications();
          }
        });

        document.addEventListener("click", (e) => {
          if (!panel.contains(e.target) && !btn.contains(e.target)) {
            panel.classList.remove("active");
          }
        });
      }

      if (btnMarkAll) {
        btnMarkAll.addEventListener("click", async () => {
          try {
            await apiClient.request("/api/notifications/read-all", { method: "PATCH" });
            this.loadNotifications();
            showToast("All notifications marked as read");
          } catch {
            // ignore
          }
        });
      }
    },

    async loadNotifications() {
      const badge = document.getElementById("notificationCount");
      const list = document.getElementById("notificationList");

      try {
        const countData = await apiClient.request("/api/notifications/count");
        const unreadCount = countData.unreadCount || 0;

        if (badge) {
          if (unreadCount > 0) {
            badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
            badge.style.display = "block";
          } else {
            badge.style.display = "none";
          }
        }

        if (list) {
          const notifications = await apiClient.request("/api/notifications");
          this.notifications = Array.isArray(notifications) ? notifications : [];

          if (this.notifications.length === 0) {
            list.innerHTML = `
              <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 12px;">
                No notifications right now.
              </div>
            `;
            return;
          }

          list.innerHTML = this.notifications.map(n => {
            const time = timeAgo(n.createdAt);
            const isUnread = !n.read;
            return `
              <div class="notification-item ${isUnread ? 'unread' : ''}" data-id="${n.id}">
                <div class="notification-item-title">${escapeHtml(n.title)}</div>
                <div class="notification-item-msg">${escapeHtml(n.message)}</div>
                <div class="notification-item-time">${time}</div>
              </div>
            `;
          }).join("");

          // Click notification to mark read
          list.querySelectorAll(".notification-item.unread").forEach(item => {
            item.addEventListener("click", async () => {
              const id = item.dataset.id;
              if (id) {
                try {
                  await apiClient.request(`/api/notifications/${id}/read`, { method: "PATCH" });
                  item.classList.remove("unread");
                  const currentBadge = parseInt(badge?.textContent || "1", 10) || 1;
                  if (badge) {
                    const next = currentBadge - 1;
                    if (next <= 0) badge.style.display = "none";
                    else badge.textContent = String(next);
                  }
                } catch {
                  // ignore
                }
              }
            });
          });
        }
      } catch (err) {
        console.error("Failed to load notifications:", err);
      }
    }
  };

  // =========================================================================
  // 10. DATABASE ENGINE METADATA & DEDICATED SCREEN MANAGER
  // =========================================================================

  const DB_ENGINE_METADATA = {
    MySQL: {
      name: "MySQL",
      title: "MySQL Relational Database",
      classification: "Relational / SQL",
      accent: "#2563EB",
      port: "Port 3306",
      host: "localhost:3306 (Docker: postgres-system stack)",
      driver: "Prisma / mysql2 Client",
      description: "High-performance relational SQL engine optimized for tabular datasets, strict schemas, foreign-key constraints, and ACID transactions.",
      formats: "CSV, TSV, XLSX, JSON",
      features: ["ACID Transactions", "Foreign Keys", "B-Tree Indexes", "Structured SQL Queries", "Strict Type Normalization"],
      iconSvg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`
    },
    SQLServer: {
      name: "SQLServer",
      title: "Microsoft SQL Server",
      classification: "Relational / Enterprise",
      accent: "#D97706",
      port: "Port 1433",
      host: "localhost:1433 (Docker: sqlserver)",
      driver: "tedious / mssql Client",
      description: "Enterprise relational database management system built for high-throughput enterprise transactions, analytical processing, and enterprise reporting.",
      formats: "CSV, XLSX, TSV",
      features: ["T-SQL Support", "Clustered Indexes", "Enterprise Compliance", "Cross-table Views", "Analytical Store"],
      iconSvg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`
    },
    PostgreSQL: {
      name: "PostgreSQL",
      title: "PostgreSQL Advanced ORDBMS",
      classification: "Object-Relational / JSONB",
      accent: "#4F46E5",
      port: "Port 5434 / 5435",
      host: "localhost:5434 (System) / 5435 (Logs)",
      driver: "@prisma/client (PostgreSQL)",
      description: "Advanced object-relational SQL database engine supporting JSONB documents, complex indexing, partitioning, and full-text analytical queries.",
      formats: "CSV, JSON, NDJSON, XLSX",
      features: ["JSONB Columns", "Partitioning", "GIN & GiST Indexes", "Automated Migration", "5 Log Stream Partitions"],
      iconSvg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><path d="M12 6v6l4 2"/></svg>`
    },
    MongoDB: {
      name: "MongoDB",
      title: "MongoDB Document Database",
      classification: "Document Store / NoSQL",
      accent: "#059669",
      port: "Port 27017",
      host: "localhost:27017 (Docker: mongo)",
      driver: "mongodb Native Driver",
      description: "Flexible, high-performance document database designed for dynamic schema JSON/BSON storage, polymorphic objects, and horizontal scalability.",
      formats: "JSON, NDJSON, XML",
      features: ["Dynamic BSON Schemas", "Nested Arrays & Objects", "Aggregation Pipeline", "Secondary Indexes", "Polymorphic Documents"],
      iconSvg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`
    },
    Neo4J: {
      name: "Neo4J",
      title: "Neo4J Graph Database",
      classification: "Graph Database",
      accent: "#7C3AED",
      port: "Port 7687 (Bolt) / 7474 (HTTP)",
      host: "localhost:7687 (Docker: neo4j)",
      driver: "neo4j-driver (Cypher Bolt)",
      description: "Native graph database engine optimized for storing and traversing connected nodes, complex relationship webs, and deep graph pattern matching.",
      formats: "JSON, CSV (Nodes & Edges)",
      features: ["Cypher Query Language", "Index-Free Adjacency", "Directed Property Graphs", "Shortest Path Algorithms", "Entity Graphs"],
      iconSvg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`
    },
    CouchBase: {
      name: "CouchBase",
      title: "Couchbase NoSQL Engine",
      classification: "Key-Value & Document",
      accent: "#0D9488",
      port: "Port 8091 (Admin) / 11210",
      host: "localhost:8091 (Docker: couchbase)",
      driver: "couchbase SDK / N1QL",
      description: "Distributed multi-model NoSQL key-value and document engine combining in-memory caching performance with N1QL SQL-for-JSON querying.",
      formats: "JSON, NDJSON, Key-Value",
      features: ["Sub-Millisecond Key-Value Access", "N1QL (SQL for JSON)", "In-Memory Managed Caching", "Sub-Document Operations", "High-Throughput Caching"],
      iconSvg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`
    }
  };

  const DatabaseScreenManager = {
    activeDb: null,
    activeMode: null, // "database" | "explore" | "mine" | null
    activeTab: "datasets",

    init() {
      this.bindEvents();
    },

    bindEvents() {
      document.getElementById("btnBackToDashboard")?.addEventListener("click", () => {
        this.closeDatabaseScreen();
      });

      document.getElementById("breadcrumbDashboardLink")?.addEventListener("click", (e) => {
        e.preventDefault();
        this.closeDatabaseScreen();
      });

      document.querySelectorAll(".db-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.dbtab;
          if (tab) this.switchTab(tab);
        });
      });

      document.getElementById("btnUploadToThisDb")?.addEventListener("click", () => {
        const uploadModal = document.getElementById("uploadModal");
        if (uploadModal) {
          uploadModal.style.display = "flex";
          if (this.activeMode === "database") {
            showToast(`Upload a dataset to run automated schema analysis for ${this.activeDb || "Database"}`);
          } else if (this.activeMode === "explore") {
            showToast("Upload a dataset to share publicly with the platform");
          } else {
            showToast("Upload a new dataset to your personal vault");
          }
        }
      });
    },

    switchTab(tabName) {
      this.activeTab = tabName;
      document.querySelectorAll(".db-tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.dbtab === tabName);
      });

      const tableCard = document.getElementById("datasetsTableSection");
      const specsPanel = document.getElementById("dbSpecsPanel");

      if (tabName === "specs") {
        if (tableCard) tableCard.style.display = "none";
        if (specsPanel) specsPanel.style.display = "block";
      } else {
        if (tableCard) tableCard.style.display = "block";
        if (specsPanel) specsPanel.style.display = "none";
      }
    },

    openDatabase(dbName) {
      const meta = DB_ENGINE_METADATA[dbName] || {
        name: dbName,
        title: `${dbName} Database`,
        classification: "Multi-Model",
        accent: "#2563EB",
        port: "Custom Port",
        host: "localhost (Docker Stack)",
        driver: "Native Connector",
        description: `Dedicated storage engine partition for ${dbName} datasets.`,
        formats: "CSV, JSON, XLSX",
        features: ["Automated Routing", "Storage Partitioning", "Schema Inspection"],
        iconSvg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`
      };

      this.activeMode = "database";
      this.activeDb = dbName;
      this.activeTab = "datasets";

      // 1. Hide general dashboard overview, analytics, requests
      const overviewGroup = document.getElementById("dashboardOverviewGroup");
      if (overviewGroup) overviewGroup.style.display = "none";

      const analyticsWrap = document.getElementById("analyticsScreenWrap");
      if (analyticsWrap) analyticsWrap.style.display = "none";

      const requestsWrap = document.getElementById("dataRequestsScreenWrap");
      if (requestsWrap) requestsWrap.style.display = "none";

      const tableCard = document.getElementById("datasetsTableSection");
      if (tableCard) tableCard.style.display = "block";

      // 2. Expand grid to 1 column full width & hide right panel
      const dashboardGrid = document.querySelector(".dashboard-grid");
      if (dashboardGrid) dashboardGrid.classList.add("database-view-active");

      // 3. Show Database Screen Header & Specs
      const screenWrap = document.getElementById("databaseScreenHeaderWrap");
      if (screenWrap) screenWrap.style.display = "block";

      this.switchTab("datasets");

      // 4. Update Engine Hero Banner
      const hero = document.getElementById("dbEngineHero");
      if (hero) hero.style.setProperty("--engine-accent", meta.accent);

      const iconWrap = document.getElementById("dbEngineHeroIcon");
      if (iconWrap) {
        iconWrap.innerHTML = meta.iconSvg;
        iconWrap.style.color = meta.accent;
        iconWrap.style.background = `${meta.accent}1F`;
        iconWrap.style.borderColor = `${meta.accent}40`;
      }

      const nameEl = document.getElementById("dbEngineHeroName");
      if (nameEl) nameEl.textContent = meta.title;

      const descEl = document.getElementById("dbEngineHeroDesc");
      if (descEl) descEl.textContent = meta.description;

      const breadcrumbCat = document.getElementById("breadcrumbCategory");
      if (breadcrumbCat) breadcrumbCat.textContent = "Databases";

      const breadcrumbName = document.getElementById("breadcrumbDbName");
      if (breadcrumbName) breadcrumbName.textContent = meta.name;

      const portText = document.getElementById("dbHeroPortText");
      if (portText) portText.textContent = meta.port;

      const statusText = document.getElementById("dbEngineHeroStatusText");
      if (statusText) statusText.textContent = `Connected (${meta.port})`;

      const classText = document.getElementById("dbHeroClassificationText");
      if (classText) classText.textContent = meta.classification;

      const engineCount = (DashboardManager.stats?.databaseEngines && DashboardManager.stats.databaseEngines[dbName]) || 0;
      const engineStorage = DashboardManager.stats?.databaseStorage?.[dbName]?.formatted || "0 B";
      const countPill = document.getElementById("dbHeroDatasetCountText");
      if (countPill) countPill.textContent = `${engineCount} Datasets Stored \u2022 ${engineStorage}`;

      const tabLabel1 = document.getElementById("dbTabDatasetsLabel");
      if (tabLabel1) tabLabel1.textContent = "Stored Datasets";

      const tabCount = document.getElementById("dbTabDatasetsCount");
      if (tabCount) tabCount.textContent = String(engineCount);

      const tabLabel2 = document.getElementById("dbTabSpecsLabel");
      if (tabLabel2) tabLabel2.textContent = "Engine Specs & Architecture";

      const btnUploadText = document.getElementById("btnUploadToThisDbText");
      if (btnUploadText) btnUploadText.textContent = `Upload Dataset to ${meta.name}`;

      // Populate Specs Panel
      const label1 = document.getElementById("specLabel1");
      if (label1) label1.textContent = "Connection & Host";
      const hostVal = document.getElementById("specHostVal");
      if (hostVal) hostVal.textContent = meta.host;
      const sub1 = document.getElementById("specSub1");
      if (sub1) sub1.textContent = "Docker stack connected \u2022 TCP Socket";

      const label2 = document.getElementById("specLabel2");
      if (label2) label2.textContent = "Engine Classification";
      const classVal = document.getElementById("specClassVal");
      if (classVal) classVal.textContent = meta.classification;
      const sub2 = document.getElementById("specSub2");
      if (sub2) sub2.textContent = "Native SQL transaction handling";

      const label3 = document.getElementById("specLabel3");
      if (label3) label3.textContent = "Supported Formats";
      const formatsVal = document.getElementById("specFormatsVal");
      if (formatsVal) formatsVal.textContent = meta.formats;
      const sub3 = document.getElementById("specSub3");
      if (sub3) sub3.textContent = "Automated schema detection & normalization";

      const label4 = document.getElementById("specLabel4");
      if (label4) label4.textContent = "Driver & Connectivity";
      const driverVal = document.getElementById("specDriverVal");
      if (driverVal) driverVal.textContent = meta.driver;
      const sub4 = document.getElementById("specSub4");
      if (sub4) sub4.textContent = "Type-safe queries with prepared statements";

      const featuresTitle = document.getElementById("specFeaturesTitle");
      if (featuresTitle) featuresTitle.textContent = "Engine Features & Storage Capabilities";

      const chipsWrap = document.getElementById("specFeaturesChips");
      if (chipsWrap) {
        chipsWrap.innerHTML = meta.features.map(f => `<span class="spec-feature-chip">${f}</span>`).join("");
      }

      // 5. Update Table Card Header
      const tableTitle = document.getElementById("tableSectionTitle");
      if (tableTitle) tableTitle.textContent = `${meta.name} Datasets`;

      const tableSubtitle = document.getElementById("tableSectionSubtitle");
      if (tableSubtitle) tableSubtitle.textContent = `Showing datasets stored and partitioned within ${meta.name}`;

      const viewAllLink = document.getElementById("viewAllDatasetsLink");
      if (viewAllLink) viewAllLink.style.display = "none";

      // 6. Highlight active sidebar item
      document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        if (item.dataset.db === dbName) {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });

      // 7. Load datasets strictly for this database
      DatasetsManager.databaseFilter = dbName;
      DatasetsManager.categoryFilter = "";
      DatasetsManager.visibilityFilter = "";
      DatasetsManager.viewMode = "all";
      DatasetsManager.currentPage = 1;
      DatasetsManager.loadDatasets();

      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast(`Switched to ${meta.name} Database Screen`);
    },

    openExplore() {
      this.activeMode = "explore";
      this.activeDb = null;
      this.activeTab = "datasets";

      // 1. Hide general dashboard overview, analytics, requests
      const overviewGroup = document.getElementById("dashboardOverviewGroup");
      if (overviewGroup) overviewGroup.style.display = "none";

      const analyticsWrap = document.getElementById("analyticsScreenWrap");
      if (analyticsWrap) analyticsWrap.style.display = "none";

      const requestsWrap = document.getElementById("dataRequestsScreenWrap");
      if (requestsWrap) requestsWrap.style.display = "none";

      const tableCard = document.getElementById("datasetsTableSection");
      if (tableCard) tableCard.style.display = "block";

      // 2. Expand grid to 1 column full width & hide right panel
      const dashboardGrid = document.querySelector(".dashboard-grid");
      if (dashboardGrid) dashboardGrid.classList.add("database-view-active");

      // 3. Show Screen Header & Specs
      const screenWrap = document.getElementById("databaseScreenHeaderWrap");
      if (screenWrap) screenWrap.style.display = "block";

      this.switchTab("datasets");

      // 4. Update Hero Banner for Explore Public Datasets
      const accent = "#06B6D4"; // Cyan accent
      const hero = document.getElementById("dbEngineHero");
      if (hero) hero.style.setProperty("--engine-accent", accent);

      const iconWrap = document.getElementById("dbEngineHeroIcon");
      if (iconWrap) {
        iconWrap.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        `;
        iconWrap.style.color = accent;
        iconWrap.style.background = `${accent}1F`;
        iconWrap.style.borderColor = `${accent}40`;
      }

      const nameEl = document.getElementById("dbEngineHeroName");
      if (nameEl) nameEl.textContent = "Explore Public Datasets";

      const descEl = document.getElementById("dbEngineHeroDesc");
      if (descEl) descEl.textContent = "Browse, discover, and inspect all publicly accessible datasets across all 6 storage engines. Private and restricted datasets are strictly omitted.";

      const breadcrumbCat = document.getElementById("breadcrumbCategory");
      if (breadcrumbCat) breadcrumbCat.textContent = "Datasets";

      const breadcrumbName = document.getElementById("breadcrumbDbName");
      if (breadcrumbName) breadcrumbName.textContent = "Explore Public";

      const statusText = document.getElementById("dbEngineHeroStatusText");
      if (statusText) statusText.textContent = "Public Catalog (Zero Private Datasets)";

      const classText = document.getElementById("dbHeroClassificationText");
      if (classText) classText.textContent = "Scope: Public Only";

      const countPill = document.getElementById("dbHeroDatasetCountText");
      if (countPill) countPill.textContent = "Loading public datasets...";

      const portText = document.getElementById("dbHeroPortText");
      if (portText) portText.textContent = "All 6 Engines";

      const tabLabel1 = document.getElementById("dbTabDatasetsLabel");
      if (tabLabel1) tabLabel1.textContent = "Public Datasets";

      const tabCount = document.getElementById("dbTabDatasetsCount");
      if (tabCount) tabCount.textContent = "...";

      const tabLabel2 = document.getElementById("dbTabSpecsLabel");
      if (tabLabel2) tabLabel2.textContent = "Public Data Catalog Specs";

      const btnUploadText = document.getElementById("btnUploadToThisDbText");
      if (btnUploadText) btnUploadText.textContent = "+ Upload Public Dataset";

      // Populate Specs Panel for Explore View
      const label1 = document.getElementById("specLabel1");
      if (label1) label1.textContent = "Access & Visibility Policy";
      const hostVal = document.getElementById("specHostVal");
      if (hostVal) hostVal.textContent = "PUBLIC ONLY";
      const sub1 = document.getElementById("specSub1");
      if (sub1) sub1.textContent = "Private and confidential datasets are strictly excluded";

      const label2 = document.getElementById("specLabel2");
      if (label2) label2.textContent = "Storage Scope";
      const classVal = document.getElementById("specClassVal");
      if (classVal) classVal.textContent = "All 6 Database Engines";
      const sub2 = document.getElementById("specSub2");
      if (sub2) sub2.textContent = "MySQL, PostgreSQL, MongoDB, CouchBase, Neo4J, SQLServer";

      const label3 = document.getElementById("specLabel3");
      if (label3) label3.textContent = "Supported Formats";
      const formatsVal = document.getElementById("specFormatsVal");
      if (formatsVal) formatsVal.textContent = "CSV, TSV, XLSX, JSON, XML";
      const sub3 = document.getElementById("specSub3");
      if (sub3) sub3.textContent = "Standardized format normalization and validation";

      const label4 = document.getElementById("specLabel4");
      if (label4) label4.textContent = "Data Delivery";
      const driverVal = document.getElementById("specDriverVal");
      if (driverVal) driverVal.textContent = "Direct Download & API Stream";
      const sub4 = document.getElementById("specSub4");
      if (sub4) sub4.textContent = "Instant export available for all public assets";

      const featuresTitle = document.getElementById("specFeaturesTitle");
      if (featuresTitle) featuresTitle.textContent = "Public Data Catalog Capabilities";

      const chipsWrap = document.getElementById("specFeaturesChips");
      if (chipsWrap) {
        const publicFeatures = [
          "Zero Private Datasets",
          "Public Read-Only Access",
          "Global Search & Filter",
          "Automated Engine Partitioning",
          "Schema Inspector Modal",
          "Direct File Download"
        ];
        chipsWrap.innerHTML = publicFeatures.map(f => `<span class="spec-feature-chip">${f}</span>`).join("");
      }

      // 5. Update Table Card Header
      const tableTitle = document.getElementById("tableSectionTitle");
      if (tableTitle) tableTitle.textContent = "Public Datasets Catalog";

      const tableSubtitle = document.getElementById("tableSectionSubtitle");
      if (tableSubtitle) tableSubtitle.textContent = "Showing all public datasets across DataVault6 (private datasets excluded)";

      const viewAllLink = document.getElementById("viewAllDatasetsLink");
      if (viewAllLink) viewAllLink.style.display = "none";

      // 6. Highlight active sidebar item
      document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        if (item.id === "nav-explore") {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });

      // 7. Load datasets: strictly visibility=PUBLIC, all engines, viewMode=all
      DatasetsManager.databaseFilter = "";
      DatasetsManager.categoryFilter = "";
      DatasetsManager.visibilityFilter = "PUBLIC";
      DatasetsManager.viewMode = "all";
      DatasetsManager.currentPage = 1;
      DatasetsManager.loadDatasets();

      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("Explore Public Datasets: Showing public datasets only");
    },

    openMyDatasets() {
      this.activeMode = "mine";
      this.activeDb = null;
      this.activeTab = "datasets";

      // 1. Hide general dashboard overview, analytics, requests
      const overviewGroup = document.getElementById("dashboardOverviewGroup");
      if (overviewGroup) overviewGroup.style.display = "none";

      const analyticsWrap = document.getElementById("analyticsScreenWrap");
      if (analyticsWrap) analyticsWrap.style.display = "none";

      const requestsWrap = document.getElementById("dataRequestsScreenWrap");
      if (requestsWrap) requestsWrap.style.display = "none";

      const tableCard = document.getElementById("datasetsTableSection");
      if (tableCard) tableCard.style.display = "block";

      // 2. Expand grid to 1 column full width & hide right panel
      const dashboardGrid = document.querySelector(".dashboard-grid");
      if (dashboardGrid) dashboardGrid.classList.add("database-view-active");

      // 3. Show Screen Header & Specs
      const screenWrap = document.getElementById("databaseScreenHeaderWrap");
      if (screenWrap) screenWrap.style.display = "block";

      this.switchTab("datasets");

      // 4. Update Hero Banner for My Uploaded Datasets
      const accent = "#6366F1"; // Indigo accent
      const hero = document.getElementById("dbEngineHero");
      if (hero) hero.style.setProperty("--engine-accent", accent);

      const iconWrap = document.getElementById("dbEngineHeroIcon");
      if (iconWrap) {
        iconWrap.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        `;
        iconWrap.style.color = accent;
        iconWrap.style.background = `${accent}1F`;
        iconWrap.style.borderColor = `${accent}40`;
      }

      const nameEl = document.getElementById("dbEngineHeroName");
      if (nameEl) nameEl.textContent = "My Uploaded Datasets";

      const descEl = document.getElementById("dbEngineHeroDesc");
      if (descEl) descEl.textContent = "Inspect, manage, and download datasets uploaded by your account. Includes both your private datasets and public contributions.";

      const breadcrumbCat = document.getElementById("breadcrumbCategory");
      if (breadcrumbCat) breadcrumbCat.textContent = "Datasets";

      const breadcrumbName = document.getElementById("breadcrumbDbName");
      if (breadcrumbName) breadcrumbName.textContent = "My Datasets";

      const statusText = document.getElementById("dbEngineHeroStatusText");
      if (statusText) statusText.textContent = "Personal Vault (Contributor View)";

      const classText = document.getElementById("dbHeroClassificationText");
      if (classText) classText.textContent = "Scope: My Uploads";

      const countPill = document.getElementById("dbHeroDatasetCountText");
      if (countPill) countPill.textContent = "Loading contributed datasets...";

      const portText = document.getElementById("dbHeroPortText");
      if (portText) portText.textContent = "Author Vault";

      const tabLabel1 = document.getElementById("dbTabDatasetsLabel");
      if (tabLabel1) tabLabel1.textContent = "My Datasets";

      const tabCount = document.getElementById("dbTabDatasetsCount");
      if (tabCount) tabCount.textContent = "...";

      const tabLabel2 = document.getElementById("dbTabSpecsLabel");
      if (tabLabel2) tabLabel2.textContent = "Contributor Guidelines & Rights";

      const btnUploadText = document.getElementById("btnUploadToThisDbText");
      if (btnUploadText) btnUploadText.textContent = "+ Upload New Dataset";

      // Populate Specs Panel for My Datasets View
      const label1 = document.getElementById("specLabel1");
      if (label1) label1.textContent = "Vault Partition";
      const hostVal = document.getElementById("specHostVal");
      if (hostVal) hostVal.textContent = "User Authenticated Vault";
      const sub1 = document.getElementById("specSub1");
      if (sub1) sub1.textContent = "Tied directly to your logged-in administrator account";

      const label2 = document.getElementById("specLabel2");
      if (label2) label2.textContent = "Visibility Control";
      const classVal = document.getElementById("specClassVal");
      if (classVal) classVal.textContent = "Private & Public Control";
      const sub2 = document.getElementById("specSub2");
      if (sub2) sub2.textContent = "You can designate datasets as private or share them publicly";

      const label3 = document.getElementById("specLabel3");
      if (label3) label3.textContent = "Supported Ingestion Formats";
      const formatsVal = document.getElementById("specFormatsVal");
      if (formatsVal) formatsVal.textContent = "CSV, TSV, XLSX, JSON, XML";
      const sub3 = document.getElementById("specSub3");
      if (sub3) sub3.textContent = "Automated engine detection and schema validation";

      const label4 = document.getElementById("specLabel4");
      if (label4) label4.textContent = "Ownership Permissions";
      const driverVal = document.getElementById("specDriverVal");
      if (driverVal) driverVal.textContent = "Full CRUD & Re-Analysis";
      const sub4 = document.getElementById("specSub4");
      if (sub4) sub4.textContent = "Edit metadata, re-trigger analysis, download, or delete";

      const featuresTitle = document.getElementById("specFeaturesTitle");
      if (featuresTitle) featuresTitle.textContent = "Personal Vault Management Capabilities";

      const chipsWrap = document.getElementById("specFeaturesChips");
      if (chipsWrap) {
        const contributorFeatures = [
          "Private & Public Datasets",
          "Automated Schema Profiling",
          "Target Database Routing",
          "Metadata & Tag Management",
          "Re-Analyze Engine Recommendations",
          "Full Dataset Deletion Rights"
        ];
        chipsWrap.innerHTML = contributorFeatures.map(f => `<span class="spec-feature-chip">${f}</span>`).join("");
      }

      // 5. Update Table Card Header
      const tableTitle = document.getElementById("tableSectionTitle");
      if (tableTitle) tableTitle.textContent = "My Uploaded Datasets";

      const tableSubtitle = document.getElementById("tableSectionSubtitle");
      if (tableSubtitle) tableSubtitle.textContent = "Showing all datasets uploaded and managed by your account";

      const viewAllLink = document.getElementById("viewAllDatasetsLink");
      if (viewAllLink) viewAllLink.style.display = "none";

      // 6. Highlight active sidebar item
      document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        if (item.id === "nav-my-datasets") {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });

      // 7. Load datasets: endpoint /api/datasets/mine via viewMode = "mine"
      DatasetsManager.databaseFilter = "";
      DatasetsManager.categoryFilter = "";
      DatasetsManager.visibilityFilter = "";
      DatasetsManager.viewMode = "mine";
      DatasetsManager.currentPage = 1;
      DatasetsManager.loadDatasets();

      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("My Datasets: Showing datasets uploaded by you");
    },

    openBookmarked() {
      this.activeMode = "bookmarked";
      this.activeDb = null;
      this.activeTab = "datasets";

      // 1. Hide general dashboard overview, analytics, requests
      const overviewGroup = document.getElementById("dashboardOverviewGroup");
      if (overviewGroup) overviewGroup.style.display = "none";

      const analyticsWrap = document.getElementById("analyticsScreenWrap");
      if (analyticsWrap) analyticsWrap.style.display = "none";

      const requestsWrap = document.getElementById("dataRequestsScreenWrap");
      if (requestsWrap) requestsWrap.style.display = "none";

      // 2. Expand grid to 1 column full width & hide right panel
      const dashboardGrid = document.querySelector(".dashboard-grid");
      if (dashboardGrid) dashboardGrid.classList.add("database-view-active");

      // 3. Show Screen Header & Specs
      const screenWrap = document.getElementById("databaseScreenHeaderWrap");
      if (screenWrap) screenWrap.style.display = "block";

      const tableCard = document.getElementById("datasetsTableSection");
      if (tableCard) tableCard.style.display = "block";

      this.switchTab("datasets");

      // 4. Update Hero Banner for Bookmarked Datasets
      const accent = "#F59E0B"; // Amber gold accent
      const hero = document.getElementById("dbEngineHero");
      if (hero) hero.style.setProperty("--engine-accent", accent);

      const iconWrap = document.getElementById("dbEngineHeroIcon");
      if (iconWrap) {
        iconWrap.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
          </svg>
        `;
        iconWrap.style.color = accent;
        iconWrap.style.background = `${accent}1F`;
        iconWrap.style.borderColor = `${accent}40`;
      }

      const nameEl = document.getElementById("dbEngineHeroName");
      if (nameEl) nameEl.textContent = "Bookmarked Datasets";

      const descEl = document.getElementById("dbEngineHeroDesc");
      if (descEl) descEl.textContent = "Your curated collection of starred datasets across all 6 database storage engines. Saved for instant reference, fast export, and schema tracking.";

      const breadcrumbCat = document.getElementById("breadcrumbCategory");
      if (breadcrumbCat) breadcrumbCat.textContent = "Datasets";

      const breadcrumbName = document.getElementById("breadcrumbDbName");
      if (breadcrumbName) breadcrumbName.textContent = "Bookmarked";

      const statusText = document.getElementById("dbEngineHeroStatusText");
      if (statusText) statusText.textContent = "Personal Starred Vault";

      const classText = document.getElementById("dbHeroClassificationText");
      if (classText) classText.textContent = "Scope: Starred Items";

      const countPill = document.getElementById("dbHeroDatasetCountText");
      if (countPill) countPill.textContent = "Loading bookmarks...";

      const portText = document.getElementById("dbHeroPortText");
      if (portText) portText.textContent = "Multi-Engine";

      const tabLabel1 = document.getElementById("dbTabDatasetsLabel");
      if (tabLabel1) tabLabel1.textContent = "Bookmarked Datasets";

      const tabCount = document.getElementById("dbTabDatasetsCount");
      if (tabCount) tabCount.textContent = "...";

      const tabLabel2 = document.getElementById("dbTabSpecsLabel");
      if (tabLabel2) tabLabel2.textContent = "Bookmark Management & Tips";

      const btnUploadText = document.getElementById("btnUploadToThisDbText");
      if (btnUploadText) btnUploadText.textContent = "+ Upload Dataset";

      // Populate Specs Panel for Bookmarks View
      const label1 = document.getElementById("specLabel1");
      if (label1) label1.textContent = "Bookmark Synchronization";
      const hostVal = document.getElementById("specHostVal");
      if (hostVal) hostVal.textContent = "Persistent Cloud Store";
      const sub1 = document.getElementById("specSub1");
      if (sub1) sub1.textContent = "Synced across your administrator sessions";

      const label2 = document.getElementById("specLabel2");
      if (label2) label2.textContent = "Engine Scope";
      const classVal = document.getElementById("specClassVal");
      if (classVal) classVal.textContent = "Universal Multi-Engine";
      const sub2 = document.getElementById("specSub2");
      if (sub2) sub2.textContent = "Bookmark datasets from MySQL, Postgres, Mongo, SQLServer, Neo4J, CouchBase";

      const label3 = document.getElementById("specLabel3");
      if (label3) label3.textContent = "Quick Actions";
      const formatsVal = document.getElementById("specFormatsVal");
      if (formatsVal) formatsVal.textContent = "Direct Download, Schema Inspect, Export";
      const sub3 = document.getElementById("specSub3");
      if (sub3) sub3.textContent = "Fast 1-click access to data tables and schemas";

      const label4 = document.getElementById("specLabel4");
      if (label4) label4.textContent = "Bookmark Shortcut";
      const driverVal = document.getElementById("specDriverVal");
      if (driverVal) driverVal.textContent = "Star Action Menu";
      const sub4 = document.getElementById("specSub4");
      if (sub4) sub4.textContent = "Click the 3-dots menu on any dataset row to bookmark or unbookmark";

      const featuresTitle = document.getElementById("specFeaturesTitle");
      if (featuresTitle) featuresTitle.textContent = "Bookmark Productivity Features";

      const chipsWrap = document.getElementById("specFeaturesChips");
      if (chipsWrap) {
        const bookmarkFeatures = [
          "1-Click Pin / Unpin",
          "Persistent Cloud Storage",
          "Multi-Engine Support",
          "Instant Schema Modal",
          "Direct File Downloads",
          "Quick Search & Filters"
        ];
        chipsWrap.innerHTML = bookmarkFeatures.map(f => `<span class="spec-feature-chip">${f}</span>`).join("");
      }

      // 5. Update Table Card Header
      const tableTitle = document.getElementById("tableSectionTitle");
      if (tableTitle) tableTitle.textContent = "Bookmarked Datasets";

      const tableSubtitle = document.getElementById("tableSectionSubtitle");
      if (tableSubtitle) tableSubtitle.textContent = "Showing datasets saved to your personal quick-access list";

      const viewAllLink = document.getElementById("viewAllDatasetsLink");
      if (viewAllLink) viewAllLink.style.display = "none";

      // 6. Highlight active sidebar item
      document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        if (item.id === "nav-bookmarked") {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });

      // 7. Load datasets: endpoint /api/datasets/bookmarked via viewMode = "bookmarked"
      DatasetsManager.databaseFilter = "";
      DatasetsManager.categoryFilter = "";
      DatasetsManager.visibilityFilter = "";
      DatasetsManager.viewMode = "bookmarked";
      DatasetsManager.currentPage = 1;
      DatasetsManager.loadDatasets();

      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("Bookmarked: Showing your saved datasets");
    },

    openSearch() {
      this.activeMode = "search";
      this.activeDb = null;
      this.activeTab = "datasets";

      // 1. Hide general dashboard overview, analytics, requests
      const overviewGroup = document.getElementById("dashboardOverviewGroup");
      if (overviewGroup) overviewGroup.style.display = "none";

      const analyticsWrap = document.getElementById("analyticsScreenWrap");
      if (analyticsWrap) analyticsWrap.style.display = "none";

      const requestsWrap = document.getElementById("dataRequestsScreenWrap");
      if (requestsWrap) requestsWrap.style.display = "none";

      // 2. Expand grid to 1 column full width & hide right panel
      const dashboardGrid = document.querySelector(".dashboard-grid");
      if (dashboardGrid) dashboardGrid.classList.add("database-view-active");

      // 3. Show Screen Header & Specs
      const screenWrap = document.getElementById("databaseScreenHeaderWrap");
      if (screenWrap) screenWrap.style.display = "block";

      const tableCard = document.getElementById("datasetsTableSection");
      if (tableCard) tableCard.style.display = "block";

      this.switchTab("datasets");

      // 4. Update Hero Banner for Dataset Search & Filter Engine
      const accent = "#3B82F6"; // Electric blue accent
      const hero = document.getElementById("dbEngineHero");
      if (hero) hero.style.setProperty("--engine-accent", accent);

      const iconWrap = document.getElementById("dbEngineHeroIcon");
      if (iconWrap) {
        iconWrap.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        `;
        iconWrap.style.color = accent;
        iconWrap.style.background = `${accent}1F`;
        iconWrap.style.borderColor = `${accent}40`;
      }

      const nameEl = document.getElementById("dbEngineHeroName");
      if (nameEl) nameEl.textContent = "Dataset Search & Filter Engine";

      const descEl = document.getElementById("dbEngineHeroDesc");
      if (descEl) descEl.textContent = "Search across all datasets using keywords, schema column attributes, database engines, category domains, and access tiers.";

      const breadcrumbCat = document.getElementById("breadcrumbCategory");
      if (breadcrumbCat) breadcrumbCat.textContent = "Tools";

      const breadcrumbName = document.getElementById("breadcrumbDbName");
      if (breadcrumbName) breadcrumbName.textContent = "Search & Query";

      const statusText = document.getElementById("dbEngineHeroStatusText");
      if (statusText) statusText.textContent = "Query Engine Active";

      const classText = document.getElementById("dbHeroClassificationText");
      if (classText) classText.textContent = "Global Full-Text Search";

      const countPill = document.getElementById("dbHeroDatasetCountText");
      if (countPill) countPill.textContent = "Search indexing ready";

      const portText = document.getElementById("dbHeroPortText");
      if (portText) portText.textContent = "Multi-Engine Query";

      const tabLabel1 = document.getElementById("dbTabDatasetsLabel");
      if (tabLabel1) tabLabel1.textContent = "Search Results";

      const tabCount = document.getElementById("dbTabDatasetsCount");
      if (tabCount) tabCount.textContent = "...";

      const tabLabel2 = document.getElementById("dbTabSpecsLabel");
      if (tabLabel2) tabLabel2.textContent = "Query Syntax & Capabilities";

      const btnUploadText = document.getElementById("btnUploadToThisDbText");
      if (btnUploadText) btnUploadText.textContent = "+ Upload Dataset";

      // Populate Specs Panel for Search View
      const label1 = document.getElementById("specLabel1");
      if (label1) label1.textContent = "Search Query Capabilities";
      const hostVal = document.getElementById("specHostVal");
      if (hostVal) hostVal.textContent = "Keyword & Substring Matching";
      const sub1 = document.getElementById("specSub1");
      if (sub1) sub1.textContent = "Matches titles, descriptions, schema fields, and tags";

      const label2 = document.getElementById("specLabel2");
      if (label2) label2.textContent = "Multi-Engine Filtering";
      const classVal = document.getElementById("specClassVal");
      if (classVal) classVal.textContent = "Universal 6 Databases";
      const sub2 = document.getElementById("specSub2");
      if (sub2) sub2.textContent = "Filter queries by MySQL, Postgres, MongoDB, CouchBase, Neo4J, SQLServer";

      const label3 = document.getElementById("specLabel3");
      if (label3) label3.textContent = "Domain Category Scopes";
      const formatsVal = document.getElementById("specFormatsVal");
      if (formatsVal) formatsVal.textContent = "7 Built-in Categories";
      const sub3 = document.getElementById("specSub3");
      if (sub3) sub3.textContent = "Education, Finance, Healthcare, Transportation, Business, Demographics, Environment";

      const label4 = document.getElementById("specLabel4");
      if (label4) label4.textContent = "Real-Time Debounce";
      const driverVal = document.getElementById("specDriverVal");
      if (driverVal) driverVal.textContent = "300ms Input Debounce";
      const sub4 = document.getElementById("specSub4");
      if (sub4) sub4.textContent = "Instant responsive table updates as you type";

      const featuresTitle = document.getElementById("specFeaturesTitle");
      if (featuresTitle) featuresTitle.textContent = "Search Engine Index Features";

      const chipsWrap = document.getElementById("specFeaturesChips");
      if (chipsWrap) {
        const searchFeatures = [
          "Full-Text Keyword Search",
          "Target Database Selector",
          "Domain Taxonomy Filtering",
          "Format Extension Filter",
          "Public / Private Scopes",
          "Instant Schema Modal View"
        ];
        chipsWrap.innerHTML = searchFeatures.map(f => `<span class="spec-feature-chip">${f}</span>`).join("");
      }

      // 5. Update Table Card Header
      const tableTitle = document.getElementById("tableSectionTitle");
      if (tableTitle) tableTitle.textContent = "Search Results";

      const tableSubtitle = document.getElementById("tableSectionSubtitle");
      if (tableSubtitle) tableSubtitle.textContent = "Type in the search bar below or apply filters to locate datasets";

      const viewAllLink = document.getElementById("viewAllDatasetsLink");
      if (viewAllLink) viewAllLink.style.display = "none";

      // 6. Highlight active sidebar item
      document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        if (item.id === "nav-search-tool") {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });

      // 7. Load datasets
      DatasetsManager.viewMode = "all";
      DatasetsManager.currentPage = 1;
      DatasetsManager.loadDatasets();

      // Focus search input with glow animation
      const searchInput = document.getElementById("globalSearchInput");
      if (searchInput) {
        searchInput.focus();
        searchInput.classList.remove("search-pulse");
        void searchInput.offsetWidth;
        searchInput.classList.add("search-pulse");
        setTimeout(() => searchInput.classList.remove("search-pulse"), 2500);
      }

      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("Search Engine ready: Enter keywords or filters below");
    },

    openAnalytics() {
      this.activeMode = "analytics";
      this.activeDb = null;

      // 1. Hide other views
      const overviewGroup = document.getElementById("dashboardOverviewGroup");
      if (overviewGroup) overviewGroup.style.display = "none";

      const screenWrap = document.getElementById("databaseScreenHeaderWrap");
      if (screenWrap) screenWrap.style.display = "none";

      const tableCard = document.getElementById("datasetsTableSection");
      if (tableCard) tableCard.style.display = "none";

      const specsPanel = document.getElementById("dbSpecsPanel");
      if (specsPanel) specsPanel.style.display = "none";

      const requestsWrap = document.getElementById("dataRequestsScreenWrap");
      if (requestsWrap) requestsWrap.style.display = "none";

      // 2. Expand grid to 1 column full width & hide right panel
      const dashboardGrid = document.querySelector(".dashboard-grid");
      if (dashboardGrid) dashboardGrid.classList.add("database-view-active");

      // 3. Show Analytics Screen
      const analyticsWrap = document.getElementById("analyticsScreenWrap");
      if (analyticsWrap) analyticsWrap.style.display = "block";

      // 4. Highlight active sidebar item
      document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        if (item.id === "nav-analytics-tool") {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });

      // 5. Load telemetry
      AnalyticsScreenManager.loadTelemetry(AnalyticsScreenManager.currentTimeframe || 30);

      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("Switched to Platform Analytics Screen");
    },

    openDataRequests() {
      this.activeMode = "requests";
      this.activeDb = null;

      // 1. Hide other views
      const overviewGroup = document.getElementById("dashboardOverviewGroup");
      if (overviewGroup) overviewGroup.style.display = "none";

      const screenWrap = document.getElementById("databaseScreenHeaderWrap");
      if (screenWrap) screenWrap.style.display = "none";

      const tableCard = document.getElementById("datasetsTableSection");
      if (tableCard) tableCard.style.display = "none";

      const specsPanel = document.getElementById("dbSpecsPanel");
      if (specsPanel) specsPanel.style.display = "none";

      const analyticsWrap = document.getElementById("analyticsScreenWrap");
      if (analyticsWrap) analyticsWrap.style.display = "none";

      // 2. Expand grid to 1 column full width & hide right panel
      const dashboardGrid = document.querySelector(".dashboard-grid");
      if (dashboardGrid) dashboardGrid.classList.add("database-view-active");

      // 3. Show Data Requests Screen
      const requestsWrap = document.getElementById("dataRequestsScreenWrap");
      if (requestsWrap) requestsWrap.style.display = "block";

      // 4. Highlight active sidebar item
      document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        if (item.id === "nav-requests-tool") {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });

      // 5. Load requests
      DataRequestsManager.loadRequests();

      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("Switched to Data Requests Collaboration Board");
    },

    openProfile() {
      this.activeMode = "profile";
      this.activeDb = null;

      // 1. Hide other views
      const overviewGroup = document.getElementById("dashboardOverviewGroup");
      if (overviewGroup) overviewGroup.style.display = "none";

      const screenWrap = document.getElementById("databaseScreenHeaderWrap");
      if (screenWrap) screenWrap.style.display = "none";

      const tableCard = document.getElementById("datasetsTableSection");
      if (tableCard) tableCard.style.display = "none";

      const specsPanel = document.getElementById("dbSpecsPanel");
      if (specsPanel) specsPanel.style.display = "none";

      const analyticsWrap = document.getElementById("analyticsScreenWrap");
      if (analyticsWrap) analyticsWrap.style.display = "none";

      const requestsWrap = document.getElementById("dataRequestsScreenWrap");
      if (requestsWrap) requestsWrap.style.display = "none";

      const settingsWrap = document.getElementById("settingsScreenWrap");
      if (settingsWrap) settingsWrap.style.display = "none";

      // 2. Expand grid to 1 column full width & hide right panel
      const dashboardGrid = document.querySelector(".dashboard-grid");
      if (dashboardGrid) dashboardGrid.classList.add("database-view-active");

      // 3. Show Profile Screen
      const profileWrap = document.getElementById("profileScreenWrap");
      if (profileWrap) profileWrap.style.display = "block";

      // 4. Highlight active sidebar item
      document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        if (item.id === "nav-profile") {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });

      // 5. Populate profile data
      if (typeof ProfileManager !== "undefined") {
        ProfileManager.loadProfile();
      }

      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("Opened Administrator Profile");
    },

    openSettings() {
      this.activeMode = "settings";
      this.activeDb = null;

      // 1. Hide other views
      const overviewGroup = document.getElementById("dashboardOverviewGroup");
      if (overviewGroup) overviewGroup.style.display = "none";

      const screenWrap = document.getElementById("databaseScreenHeaderWrap");
      if (screenWrap) screenWrap.style.display = "none";

      const tableCard = document.getElementById("datasetsTableSection");
      if (tableCard) tableCard.style.display = "none";

      const specsPanel = document.getElementById("dbSpecsPanel");
      if (specsPanel) specsPanel.style.display = "none";

      const analyticsWrap = document.getElementById("analyticsScreenWrap");
      if (analyticsWrap) analyticsWrap.style.display = "none";

      const requestsWrap = document.getElementById("dataRequestsScreenWrap");
      if (requestsWrap) requestsWrap.style.display = "none";

      const profileWrap = document.getElementById("profileScreenWrap");
      if (profileWrap) profileWrap.style.display = "none";

      // 2. Expand grid to 1 column full width & hide right panel
      const dashboardGrid = document.querySelector(".dashboard-grid");
      if (dashboardGrid) dashboardGrid.classList.add("database-view-active");

      // 3. Show Settings Screen
      const settingsWrap = document.getElementById("settingsScreenWrap");
      if (settingsWrap) settingsWrap.style.display = "block";

      // 4. Highlight active sidebar item
      document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        if (item.id === "nav-settings") {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });

      // 5. Populate settings data
      if (typeof SettingsManager !== "undefined") {
        SettingsManager.loadSettings();
      }

      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("Opened Platform Settings");
    },

    closeDatabaseScreen() {
      this.activeMode = null;
      this.activeDb = null;

      const overviewGroup = document.getElementById("dashboardOverviewGroup");
      if (overviewGroup) overviewGroup.style.display = "flex";

      const screenWrap = document.getElementById("databaseScreenHeaderWrap");
      if (screenWrap) screenWrap.style.display = "none";

      const analyticsWrap = document.getElementById("analyticsScreenWrap");
      if (analyticsWrap) analyticsWrap.style.display = "none";

      const requestsWrap = document.getElementById("dataRequestsScreenWrap");
      if (requestsWrap) requestsWrap.style.display = "none";

      const profileWrap = document.getElementById("profileScreenWrap");
      if (profileWrap) profileWrap.style.display = "none";

      const settingsWrap = document.getElementById("settingsScreenWrap");
      if (settingsWrap) settingsWrap.style.display = "none";

      const dashboardGrid = document.querySelector(".dashboard-grid");
      if (dashboardGrid) dashboardGrid.classList.remove("database-view-active");

      const tableCard = document.getElementById("datasetsTableSection");
      if (tableCard) tableCard.style.display = "block";

      const specsPanel = document.getElementById("dbSpecsPanel");
      if (specsPanel) specsPanel.style.display = "none";

      const tableTitle = document.getElementById("tableSectionTitle");
      if (tableTitle) tableTitle.textContent = "Recent Datasets";

      const tableSubtitle = document.getElementById("tableSectionSubtitle");
      if (tableSubtitle) tableSubtitle.textContent = "Explore, analyze, and manage multi-database datasets";

      const viewAllLink = document.getElementById("viewAllDatasetsLink");
      if (viewAllLink) viewAllLink.style.display = "inline";

      document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        if (item.id === "nav-dashboard") {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });

      DatasetsManager.databaseFilter = "";
      DatasetsManager.visibilityFilter = "";
      DatasetsManager.viewMode = "all";
      DatasetsManager.currentPage = 1;
      DatasetsManager.loadDatasets();
      DashboardManager.loadStats();
    }
  };

  // =========================================================================
  // 10.5. ANALYTICS & DATA REQUESTS SCREEN MANAGERS
  // =========================================================================

  const AnalyticsScreenManager = {
    currentTimeframe: 30,
    stats: null,

    init() {
      this.bindEvents();
    },

    bindEvents() {
      document.getElementById("btnBackFromAnalytics")?.addEventListener("click", () => {
        DatabaseScreenManager.closeDatabaseScreen();
      });

      document.getElementById("breadcrumbDashboardAnalytics")?.addEventListener("click", (e) => {
        e.preventDefault();
        DatabaseScreenManager.closeDatabaseScreen();
      });

      document.querySelectorAll("#analyticsTimeframeBtns .timeframe-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const days = parseInt(btn.dataset.days, 10) || 30;
          this.currentTimeframe = days;
          document.querySelectorAll("#analyticsTimeframeBtns .timeframe-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          const pill = document.getElementById("analyticsPillTimeframe");
          if (pill) pill.textContent = `Timeframe: Last ${days === 365 ? "1 Year" : days + " Days"}`;
          const badge = document.getElementById("activityVelocityBadge");
          if (badge) badge.textContent = `Last ${days === 365 ? "1 Year" : days + " Days"}`;
          this.loadTelemetry(days);
        });
      });
    },

    async loadTelemetry(days = 30) {
      try {
        const stats = await apiClient.request(`/api/dashboard/stats?days=${days}`);
        this.stats = stats;
        this.renderTelemetry(stats);
      } catch (err) {
        console.error("Failed to load analytics telemetry:", err);
        showToast("Failed to load analytics telemetry", "error");
      }
    },

    renderTelemetry(stats) {
      if (!stats) return;

      const kpis = stats.kpis || {};
      const totalDatasets = kpis.totalDatasets || 0;
      const totalContributors = kpis.totalContributors || 0;
      const categoriesCount = kpis.categoriesCount || 0;
      const totalDownloads = kpis.totalDownloads || 0;

      const elTotal = document.getElementById("telemetryTotalDatasets");
      if (elTotal) elTotal.textContent = String(totalDatasets);

      const elContrib = document.getElementById("telemetryContributors");
      if (elContrib) elContrib.textContent = String(totalContributors);

      const elCat = document.getElementById("telemetryCategories");
      if (elCat) elCat.textContent = String(categoriesCount);

      const elDown = document.getElementById("telemetryDownloads");
      if (elDown) elDown.textContent = String(totalDownloads);

      const pillTotal = document.getElementById("analyticsPillTotalDatasets");
      const totalStorageStr = kpis.totalStorageFormatted || "0 B";
      if (pillTotal) pillTotal.textContent = `${totalDatasets} Datasets Indexed \u2022 ${totalStorageStr}`;

      this.renderEngineDistribution(stats.databaseEngines || {}, totalDatasets, stats.databaseStorage || {});
      this.renderCategoryBreakdown(stats.categories || {}, totalDatasets);
      this.renderTimelineVelocity(stats.timeline || []);
      this.renderDatabaseHealthMatrix(stats.databaseEngines || {}, stats.databaseStorage || {});
    },

    renderEngineDistribution(engines, total, storage = {}) {
      const container = document.getElementById("engineAnalyticsList");
      if (!container) return;

      const engineColors = {
        MySQL: { accent: "#2563EB", port: "Port 3306" },
        SQLServer: { accent: "#8B5CF6", port: "Port 1433" },
        PostgreSQL: { accent: "#3B82F6", port: "Port 5432" },
        MongoDB: { accent: "#10B981", port: "Port 27017" },
        Neo4J: { accent: "#F59E0B", port: "Port 7687" },
        CouchBase: { accent: "#EF4444", port: "Port 8091" }
      };

      const keys = Object.keys(engineColors);
      const rows = keys.map(engine => {
        const count = engines[engine] || 0;
        const formattedStorage = storage[engine]?.formatted || "0 B";
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const meta = engineColors[engine];

        return `
          <div class="engine-bar-row" style="margin-bottom: 14px; cursor: pointer;" title="Click to inspect ${engine} screen" data-engine-click="${engine}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${meta.accent};"></span>
                <span style="font-weight: 700; font-size: 13px; color: var(--text-primary);">${engine}</span>
                <span style="font-size: 11px; color: var(--text-muted); font-family: monospace;">${meta.port}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 12.5px; font-weight: 700; color: var(--text-primary);">${count} datasets (${formattedStorage})</span>
                <span style="font-size: 11.5px; color: var(--text-muted); min-width: 32px; text-align: right;">${pct}%</span>
              </div>
            </div>
            <div style="width: 100%; height: 8px; background: var(--bg-hover, rgba(255,255,255,0.06)); border-radius: 9999px; overflow: hidden;">
              <div style="width: ${Math.max(pct, count > 0 ? 4 : 0)}%; height: 100%; background: ${meta.accent}; border-radius: 9999px; transition: width 0.5s ease;"></div>
            </div>
          </div>
        `;
      }).join("");

      container.innerHTML = rows;

      container.querySelectorAll("[data-engine-click]").forEach(el => {
        el.addEventListener("click", () => {
          const dbName = el.dataset.engineClick;
          if (dbName && typeof DatabaseScreenManager !== "undefined") {
            DatabaseScreenManager.openDatabase(dbName);
          }
        });
      });
    },

    renderCategoryBreakdown(categories, total) {
      const container = document.getElementById("categoryAnalyticsList");
      if (!container) return;

      const categoryPalette = {
        Education: "#3B82F6",
        Finance: "#10B981",
        Healthcare: "#EF4444",
        Transportation: "#F59E0B",
        Business: "#8B5CF6",
        Demographics: "#06B6D4",
        Environment: "#14B8A6"
      };

      const keys = Object.keys(categoryPalette);
      const rows = keys.map(cat => {
        const count = categories[cat] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const color = categoryPalette[cat] || "#3B82F6";

        return `
          <div class="category-bar-row" style="margin-bottom: 12px; cursor: pointer;" title="Click to view ${cat} datasets" data-category-click="${cat}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: ${color};"></span>
                <span style="font-weight: 600; font-size: 12.5px; color: var(--text-primary);">${cat}</span>
              </div>
              <span style="font-size: 12px; font-weight: 600; color: var(--text-muted);">${count} (${pct}%)</span>
            </div>
            <div style="width: 100%; height: 6px; background: var(--bg-hover, rgba(255,255,255,0.06)); border-radius: 9999px; overflow: hidden;">
              <div style="width: ${Math.max(pct, count > 0 ? 3 : 0)}%; height: 100%; background: ${color}; border-radius: 9999px; transition: width 0.5s ease;"></div>
            </div>
          </div>
        `;
      }).join("");

      container.innerHTML = rows;

      container.querySelectorAll("[data-category-click]").forEach(el => {
        el.addEventListener("click", () => {
          const cat = el.dataset.categoryClick;
          if (cat && typeof DatabaseScreenManager !== "undefined") {
            DatabaseScreenManager.closeDatabaseScreen();
            DatasetsManager.categoryFilter = cat;
            const filterEl = document.getElementById("categoryFilter");
            if (filterEl) filterEl.value = cat;
            DatasetsManager.currentPage = 1;
            DatasetsManager.loadDatasets();
            showToast(`Filtered datasets by category: ${cat}`);
          }
        });
      });
    },

    renderTimelineVelocity(timeline) {
      const container = document.getElementById("analyticsTimelineChart");
      if (!container) return;

      if (!Array.isArray(timeline) || timeline.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 30px; color: var(--text-muted); font-size: 13px;">
            No ingestion timeline events recorded for this timeframe yet.
          </div>
        `;
        return;
      }

      const maxActivity = Math.max(...timeline.map(t => (t.uploads || 0) + (t.queries || 0)), 5);

      const bars = timeline.map(point => {
        const uploads = point.uploads || 0;
        const queries = point.queries || 0;
        const total = uploads + queries;
        const heightPct = Math.round((total / maxActivity) * 100);
        const dateStr = point.date || point.day || "";
        const formattedDate = dateStr.length >= 10 ? dateStr.substring(5) : dateStr;

        return `
          <div style="display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 14px; height: 100%; justify-content: flex-end; position: relative;" title="${dateStr}: ${uploads} uploads, ${queries} queries">
            <div style="font-size: 10px; font-weight: 700; color: var(--primary-400); margin-bottom: 4px; opacity: ${total > 0 ? 1 : 0};">${total}</div>
            <div style="width: 100%; max-width: 22px; height: ${Math.max(heightPct, 6)}%; background: linear-gradient(180deg, var(--primary-500) 0%, rgba(37,99,235,0.4) 100%); border-radius: 4px 4px 0 0; transition: height 0.3s ease;"></div>
            <div style="font-size: 9px; color: var(--text-muted); margin-top: 6px; white-space: nowrap; transform: rotate(-30deg); transform-origin: top left;">${formattedDate}</div>
          </div>
        `;
      }).join("");

      container.innerHTML = `
        <div style="display: flex; align-items: flex-end; gap: 8px; height: 160px; padding: 10px 0 24px 0; width: 100%; overflow-x: auto;">
          ${bars}
        </div>
      `;
    },

    renderDatabaseHealthMatrix(engines, storage = {}) {
      const container = document.getElementById("dbHealthMatrix");
      if (!container) return;

      const matrixData = [
        { name: "MySQL", port: "3306", latency: "1.2ms" },
        { name: "PostgreSQL", port: "5432", latency: "0.8ms" },
        { name: "MongoDB", port: "27017", latency: "1.5ms" },
        { name: "SQLServer", port: "1433", latency: "2.1ms" },
        { name: "Neo4J", port: "7687", latency: "1.9ms" },
        { name: "CouchBase", port: "8091", latency: "0.9ms" }
      ];

      container.innerHTML = matrixData.map(db => {
        const count = engines[db.name] || 0;
        const formattedStorage = storage[db.name]?.formatted || "0 B";
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-hover, rgba(255,255,255,0.03)); border: 1px solid var(--border-color); border-radius: 10px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="status-pulse-dot"></span>
              <div>
                <div style="font-weight: 700; font-size: 13px; color: var(--text-primary);">${db.name}</div>
                <div style="font-size: 11px; color: var(--text-muted); font-family: monospace;">Port: ${db.port} \u2022 ${db.latency} ping</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 12px; font-weight: 600; color: var(--text-muted);">${count} datasets \u2022 ${formattedStorage}</span>
              <button class="btn-secondary" style="padding: 4px 10px; font-size: 11px; font-weight: 600;" data-open-db-screen="${db.name}">
                Inspect &rarr;
              </button>
            </div>
          </div>
        `;
      }).join("");

      container.querySelectorAll("[data-open-db-screen]").forEach(btn => {
        btn.addEventListener("click", () => {
          const dbName = btn.dataset.openDbScreen;
          if (dbName && typeof DatabaseScreenManager !== "undefined") {
            DatabaseScreenManager.openDatabase(dbName);
          }
        });
      });
    }
  };

  const DataRequestsManager = {
    requests: [],
    statusFilter: "ALL",
    searchQuery: "",
    counts: { ALL: 0, PENDING: 0, APPROVED: 0, IN_PROGRESS: 0, FULFILLED: 0 },

    init() {
      this.bindEvents();
    },

    bindEvents() {
      document.getElementById("btnBackFromRequests")?.addEventListener("click", () => {
        DatabaseScreenManager.closeDatabaseScreen();
      });

      document.getElementById("breadcrumbDashboardRequests")?.addEventListener("click", (e) => {
        e.preventDefault();
        DatabaseScreenManager.closeDatabaseScreen();
      });

      // Filter tabs
      document.querySelectorAll("#requestsStatusTabs .req-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          document.querySelectorAll("#requestsStatusTabs .req-tab-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          this.statusFilter = btn.dataset.status || "ALL";
          this.loadRequests();
        });
      });

      // Search input with debounce
      const searchInput = document.getElementById("requestsSearchInput");
      if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener("input", (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.searchQuery = e.target.value.trim();
            this.loadRequests();
          }, 250);
        });
      }

      // Submit request modal open/close
      const modal = document.getElementById("submitRequestModal");
      document.getElementById("btnOpenNewRequestModal")?.addEventListener("click", () => {
        if (modal) {
          modal.style.display = "flex";
          document.getElementById("reqTitleInput")?.focus();
        }
      });

      document.getElementById("closeRequestModal")?.addEventListener("click", () => {
        if (modal) modal.style.display = "none";
      });

      document.getElementById("cancelRequestModalBtn")?.addEventListener("click", () => {
        if (modal) modal.style.display = "none";
      });

      modal?.addEventListener("click", (e) => {
        if (e.target === modal) modal.style.display = "none";
      });

      // Submit form
      document.getElementById("newRequestForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.submitNewRequest();
      });
    },

    async loadRequests() {
      const container = document.getElementById("requestsListContainer");
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; padding: 40px; color: var(--text-muted);">
            <span class="spinner" style="border-color: rgba(245,158,11,0.2); border-top-color: #F59E0B; margin-right: 8px; vertical-align: middle;"></span>
            Loading data requests...
          </div>
        `;
      }

      try {
        const params = new URLSearchParams();
        if (this.statusFilter && this.statusFilter !== "ALL") {
          params.set("status", this.statusFilter);
        }
        if (this.searchQuery) {
          params.set("search", this.searchQuery);
        }

        const res = await apiClient.request(`/api/data-requests?${params.toString()}`);
        this.requests = res.data || [];
        this.counts = res.counts || { ALL: 0, PENDING: 0, APPROVED: 0, IN_PROGRESS: 0, FULFILLED: 0 };

        this.updateBadgeCounts();
        this.renderRequests();
      } catch (err) {
        console.error("Failed to load data requests:", err);
        if (container) {
          container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: var(--rose-500);">
              Failed to load data requests. ${escapeHtml(err.message)}
              <div style="margin-top: 10px;">
                <button class="btn-secondary" id="btnRetryRequests" style="padding: 6px 14px; font-size: 12px;">Retry</button>
              </div>
            </div>
          `;
          document.getElementById("btnRetryRequests")?.addEventListener("click", () => this.loadRequests());
        }
      }
    },

    updateBadgeCounts() {
      const bAll = document.getElementById("reqBadgeAll");
      if (bAll) bAll.textContent = String(this.counts.ALL || 0);

      const bPen = document.getElementById("reqBadgePending");
      if (bPen) bPen.textContent = String(this.counts.PENDING || 0);

      const bApp = document.getElementById("reqBadgeApproved");
      if (bApp) bApp.textContent = String(this.counts.APPROVED || 0);

      const bPro = document.getElementById("reqBadgeProgress");
      if (bPro) bPro.textContent = String(this.counts.IN_PROGRESS || 0);

      const bFul = document.getElementById("reqBadgeFulfilled");
      if (bFul) bFul.textContent = String(this.counts.FULFILLED || 0);

      const pillCount = document.getElementById("requestsPillCount");
      if (pillCount) pillCount.textContent = `${this.counts.ALL || 0} Open Requests`;

      const pillFulfilled = document.getElementById("requestsPillFulfilled");
      if (pillFulfilled) pillFulfilled.textContent = `${this.counts.FULFILLED || 0} Fulfilled`;
    },

    renderRequests() {
      const container = document.getElementById("requestsListContainer");
      if (!container) return;

      if (this.requests.length === 0) {
        container.innerHTML = `
          <div class="db-empty-state" style="padding: 48px 24px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 14px; text-align: center;">
            <div class="db-empty-icon" style="color: #F59E0B; background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.25); margin: 0 auto 16px auto;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </div>
            <h4 class="db-empty-title" style="margin-bottom: 8px;">No Data Requests Found</h4>
            <p class="db-empty-desc" style="max-width: 520px; margin: 0 auto 18px auto; color: var(--text-muted); font-size: 13px;">
              ${this.searchQuery ? `No requests match "${escapeHtml(this.searchQuery)}". Try clearing your search.` : `There are currently no community requests in the "${this.statusFilter}" state. Submit the first proposal to get started.`}
            </p>
            <button class="btn-primary" id="btnEmptyNewRequest" style="padding: 9px 20px; font-weight: 700; font-size: 13px;">
              + Submit a Data Request
            </button>
          </div>
        `;

        document.getElementById("btnEmptyNewRequest")?.addEventListener("click", () => {
          const modal = document.getElementById("submitRequestModal");
          if (modal) {
            modal.style.display = "flex";
            document.getElementById("reqTitleInput")?.focus();
          }
        });
        return;
      }

      const priorityClasses = {
        URGENT: "priority-urgent",
        HIGH: "priority-high",
        MEDIUM: "priority-medium",
        LOW: "priority-low"
      };

      const statusClasses = {
        PENDING: "status-badge-pending",
        APPROVED: "status-badge-approved",
        IN_PROGRESS: "status-badge-in_progress",
        FULFILLED: "status-badge-fulfilled"
      };

      const html = this.requests.map(req => {
        const pClass = priorityClasses[req.priority] || "priority-medium";
        const sClass = statusClasses[req.status] || "status-badge-pending";
        const isFulfilled = req.status === "FULFILLED";

        return `
          <div class="request-card-item" data-req-id="${req.id}">
            <!-- Left Upvote Box -->
            <div class="request-upvote-box ${req.hasVoted ? 'voted' : ''}" data-vote-req-id="${req.id}" title="${req.hasVoted ? 'Remove upvote' : 'Upvote this dataset request'}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="${req.hasVoted ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
              <span class="request-upvote-count">${req.votes || 0}</span>
            </div>

            <!-- Main Content -->
            <div class="request-content-main">
              <div class="request-header-row">
                <div>
                  <h3 class="request-title-text">${escapeHtml(req.title)}</h3>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="priority-pill ${pClass}">${escapeHtml(req.priority)}</span>
                  <span class="priority-pill ${sClass}">${escapeHtml(req.status.replace('_', ' '))}</span>
                </div>
              </div>

              <p class="request-desc-text">${escapeHtml(req.description)}</p>

              <div class="request-meta-row">
                <span class="db-meta-pill" style="color: var(--text-primary);">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                  ${escapeHtml(req.category)}
                </span>
                <span class="db-meta-pill" style="color: var(--primary-400);">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                  ${escapeHtml(req.preferredEngine)}
                </span>
                <span class="db-meta-pill">
                  Format: ${escapeHtml(req.preferredFormat)}
                </span>
                <span style="display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); font-size: 11.5px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  ${escapeHtml(req.requestedBy)} (${escapeHtml(req.requesterRole || 'User')})
                </span>
              </div>
            </div>

            <!-- Right Actions -->
            <div class="request-right-actions">
              ${!isFulfilled ? `
                <button class="btn-primary" style="padding: 7px 14px; font-size: 12px; font-weight: 700; white-space: nowrap;" data-fulfill-req-id="${req.id}" data-req-title="${escapeHtml(req.title)}" data-req-engine="${escapeHtml(req.preferredEngine)}">
                  + Fulfill Request
                </button>
              ` : `
                <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: #10B981; padding: 6px 12px; background: rgba(16,185,129,0.1); border-radius: 8px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  Fulfilled
                </span>
              `}
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                ${timeAgo(req.createdAt)}
              </div>
            </div>
          </div>
        `;
      }).join("");

      container.innerHTML = html;

      // Bind Upvote click
      container.querySelectorAll("[data-vote-req-id]").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const reqId = btn.dataset.voteReqId;
          if (reqId) await this.toggleVote(reqId);
        });
      });

      // Bind Fulfill click
      container.querySelectorAll("[data-fulfill-req-id]").forEach(btn => {
        btn.addEventListener("click", () => {
          const title = btn.dataset.reqTitle;
          const engine = btn.dataset.reqEngine;

          const uploadModal = document.getElementById("uploadModal");
          if (uploadModal) {
            uploadModal.style.display = "flex";
            const titleInput = document.getElementById("datasetTitleInput");
            if (titleInput && title) titleInput.value = title;
            const engineSelect = document.getElementById("databaseEngineSelect");
            if (engineSelect && engine) engineSelect.value = engine;
            showToast(`Upload dataset to fulfill request: "${title}"`);
          }
        });
      });
    },

    async toggleVote(reqId) {
      try {
        const res = await apiClient.request(`/api/data-requests/${reqId}/vote`, {
          method: "POST"
        });
        showToast(res.message || "Vote recorded", "info");
        await this.loadRequests();
      } catch (err) {
        console.error("Failed to vote:", err);
        showToast("Failed to record vote", "error");
      }
    },

    async submitNewRequest() {
      const title = document.getElementById("reqTitleInput")?.value.trim();
      const description = document.getElementById("reqDescInput")?.value.trim();
      const category = document.getElementById("reqCategorySelect")?.value || "Education";
      const preferredEngine = document.getElementById("reqEngineSelect")?.value || "PostgreSQL";
      const preferredFormat = document.getElementById("reqFormatSelect")?.value || "CSV";
      const priority = document.getElementById("reqPrioritySelect")?.value || "MEDIUM";

      if (!title || !description) {
        showToast("Please provide both title and description", "error");
        return;
      }

      const submitBtn = document.getElementById("btnSubmitNewRequest");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting...";
      }

      try {
        await apiClient.request("/api/data-requests", {
          method: "POST",
          body: {
            title,
            description,
            category,
            preferredEngine,
            preferredFormat,
            priority
          }
        });

        showToast("Data request submitted successfully!");
        const modal = document.getElementById("submitRequestModal");
        if (modal) modal.style.display = "none";
        document.getElementById("newRequestForm")?.reset();
        await this.loadRequests();
      } catch (err) {
        console.error("Failed to submit data request:", err);
        showToast(err.message || "Failed to submit request", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit Request";
        }
      }
    }
  };

  // =========================================================================
  // 10B. ADMINISTRATOR MANAGEMENT (Create Admin & Admin Directory)
  // =========================================================================

  const AdminManager = {
    admins: [],
    searchQuery: "",
    activeTab: "create",
    autoRefreshTimer: null,
    autoRefreshIntervalMs: 5000,

    init() {
      this.bindEvents();
    },

    startAutoRefresh() {
      if (this.autoRefreshTimer) {
        clearInterval(this.autoRefreshTimer);
      }
      const badge = document.getElementById("adminAutoRefreshBadge");
      if (badge) {
        badge.style.display = "inline-flex";
      }
      this.autoRefreshTimer = setInterval(() => {
        const modal = document.getElementById("createAdminModal");
        if (modal && modal.style.display !== "none") {
          this.loadAdmins(false);
        }
      }, this.autoRefreshIntervalMs);
    },

    stopAutoRefresh() {
      if (this.autoRefreshTimer) {
        clearInterval(this.autoRefreshTimer);
        this.autoRefreshTimer = null;
      }
      const badge = document.getElementById("adminAutoRefreshBadge");
      if (badge) {
        badge.style.display = "none";
      }
    },

    bindEvents() {
      // Top header button to open Create Admin modal
      const btnTop = document.getElementById("btnCreateAdminTop");
      if (btnTop) {
        btnTop.addEventListener("click", () => {
          this.openModal("create");
        });
      }

      // Close modal buttons
      document.getElementById("closeCreateAdminModal")?.addEventListener("click", () => {
        this.closeModal();
      });

      document.getElementById("cancelCreateAdminBtn")?.addEventListener("click", () => {
        this.closeModal();
      });

      // Close on clicking backdrop
      const modal = document.getElementById("createAdminModal");
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) {
            this.closeModal();
          }
        });
      }

      // Close on escape key
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal && modal.style.display !== "none") {
          this.closeModal();
        }
      });

      // Tabs switching
      document.querySelectorAll("#adminModalTabs .admin-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.adminTab;
          if (tab) this.switchTab(tab);
        });
      });

      // Create Admin Form submission
      const form = document.getElementById("createAdminForm");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          this.handleCreateAdmin();
        });
      }

      // Admin Directory Search
      const searchInput = document.getElementById("adminSearchInput");
      if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener("input", (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.searchQuery = e.target.value.trim().toLowerCase();
            this.renderAdminsList();
          }, 200);
        });
      }

      // Refresh button
      document.getElementById("btnRefreshAdmins")?.addEventListener("click", () => {
        this.loadAdmins(true);
      });

      // Sync to Firebase button
      document.getElementById("btnSyncFirebaseAdmins")?.addEventListener("click", async () => {
        const btn = document.getElementById("btnSyncFirebaseAdmins");
        if (!btn) return;
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner" style="width:12px;height:12px;margin-right:4px;"></span> Syncing...`;
        try {
          const res = await apiClient.request("/api/admins/sync-firebase", { method: "POST" });
          if (res?.success) {
            showToast(`Firebase synced: ${res.synced} users updated in Cloud Firestore`, "success");
          } else {
            showToast(res?.message || "Firebase synchronization completed", "info");
          }
        } catch (err) {
          console.error("Firebase sync error:", err);
          showToast(`Firebase sync failed: ${err.message}`, "error");
        } finally {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      });

      // Copy invite link modal events
      document.getElementById("btnModalCopyLink")?.addEventListener("click", () => {
        const input = document.getElementById("copyInviteUrlInput");
        if (input) {
          navigator.clipboard?.writeText(input.value).then(() => {
            showToast("Verification URL copied to clipboard!", "success");
          }).catch(() => {
            input.select();
            document.execCommand("copy");
            showToast("Verification URL copied to clipboard!", "success");
          });
        }
      });

      document.getElementById("btnModalOpenLink")?.addEventListener("click", () => {
        const input = document.getElementById("copyInviteUrlInput");
        if (input && input.value) {
          window.open(input.value, "_blank");
        }
      });

      const closeCopyModal = () => {
        const m = document.getElementById("copyInviteLinkModal");
        if (m) m.style.display = "none";
      };
      document.getElementById("closeCopyInviteModal")?.addEventListener("click", closeCopyModal);
      document.getElementById("btnDoneCopyInviteModal")?.addEventListener("click", closeCopyModal);
    },

    toLocalhostUrl(url) {
      if (!url) return "";
      try {
        const parsed = new URL(url, window.location.origin);
        return `${window.location.origin}${parsed.pathname}${parsed.search}`;
      } catch {
        return url.replace(/^https?:\/\/[^/]+/, window.location.origin);
      }
    },

    showCopyInviteModal(name, url) {
      const localUrl = this.toLocalhostUrl(url);
      const modal = document.getElementById("copyInviteLinkModal");
      const nameEl = document.getElementById("copyInviteAdminName");
      const urlInput = document.getElementById("copyInviteUrlInput");
      if (nameEl) nameEl.textContent = name || "Administrator";
      if (urlInput) urlInput.value = localUrl || "";
      if (modal) modal.style.display = "flex";

      // Automatically copy to clipboard if supported
      navigator.clipboard?.writeText(localUrl).then(() => {
        showToast("Verification link copied to clipboard!", "success");
      }).catch(() => {});
    },

    openModal(defaultTab = "create") {
      const modal = document.getElementById("createAdminModal");
      if (!modal) return;
      modal.style.display = "flex";
      this.clearAlerts();
      this.switchTab(defaultTab);
      // Silently preload directory count
      this.loadAdmins(false);
    },

    closeModal() {
      const modal = document.getElementById("createAdminModal");
      if (modal) modal.style.display = "none";
      this.clearAlerts();
    },

    clearAlerts() {
      const errEl = document.getElementById("createAdminErrorMsg");
      const succEl = document.getElementById("createAdminSuccessMsg");
      if (errEl) {
        errEl.style.display = "none";
        errEl.textContent = "";
      }
      if (succEl) {
        succEl.style.display = "none";
        succEl.textContent = "";
      }
    },

    switchTab(tab) {
      this.activeTab = tab;
      const tabBtns = document.querySelectorAll("#adminModalTabs .admin-tab-btn");
      tabBtns.forEach(btn => {
        if (btn.dataset.adminTab === tab) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });

      const createTab = document.getElementById("adminTabCreate");
      const directoryTab = document.getElementById("adminTabDirectory");

      if (tab === "create") {
        if (createTab) createTab.style.display = "block";
        if (directoryTab) directoryTab.style.display = "none";
        document.getElementById("adminNameInput")?.focus();
      } else {
        if (createTab) createTab.style.display = "none";
        if (directoryTab) directoryTab.style.display = "block";
        this.loadAdmins(false);
      }
    },

    async handleCreateAdmin() {
      const nameInput = document.getElementById("adminNameInput");
      const emailInput = document.getElementById("adminEmailInput");
      const submitBtn = document.getElementById("btnSubmitCreateAdmin");
      const errEl = document.getElementById("createAdminErrorMsg");
      const succEl = document.getElementById("createAdminSuccessMsg");

      this.clearAlerts();

      const name = nameInput?.value.trim();
      const email = emailInput?.value.trim();

      if (!name || !email) {
        if (errEl) {
          errEl.textContent = "Please fill in both full name and email address.";
          errEl.style.display = "block";
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 6px;"></span> Provisioning...`;
      }

      try {
        const payload = { name, email };
        const res = await apiClient.request("/api/admins", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        const verificationUrl = res?.verificationUrl ? this.toLocalhostUrl(res.verificationUrl) : "";

        if (succEl) {
          succEl.innerHTML = `
            <div style="font-weight: 700; margin-bottom: 4px; color: #10B981; font-size: 13.5px;">✓ Administrator Invited (Status: PENDING)</div>
            <div style="font-size: 12px; margin-bottom: 8px;">
              An email verification and password setup invitation was sent to <strong>${escapeHtml(email)}</strong>.<br>
              <strong>Security Rule:</strong> This account remains in <em>PENDING</em> status and <u>cannot log in or be activated</u> until the administrator verifies their email and establishes a password.
            </div>
            ${verificationUrl ? `
            <div style="margin-top: 10px; padding: 10px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 6px;">
              <div style="font-size: 11px; font-weight: 600; color: #38bdf8; margin-bottom: 4px;">Direct Verification Link (sent to user):</div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <input type="text" readonly value="${escapeHtml(verificationUrl)}" style="flex: 1; font-family: monospace; font-size: 11.5px; padding: 5px 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: #e2e8f0;">
                <button type="button" class="btn-secondary" onclick="navigator.clipboard?.writeText('${escapeHtml(verificationUrl)}'); showToast('Verification link copied!', 'success');" style="padding: 5px 10px; font-size: 11px; white-space: nowrap;">Copy Link</button>
              </div>
            </div>` : ""}
          `;
          succEl.style.display = "block";
        }

        if (verificationUrl) {
          this.showCopyInviteModal(name, verificationUrl);
        }

        showToast(`Administrator invited! Verification email sent to ${email}.`, "success");

        // Reset inputs
        if (nameInput) nameInput.value = "";
        if (emailInput) emailInput.value = "";

        // Reload admin list and activity feed
        await this.loadAdmins(false);
        if (typeof ActivityLogsManager !== "undefined") {
          ActivityLogsManager.loadRecentActivity();
        }

      } catch (err) {
        console.error("Failed to create admin:", err);
        let errorMsg = err.message || "Failed to provision administrator.";
        if (err.status === 403) {
          errorMsg = "Forbidden: Super Administrator privileges are required to provision administrators. Please sign in as a Super Admin.";
        } else if (err.status === 409 || errorMsg.includes("EMAIL_ALREADY_EXISTS")) {
          errorMsg = `An administrator with the email "${escapeHtml(email)}" already exists.`;
        }

        if (errEl) {
          errEl.textContent = errorMsg;
          errEl.style.display = "block";
        }
        showToast(errorMsg, "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Create Administrator</span>
          `;
        }
      }
    },

    async loadAdmins(showSuccessToast = false) {
      const container = document.getElementById("adminListContainer");
      if (!container) return;

      try {
        const previousStatusById = new Map(
          (this.admins || []).map(a => [a.id, (a.status || "").toUpperCase()])
        );

        const list = await apiClient.request("/api/admins");
        this.admins = Array.isArray(list) ? list : [];

        // Detect if any previously PENDING admin just became ACTIVE during auto-refresh
        if (previousStatusById.size > 0) {
          const newlyActivated = this.admins.filter(
            a => previousStatusById.get(a.id) === "PENDING" && (a.status || "").toUpperCase() === "ACTIVE"
          );
          if (newlyActivated.length > 0) {
            newlyActivated.forEach(a => {
              showToast(`Administrator "${a.name || a.email}" verified and is now ACTIVE!`, "success");
            });
            if (typeof ActivityLogsManager !== "undefined") {
              ActivityLogsManager.loadRecentActivity();
            }
          }
        }

        // Update badge count
        const countBadge = document.getElementById("adminDirectoryCount");
        if (countBadge) countBadge.textContent = this.admins.length;

        this.renderAdminsList();

        if (showSuccessToast) {
          showToast(`Refreshed ${this.admins.length} administrator profiles`);
        }
      } catch (err) {
        console.error("Failed to load admins:", err);
        const countBadge = document.getElementById("adminDirectoryCount");
        if (countBadge) countBadge.textContent = "!";

        if (err.status === 403) {
          container.innerHTML = `
            <div style="padding: 28px; text-align: center; color: var(--text-muted);">
              <div style="font-size: 28px; margin-bottom: 8px;">🔒</div>
              <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">Super Admin Access Required</div>
              <div style="font-size: 12px; margin-bottom: 12px;">Only Super Administrators can view and manage directory roles.</div>
              <button class="btn-secondary" id="btnSwitchToSuperAdminPrompt" style="font-size: 12px; padding: 6px 14px;">Sign In as Super Admin</button>
            </div>
          `;
          document.getElementById("btnSwitchToSuperAdminPrompt")?.addEventListener("click", () => {
            this.closeModal();
            AuthManager.showLoginModal();
          });
        } else {
          container.innerHTML = `
            <div style="padding: 24px; text-align: center; color: #EF4444; font-size: 13px;">
              Failed to load administrators: ${escapeHtml(err.message)}
            </div>
          `;
        }
      }
    },

    renderAdminsList() {
      const container = document.getElementById("adminListContainer");
      if (!container) return;

      let filtered = this.admins;
      if (this.searchQuery) {
        filtered = filtered.filter(a =>
          (a.name || "").toLowerCase().includes(this.searchQuery) ||
          (a.email || "").toLowerCase().includes(this.searchQuery)
        );
      }

      if (filtered.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 32px 16px; color: var(--text-muted);">
            <div style="font-size: 28px; margin-bottom: 8px;">👥</div>
            <div style="font-weight: 600; font-size: 13px; color: var(--text-primary); margin-bottom: 4px;">
              ${this.searchQuery ? "No matching administrators" : "No administrators registered yet"}
            </div>
            <div style="font-size: 12px;">
              ${this.searchQuery ? `Try adjusting your search query "${escapeHtml(this.searchQuery)}".` : "Use the 'Create Admin' tab to add your first platform administrator."}
            </div>
          </div>
        `;
        return;
      }

      container.innerHTML = filtered.map(admin => {
        const name = admin.name || "Administrator";
        const email = admin.email || "";
        const initials = name.slice(0, 2).toUpperCase();
        const status = (admin.status || "PENDING").toUpperCase();
        const statusBadgeClass = status === "ACTIVE" 
          ? "status-badge-admin-active" 
          : (status === "DISABLED" ? "status-badge-admin-disabled" : "status-badge-admin-pending");

        const statusLabel = status === "ACTIVE" 
          ? "Active" 
          : (status === "DISABLED" ? "Disabled" : "Pending Verification");

        const isPending = status === "PENDING";
        const isDisabled = status === "DISABLED";
        const createdDate = admin.createdAt ? new Date(admin.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

        return `
          <div class="admin-row-item" data-admin-id="${admin.id}">
            <div class="admin-user-info">
              <div class="admin-avatar-initials">${escapeHtml(initials)}</div>
              <div>
                <div class="admin-name-text">${escapeHtml(name)}</div>
                <div class="admin-email-text">${escapeHtml(email)} ${createdDate ? `• Added ${createdDate}` : ""}</div>
              </div>
            </div>
            <div class="admin-actions-cell">
              <span class="${statusBadgeClass}">${escapeHtml(statusLabel)}</span>
              ${isPending ? `
                <button class="btn-secondary btn-activate-admin" data-id="${admin.id}" data-name="${escapeHtml(name)}" data-email="${escapeHtml(email)}" title="Directly activate administrator and set password" style="padding: 4px 10px; font-size: 11.5px; color: #059669; font-weight: 600;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 3px; vertical-align: -1px;"><polyline points="20 6 9 17 4 12"/></svg>Activate
                </button>
                <button class="btn-secondary btn-resend-invite" data-id="${admin.id}" data-name="${escapeHtml(name)}" title="Resend verification email" style="padding: 4px 10px; font-size: 11.5px; color: #2563EB;">
                  Resend Invite
                </button>
                <button class="btn-secondary btn-revoke-invite" data-id="${admin.id}" data-name="${escapeHtml(name)}" title="Revoke this pending invitation" style="padding: 4px 10px; font-size: 11.5px; color: #EF4444;">
                  Revoke
                </button>
              ` : `
                <button class="btn-secondary btn-activate-admin" data-id="${admin.id}" data-name="${escapeHtml(name)}" data-email="${escapeHtml(email)}" title="Activate administrator" style="padding: 4px 10px; font-size: 11.5px; ${isDisabled ? 'color: #059669;' : 'display:none;'} font-weight: 600;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 3px; vertical-align: -1px;"><polyline points="20 6 9 17 4 12"/></svg>Activate
                </button>
                <button class="btn-secondary btn-toggle-status" data-id="${admin.id}" data-status="${status}" data-name="${escapeHtml(name)}" title="${isDisabled ? 'Enable Administrator' : 'Disable Administrator'}" style="padding: 4px 10px; font-size: 11.5px; ${isDisabled ? 'color: #059669;' : 'color: #EF4444;'}">
                  ${isDisabled ? "Enable" : "Disable"}
                </button>
                ${isDisabled ? `
                  <button class="btn-secondary btn-delete-admin" data-id="${admin.id}" data-name="${escapeHtml(name)}" title="Permanently delete administrator" style="padding: 4px 10px; font-size: 11.5px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: -1px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>Delete
                  </button>
                ` : ""}
              `}
            </div>
          </div>
        `;
      }).join("");

      // Bind row actions
      container.querySelectorAll(".btn-activate-admin").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const name = btn.dataset.name;
          const email = btn.dataset.email;
          if (id) this.promptActivateAdmin(id, name, email, btn);
        });
      });

      container.querySelectorAll(".btn-resend-invite").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const name = btn.dataset.name;
          if (id) this.resendVerification(id, name, btn);
        });
      });

      container.querySelectorAll(".btn-revoke-invite").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const name = btn.dataset.name;
          if (!id) return;
          if (confirm(`Revoke pending invitation for ${name || 'this administrator'}? The invitation link will be cancelled.`)) {
            await this.updateAdminStatus(id, "DISABLED", name, btn);
          }
        });
      });

      container.querySelectorAll(".btn-toggle-status").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const currentStatus = btn.dataset.status;
          const name = btn.dataset.name;
          const nextStatus = currentStatus === "DISABLED" ? "ACTIVE" : "DISABLED";
          if (id) this.updateAdminStatus(id, nextStatus, name, btn);
        });
      });

      container.querySelectorAll(".btn-delete-admin").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const name = btn.dataset.name;
          if (id) this.deleteAdmin(id, name, btn);
        });
      });
    },

    async promptActivateAdmin(id, name, email, buttonEl) {
      const customPassword = prompt(
        `Activate administrator "${name || 'User'}" ${email ? '(' + email + ')' : ''}?\n\n` +
        `Enter an initial password (minimum 8 characters), or leave blank to automatically generate a secure temporary password:`,
        ""
      );
      if (customPassword === null) return; // User cancelled

      if (customPassword && customPassword.trim().length < 8) {
        showToast("Password must be at least 8 characters long", "error");
        return;
      }

      if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent = "...";
      }

      try {
        const payload = customPassword.trim() ? { password: customPassword.trim() } : {};
        const res = await apiClient.request(`/api/admins/${id}/activate`, {
          method: "POST",
          body: JSON.stringify(payload)
        });

        const tempPw = res?.temporaryPassword;
        if (tempPw) {
          navigator.clipboard?.writeText(tempPw).catch(() => {});
          alert(`Administrator ${name || 'User'} is now ACTIVE!\n\nEmail: ${email || res?.email || ''}\nPassword: ${tempPw}\n\n(Password has been copied to your clipboard!)`);
          showToast(`Admin ${name || 'User'} activated! Password copied to clipboard.`, "success");
        } else {
          showToast(`Admin ${name || 'User'} activated successfully!`, "success");
        }
        await this.loadAdmins(false);
        if (typeof ActivityLogsManager !== "undefined") {
          ActivityLogsManager.loadRecentActivity();
        }
      } catch (err) {
        console.error("Failed to activate admin:", err);
        showToast(err.message || "Failed to activate administrator", "error");
      } finally {
        if (buttonEl) {
          buttonEl.disabled = false;
          buttonEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 3px; vertical-align: -1px;"><polyline points="20 6 9 17 4 12"/></svg>Activate`;
        }
      }
    },

    async resendVerification(id, name, buttonEl) {
      // Trigger 5-second auto-refresh of the Admin Directory as soon as Resend is clicked
      this.startAutoRefresh();

      if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent = "Sending...";
      }
      try {
        const res = await apiClient.request(`/api/admins/${id}/resend-verification`, {
          method: "POST"
        });

        const verificationUrl = res?.verificationUrl ? this.toLocalhostUrl(res.verificationUrl) : "";
        if (verificationUrl) {
          this.showCopyInviteModal(name || "Administrator", verificationUrl);
        }

        showToast(`Verification invitation email resent to ${name || 'administrator'}! Auto-refreshing directory every 5s.`, "success");
        await this.loadAdmins(false);
        if (typeof ActivityLogsManager !== "undefined") {
          ActivityLogsManager.loadRecentActivity();
        }
      } catch (err) {
        console.error("Failed to resend verification:", err);
        showToast(err.message || "Failed to resend invitation", "error");
      } finally {
        if (buttonEl) {
          buttonEl.disabled = false;
          buttonEl.textContent = "Resend Invite";
        }
      }
    },

    async updateAdminStatus(id, nextStatus, name, buttonEl) {
      if (nextStatus === "ACTIVE") {
        // Direct activation handles setting password and verified status cleanly
        return this.promptActivateAdmin(id, name, "", buttonEl);
      }
      if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent = "...";
      }
      try {
        await apiClient.request(`/api/admins/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus })
        });
        showToast(`Admin ${name || ''} set to ${nextStatus.toLowerCase()}`);
        await this.loadAdmins(false);
        if (typeof ActivityLogsManager !== "undefined") {
          ActivityLogsManager.loadRecentActivity();
        }
      } catch (err) {
        console.error("Failed to update admin status:", err);
        showToast(err.message || "Failed to update admin status", "error");
      } finally {
        if (buttonEl) {
          buttonEl.disabled = false;
          buttonEl.textContent = nextStatus === "DISABLED" ? "Disable" : "Enable";
        }
      }
    },

    async deleteAdmin(id, name, buttonEl) {
      const confirmDelete = window.confirm(
        `Are you sure you want to permanently delete administrator "${name || 'User'}"?\n\nThis will remove their profile and credentials from the system. This action cannot be undone.`
      );
      if (!confirmDelete) return;

      if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.innerHTML = `<span class="spinner" style="width: 12px; height: 12px; border-width: 2px; margin-right: 4px;"></span> Deleting...`;
      }

      try {
        await apiClient.request(`/api/admins/${id}`, {
          method: "DELETE"
        });
        showToast(`Administrator "${name || 'User'}" permanently deleted.`, "success");
        await this.loadAdmins(false);
        if (typeof ActivityLogsManager !== "undefined") {
          ActivityLogsManager.loadRecentActivity();
        }
      } catch (err) {
        console.error("Failed to delete admin:", err);
        const errMsg = err.status === 409
          ? "Cannot delete active administrator. The account must be disabled first."
          : (err.message || "Failed to delete administrator.");
        showToast(errMsg, "error");
        if (buttonEl) {
          buttonEl.disabled = false;
          buttonEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: -1px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>Delete`;
        }
      }
    }
  };

  // =========================================================================
  // 10C. ADMINISTRATOR ACCOUNT ACTIVATION & PASSWORD SETUP
  // =========================================================================

  const ActivationManager = {
    setupToken: null,

    init() {
      this.bindEvents();
      this.checkUrlForToken();
    },

    bindEvents() {
      document.getElementById("closeSetupPasswordModal")?.addEventListener("click", () => {
        this.closeModal();
      });
      document.getElementById("btnCloseSetupErrorBtn")?.addEventListener("click", () => {
        this.closeModal();
      });
      document.getElementById("btnGoToLoginAfterSetup")?.addEventListener("click", () => {
        const verifiedEmail = document.getElementById("setupVerifiedEmail")?.textContent || "";
        this.closeModal();
        AuthManager.showLoginScreen();
        if (verifiedEmail && !verifiedEmail.includes("administrator account")) {
          const emailInput = document.getElementById("loginEmailInput");
          if (emailInput) {
            emailInput.value = verifiedEmail.trim();
            document.getElementById("loginPasswordInput")?.focus();
          }
        }
      });

      const form = document.getElementById("setupPasswordForm");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          this.handleSetPassword();
        });
      }
    },

    closeModal() {
      const modal = document.getElementById("setupPasswordModal");
      if (modal) modal.style.display = "none";
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname.replace(/\/verify-email/g, "/") || "/");
      }
      if (!AuthManager.currentUser) {
        AuthManager.showLoginScreen();
      }
    },

    checkUrlForToken() {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      const isVerifyPath = window.location.pathname.includes("verify-email") || window.location.pathname.includes("set-password");

      if (token || isVerifyPath) {
        if (token) {
          this.startVerification(token);
        } else {
          this.showError("Missing verification or setup token in the link.");
        }
      }
    },

    async startVerification(token) {
      AuthManager.hideAppLayout();
      const loginScreen = document.getElementById("loginScreen");
      if (loginScreen) loginScreen.style.display = "none";

      const modal = document.getElementById("setupPasswordModal");
      const loadingEl = document.getElementById("setupPasswordLoading");
      const errorState = document.getElementById("setupPasswordErrorState");
      const formEl = document.getElementById("setupPasswordForm");
      const successState = document.getElementById("setupPasswordSuccessState");

      if (modal) modal.style.display = "flex";
      if (loadingEl) loadingEl.style.display = "block";
      if (errorState) errorState.style.display = "none";
      if (formEl) formEl.style.display = "none";
      if (successState) successState.style.display = "none";

      try {
        const res = await apiClient.request(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
        this.setupToken = res.setupToken;

        const emailEl = document.getElementById("setupVerifiedEmail");
        if (emailEl) emailEl.textContent = res.email || "your administrator account";

        if (loadingEl) loadingEl.style.display = "none";
        if (formEl) formEl.style.display = "block";
        document.getElementById("newAdminPasswordInput")?.focus();
      } catch (err) {
        console.error("Verification failed:", err);
        this.showError(err.message || "This verification link is invalid, expired, or has already been used.");
      }
    },

    showError(msg) {
      const modal = document.getElementById("setupPasswordModal");
      const loadingEl = document.getElementById("setupPasswordLoading");
      const errorState = document.getElementById("setupPasswordErrorState");
      const errorMsg = document.getElementById("setupPasswordErrorMsg");
      const formEl = document.getElementById("setupPasswordForm");
      const successState = document.getElementById("setupPasswordSuccessState");

      if (modal) modal.style.display = "flex";
      if (loadingEl) loadingEl.style.display = "none";
      if (formEl) formEl.style.display = "none";
      if (successState) successState.style.display = "none";
      if (errorState) errorState.style.display = "block";
      if (errorMsg) errorMsg.textContent = msg;
    },

    async handleSetPassword() {
      const pwdInput = document.getElementById("newAdminPasswordInput");
      const confirmInput = document.getElementById("confirmAdminPasswordInput");
      const submitBtn = document.getElementById("btnSubmitSetPassword");
      const alertEl = document.getElementById("setupFormAlert");

      if (alertEl) {
        alertEl.style.display = "none";
        alertEl.textContent = "";
      }

      const password = pwdInput?.value || "";
      const passwordConfirmation = confirmInput?.value || "";

      if (password.length < 12) {
        if (alertEl) {
          alertEl.textContent = "Password must be at least 12 characters long.";
          alertEl.style.display = "block";
        }
        return;
      }

      if (password !== passwordConfirmation) {
        if (alertEl) {
          alertEl.textContent = "Passwords do not match.";
          alertEl.style.display = "block";
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 6px;"></span> Activating...`;
      }

      try {
        await apiClient.request("/api/auth/set-password", {
          method: "POST",
          body: JSON.stringify({
            token: this.setupToken,
            password,
            passwordConfirmation
          })
        });

        document.getElementById("setupPasswordForm")?.style.setProperty("display", "none");
        document.getElementById("setupPasswordSuccessState")?.style.setProperty("display", "block");
        showToast("Password set successfully! Your account is active.", "success");
      } catch (err) {
        console.error("Failed to set password:", err);
        if (alertEl) {
          alertEl.textContent = err.message || "Failed to set password. Link may have expired.";
          alertEl.style.display = "block";
        }
        showToast(err.message || "Failed to set password", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Set Password & Activate Account";
        }
      }
    }
  };

  // =========================================================================
  // 10C. PROFILE & SETTINGS MANAGERS
  // =========================================================================

  const ProfileManager = {
    init() {
      this.bindEvents();
    },

    bindEvents() {
      // Return to dashboard back button & breadcrumb
      document.getElementById("btnBackFromProfile")?.addEventListener("click", () => {
        DatabaseScreenManager.closeDatabaseScreen();
      });

      document.getElementById("breadcrumbDashboardProfile")?.addEventListener("click", (e) => {
        e.preventDefault();
        DatabaseScreenManager.closeDatabaseScreen();
      });

      // Save Profile Info
      document.getElementById("profileInfoForm")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const nameInput = document.getElementById("profileInputName");
        const emailInput = document.getElementById("profileInputEmail");
        const deptInput = document.getElementById("profileInputDept");

        const newName = nameInput?.value?.trim() || "Super Admin";
        const newEmail = emailInput?.value?.trim() || "superadmin@nexus6.internal";
        const newDept = deptInput?.value?.trim() || "Data Operations";

        if (!AuthManager.currentUser) {
          AuthManager.currentUser = { id: "admin-root", email: newEmail, name: newName, role: "SUPER_ADMIN" };
        } else {
          AuthManager.currentUser.name = newName;
          AuthManager.currentUser.email = newEmail;
        }

        const customProfile = { name: newName, email: newEmail, dept: newDept };
        localStorage.setItem("datavault6_admin_profile", JSON.stringify(customProfile));

        // Update UI
        AuthManager.updateProfileUI(AuthManager.currentUser);
        this.loadProfile();

        showToast("Profile details updated successfully");
      });

      // Change Password Form
      document.getElementById("profilePasswordForm")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const newPass = document.getElementById("profileNewPassword")?.value || "";
        const confirmPass = document.getElementById("profileConfirmPassword")?.value || "";
        const alertEl = document.getElementById("profilePasswordAlert");

        if (alertEl) {
          alertEl.style.display = "none";
          alertEl.textContent = "";
        }

        if (newPass.length < 12) {
          if (alertEl) {
            alertEl.textContent = "New password must be at least 12 characters long according to security policy.";
            alertEl.style.display = "block";
          }
          return;
        }

        if (newPass !== confirmPass) {
          if (alertEl) {
            alertEl.textContent = "New password and password confirmation do not match.";
            alertEl.style.display = "block";
          }
          return;
        }

        document.getElementById("profilePasswordForm")?.reset();
        showToast("Password updated successfully with Argon2id encryption");
      });

      // Sign Out Button
      document.getElementById("btnProfileSignOut")?.addEventListener("click", async () => {
        try {
          await apiClient.request("/api/auth/logout", { method: "POST" });
        } catch {
          // ignore
        }
        showToast("Signed out of administrative session");
        setTimeout(() => {
          window.location.reload();
        }, 400);
      });

      // Switch Account Button
      document.getElementById("btnProfileSwitchAccount")?.addEventListener("click", () => {
        AuthManager.showLoginModal();
      });
    },

    loadProfile() {
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem("datavault6_admin_profile") || "null");
      } catch {
        saved = null;
      }

      const user = AuthManager.currentUser || {};
      const displayName = saved?.name || user.name || (user.email ? user.email.split("@")[0] : "Super Admin");
      const email = saved?.email || user.email || "superadmin@nexus6.internal";
      const dept = saved?.dept || "Data Operations";
      const role = user.role === "SUPER_ADMIN" ? "Super Administrator" : (user.role === "ADMIN" ? "Data Administrator" : "Platform Administrator");
      const initials = displayName.slice(0, 2).toUpperCase();

      const largeAvatar = document.getElementById("profileLargeAvatar");
      if (largeAvatar) largeAvatar.textContent = initials;

      const heroName = document.getElementById("profileHeroName");
      if (heroName) heroName.textContent = displayName;

      const heroRole = document.getElementById("profileHeroRoleBadge");
      if (heroRole) heroRole.textContent = role;

      const heroEmail = document.getElementById("profileHeroEmail");
      if (heroEmail) heroEmail.textContent = email;

      const heroDept = document.getElementById("profileHeroDept");
      if (heroDept) heroDept.textContent = dept;

      const inputName = document.getElementById("profileInputName");
      if (inputName) inputName.value = displayName;

      const inputEmail = document.getElementById("profileInputEmail");
      if (inputEmail) inputEmail.value = email;

      const inputDept = document.getElementById("profileInputDept");
      if (inputDept) inputDept.value = dept;

      const inputRole = document.getElementById("profileInputRole");
      if (inputRole) inputRole.value = `${role} (Active)`;

      const sessionInfo = document.getElementById("profileSessionInfo");
      if (sessionInfo) {
        sessionInfo.textContent = `Active Session \u2022 Account: ${email} \u2022 TLS Encrypted JWT Cookie`;
      }
    }
  };

  const SettingsManager = {
    defaults: {
      theme: "light",
      density: "comfortable",
      glassmorphism: true,
      animations: true,
      toastAlerts: true,
      requestAlerts: true,
      securityAlerts: true,
      defaultEngine: "MySQL",
      defaultExport: "csv",
      autoProfile: true
    },

    settings: {},

    init() {
      this.loadSettings();
      this.bindEvents();
    },

    loadSettings() {
      let stored = {};
      try {
        stored = JSON.parse(localStorage.getItem("datavault6_settings") || "{}");
      } catch {
        stored = {};
      }

      this.settings = { ...this.defaults, ...stored };

      const currentTheme = localStorage.getItem("datavault6_theme") || this.settings.theme;
      this.settings.theme = currentTheme;

      this.applySettingsToUI();
    },

    applySettingsToUI() {
      // 1. Theme buttons
      const isDark = (document.documentElement.getAttribute("data-theme") === "dark") || this.settings.theme === "dark";
      document.getElementById("themeOptLight")?.classList.toggle("active", !isDark);
      document.getElementById("themeOptDark")?.classList.toggle("active", isDark);

      // 2. Density buttons
      const isCompact = this.settings.density === "compact";
      document.getElementById("densityOptComfortable")?.classList.toggle("active", !isCompact);
      document.getElementById("densityOptCompact")?.classList.toggle("active", isCompact);
      document.getElementById("datasetsTable")?.classList.toggle("table-compact", isCompact);

      // 3. Toggles
      const toggleGlass = document.getElementById("toggleGlassmorphism");
      if (toggleGlass) toggleGlass.checked = !!this.settings.glassmorphism;

      const toggleAnim = document.getElementById("toggleAnimations");
      if (toggleAnim) toggleAnim.checked = !!this.settings.animations;

      const toggleToast = document.getElementById("toggleToastAlerts");
      if (toggleToast) toggleToast.checked = !!this.settings.toastAlerts;

      const toggleReq = document.getElementById("toggleRequestAlerts");
      if (toggleReq) toggleReq.checked = !!this.settings.requestAlerts;

      const toggleSec = document.getElementById("toggleSecurityAlerts");
      if (toggleSec) toggleSec.checked = !!this.settings.securityAlerts;

      const toggleAuto = document.getElementById("toggleAutoProfile");
      if (toggleAuto) toggleAuto.checked = !!this.settings.autoProfile;

      // 4. Selects
      const selEngine = document.getElementById("settingDefaultEngine");
      if (selEngine) selEngine.value = this.settings.defaultEngine || "MySQL";

      const selExport = document.getElementById("settingDefaultExport");
      if (selExport) selExport.value = this.settings.defaultExport || "csv";

      // 5. Public URL
      const publicUrlInput = document.getElementById("settingPublicUrlInput");
      if (publicUrlInput) {
        if (window.location.origin && !window.location.origin.includes("localhost") && !window.location.origin.includes("127.0.0.1")) {
          publicUrlInput.value = window.location.origin;
        } else {
          publicUrlInput.value = "https://viselike-lushness-repacking.ngrok-free.dev";
        }
      }

      this.checkApiHealth();
    },

    async checkApiHealth() {
      const statusText = document.getElementById("apiHealthStatusText");
      if (!statusText) return;

      statusText.textContent = "Pinging /api/health...";
      statusText.style.color = "var(--text-muted)";

      const startTime = performance.now();
      try {
        const res = await apiClient.request("/api/health");
        const latency = Math.round(performance.now() - startTime);
        statusText.textContent = `200 OK (${latency}ms) \u2022 Service: ${res.service || "nexus-6-api"} \u2022 Healthy`;
        statusText.style.color = "#10B981";
      } catch (err) {
        statusText.textContent = "Backend Offline or Endpoint Unreachable";
        statusText.style.color = "#EF4444";
      }
    },

    bindEvents() {
      // Return to dashboard
      document.getElementById("btnBackFromSettings")?.addEventListener("click", () => {
        DatabaseScreenManager.closeDatabaseScreen();
      });

      document.getElementById("breadcrumbDashboardSettings")?.addEventListener("click", (e) => {
        e.preventDefault();
        DatabaseScreenManager.closeDatabaseScreen();
      });

      // Theme toggle buttons
      document.getElementById("themeOptLight")?.addEventListener("click", () => {
        document.documentElement.setAttribute("data-theme", "light");
        localStorage.setItem("datavault6_theme", "light");
        this.settings.theme = "light";
        document.getElementById("themeOptLight")?.classList.add("active");
        document.getElementById("themeOptDark")?.classList.remove("active");
        showToast("Switched to Light theme");
      });

      document.getElementById("themeOptDark")?.addEventListener("click", () => {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("datavault6_theme", "dark");
        this.settings.theme = "dark";
        document.getElementById("themeOptDark")?.classList.add("active");
        document.getElementById("themeOptLight")?.classList.remove("active");
        showToast("Switched to Dark theme");
      });

      // Density buttons
      document.getElementById("densityOptComfortable")?.addEventListener("click", () => {
        this.settings.density = "comfortable";
        document.getElementById("densityOptComfortable")?.classList.add("active");
        document.getElementById("densityOptCompact")?.classList.remove("active");
        document.getElementById("datasetsTable")?.classList.remove("table-compact");
        showToast("Table density set to Comfortable");
      });

      document.getElementById("densityOptCompact")?.addEventListener("click", () => {
        this.settings.density = "compact";
        document.getElementById("densityOptCompact")?.classList.add("active");
        document.getElementById("densityOptComfortable")?.classList.remove("active");
        document.getElementById("datasetsTable")?.classList.add("table-compact");
        showToast("Table density set to Compact");
      });

      // Copy Public URL
      document.getElementById("btnCopyPublicUrl")?.addEventListener("click", () => {
        const input = document.getElementById("settingPublicUrlInput");
        if (input) {
          navigator.clipboard?.writeText(input.value).then(() => {
            showToast("Public URL copied to clipboard!");
          }).catch(() => {
            input.select();
            document.execCommand("copy");
            showToast("Public URL copied to clipboard!");
          });
        }
      });

      // Ping API Button
      document.getElementById("btnTestApiHealth")?.addEventListener("click", () => {
        this.checkApiHealth();
      });

      // Save All Settings
      document.getElementById("btnSaveAllSettings")?.addEventListener("click", () => {
        this.collectSettingsFromUI();
        localStorage.setItem("datavault6_settings", JSON.stringify(this.settings));
        showToast("All platform settings saved successfully!");
      });

      // Reset to defaults
      document.getElementById("btnResetSettings")?.addEventListener("click", () => {
        this.settings = { ...this.defaults };
        localStorage.setItem("datavault6_settings", JSON.stringify(this.settings));
        this.applySettingsToUI();
        showToast("Settings reset to default configuration");
      });
    },

    collectSettingsFromUI() {
      const toggleGlass = document.getElementById("toggleGlassmorphism");
      if (toggleGlass) this.settings.glassmorphism = toggleGlass.checked;

      const toggleAnim = document.getElementById("toggleAnimations");
      if (toggleAnim) this.settings.animations = toggleAnim.checked;

      const toggleToast = document.getElementById("toggleToastAlerts");
      if (toggleToast) this.settings.toastAlerts = toggleToast.checked;

      const toggleReq = document.getElementById("toggleRequestAlerts");
      if (toggleReq) this.settings.requestAlerts = toggleReq.checked;

      const toggleSec = document.getElementById("toggleSecurityAlerts");
      if (toggleSec) this.settings.securityAlerts = toggleSec.checked;

      const toggleAuto = document.getElementById("toggleAutoProfile");
      if (toggleAuto) this.settings.autoProfile = toggleAuto.checked;

      const selEngine = document.getElementById("settingDefaultEngine");
      if (selEngine) this.settings.defaultEngine = selEngine.value;

      const selExport = document.getElementById("settingDefaultExport");
      if (selExport) this.settings.defaultExport = selExport.value;
    }
  };

  // =========================================================================
  // 11. NAVIGATION, QUICK ACTIONS & THEME
  // =========================================================================

  function initNavigation() {
    const navItems = document.querySelectorAll(".sidebar-nav .nav-item");

    navItems.forEach(item => {
      item.addEventListener("click", function (e) {
        if (this.getAttribute("href")?.startsWith("#")) {
          e.preventDefault();
        }

        const label = this.querySelector(".nav-label")?.textContent?.trim() || "";
        const dbName = this.dataset.db;

        if (dbName) {
          // Specific database navigation -> Opens dedicated database screen!
          DatabaseScreenManager.openDatabase(dbName);
        } else if (label === "Dashboard" || this.id === "nav-dashboard") {
          DatabaseScreenManager.closeDatabaseScreen();
        } else if (label === "Explore Datasets" || this.id === "nav-explore") {
          DatabaseScreenManager.openExplore();
        } else if (label === "All Datasets" || this.id === "nav-datasets") {
          DatabaseScreenManager.closeDatabaseScreen();
          navItems.forEach(n => n.classList.remove("active"));
          this.classList.add("active");
          DatasetsManager.databaseFilter = "";
          DatasetsManager.categoryFilter = "";
          DatasetsManager.visibilityFilter = "";
          DatasetsManager.viewMode = "all";
          DatasetsManager.currentPage = 1;
          const tableHeaderTitle = document.getElementById("tableSectionTitle");
          if (tableHeaderTitle) tableHeaderTitle.textContent = "All Datasets";
          DatasetsManager.loadDatasets();
          showToast("Showing all accessible datasets");
        } else if (label === "My Datasets" || this.id === "nav-my-datasets") {
          DatabaseScreenManager.openMyDatasets();
        } else if (label === "Bookmarked" || this.id === "nav-bookmarked") {
          DatabaseScreenManager.openBookmarked();
        } else if (label === "Search" || this.id === "nav-search-tool") {
          DatabaseScreenManager.openSearch();
        } else if (label === "Analytics" || this.id === "nav-analytics-tool") {
          DatabaseScreenManager.openAnalytics();
        } else if (label === "Data Requests" || this.id === "nav-requests-tool") {
          DatabaseScreenManager.openDataRequests();
        } else if (label === "Profile" || this.id === "nav-profile") {
          DatabaseScreenManager.openProfile();
        } else if (label === "Settings" || this.id === "nav-settings") {
          DatabaseScreenManager.openSettings();
        } else if (label === "Activity Feed" || this.id === "nav-activity-feed") {
          document.getElementById("activityLogsModal")?.style.setProperty("display", "flex");
          ActivityLogsManager.loadFullLogs();
        }
      });
    });

    // Quick Actions
    const btnExplore = document.getElementById("btnQuickExplore");
    if (btnExplore) {
      btnExplore.addEventListener("click", () => {
        DatabaseScreenManager.openExplore();
      });
    }

    const btnMyDatasets = document.getElementById("btnQuickMyDatasets");
    if (btnMyDatasets) {
      btnMyDatasets.addEventListener("click", () => {
        DatabaseScreenManager.openMyDatasets();
      });
    }

    const btnAnalytics = document.getElementById("btnQuickAnalytics");
    if (btnAnalytics) {
      btnAnalytics.addEventListener("click", () => {
        DatabaseScreenManager.openAnalytics();
      });
    }

    // Database Center Explore Buttons & Database Card Click
    document.querySelectorAll(".btn-db-explore").forEach(btn => {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const dbName = this.dataset.exploreDb;
        if (dbName) {
          DatabaseScreenManager.openDatabase(dbName);
        }
      });
    });

    document.querySelectorAll(".db-card").forEach(card => {
      card.style.cursor = "pointer";
      card.addEventListener("click", function () {
        const dbName = this.dataset.dbName;
        if (dbName) {
          DatabaseScreenManager.openDatabase(dbName);
        }
      });
    });

    // View All Databases Link
    document.getElementById("viewAllDatabasesLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      DatabaseScreenManager.closeDatabaseScreen();
      showToast("Displaying datasets across all database engines");
    });

    // View All Datasets Link
    document.getElementById("viewAllDatasetsLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      DatabaseScreenManager.closeDatabaseScreen();
      DatasetsManager.databaseFilter = "";
      DatasetsManager.categoryFilter = "";
      DatasetsManager.viewMode = "all";
      DatasetsManager.loadDatasets();
      showToast("Reset filters to show all datasets");
    });

    // Top Profile Menu Actions
    document.getElementById("btnMenuProfile")?.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("profileDropdownMenu")?.classList.remove("active");
      DatabaseScreenManager.openProfile();
    });

    document.getElementById("btnMenuSettings")?.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("profileDropdownMenu")?.classList.remove("active");
      DatabaseScreenManager.openSettings();
    });
  }

  function initThemeToggle() {
    const toggleBtn = document.getElementById("themeToggleBtn");
    const menuThemeBtn = document.getElementById("btnSwitchTheme");
    const savedTheme = localStorage.getItem("datavault6_theme") || "light";

    if (savedTheme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    }

    const toggleTheme = () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const nextTheme = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", nextTheme);
      localStorage.setItem("datavault6_theme", nextTheme);
      showToast(`Switched to ${nextTheme} theme`);
    };

    if (toggleBtn) toggleBtn.addEventListener("click", toggleTheme);
    if (menuThemeBtn) menuThemeBtn.addEventListener("click", toggleTheme);
  }

  // =========================================================================
  // 11. INITIALIZATION ON DOM READY
  // =========================================================================

  document.addEventListener("DOMContentLoaded", async function () {
    initThemeToggle();
    DatabaseScreenManager.init();
    AnalyticsScreenManager.init();
    DataRequestsManager.init();
    ProfileManager.init();
    SettingsManager.init();
    initNavigation();
    UploadManager.init();
    ActionsManager.init();
    AdminManager.init();
    ActivationManager.init();

    // Authenticate first; data managers are triggered by showAppLayout() once authenticated
    await AuthManager.init();

    console.log("DataVault6 frontend fully integrated with real REST backend APIs.");
  });

})();
