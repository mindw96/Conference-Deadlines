(function () {
    const QS = s => document.querySelector(s);
    const DATA_URL = "conferences.json";

    const state = {
        items: [],
        filtered: [],
        q: "",
        category: "all",
        subfield: "all",
        status: "all",
        sort: "next_due_asc",
    };

    function parseQuery() {
        const url = new URL(location.href);
        state.q = url.searchParams.get("q") || "";
        state.category = url.searchParams.get("category") || "all";
        state.subfield = url.searchParams.get("subfield") || "all";
        state.status = url.searchParams.get("status") || "all";
        state.sort = url.searchParams.get("sort") || "next_due_asc";

        QS("#q").value = state.q;
        QS("#statusFilter").value = state.status;
        QS("#sortSelect").value = state.sort;
    }

    function updatePermalink() {
        const url = new URL(location.href);
        url.searchParams.set("q", state.q);
        url.searchParams.set("category", state.category);
        url.searchParams.set("subfield", state.subfield);
        url.searchParams.set("status", state.status);
        url.searchParams.set("sort", state.sort);
        history.replaceState(null, "", url.toString());
    }

    function normalizeItem(raw) {
        const areas = (typeof raw.areas === 'object' && raw.areas !== null) ? raw.areas : {};
        let deadlinesList = [];
        if (typeof raw.deadlines === 'string' && raw.deadlines) {
            deadlinesList = [{ type: 'Deadline', due: raw.deadlines }];
        } else if (Array.isArray(raw.deadlines)) {
            deadlinesList = raw.deadlines;
        }

        const parseable = (d) => d && d.due && !isNaN(Date.parse(d.due));
        const now = new Date();
        const deadlines = deadlinesList.filter(parseable).map(d => ({
            type: d.type || 'Deadline',
            due: new Date(d.due)
        }));

        let nextDue = null;
        let status = "closed";
        if (deadlines.length === 0) {
            status = "coming_soon";
        } else {
            for (const d of deadlines.sort((a, b) => a.due - b.due)) {
                if (d.due > now) {
                    nextDue = d.due;
                    status = "upcoming";
                    break;
                }
            }
            if (nextDue) {
                const diffDays = Math.ceil((nextDue - now) / (1000 * 60 * 60 * 24));
                if (diffDays <= 7) status = "soon";
            }
        }
        return { ...raw, areas, deadlines, nextDue, status };
    }

    function loadData() {
        return fetch(DATA_URL, { cache: "no-cache" })
            .then(r => r.json())
            .then(list => list.map(normalizeItem));
    }

    function applyFilters() {
        const q = state.q.trim().toLowerCase();
        state.filtered = state.items.filter(it => {
            if (state.status !== "all" && it.status !== state.status) return false;
            if (state.category !== "all" && !it.areas.hasOwnProperty(state.category)) return false;
            if (state.subfield !== "all") {
                const subfields = state.category === 'all'
                    ? Object.values(it.areas).flat()
                    : it.areas[state.category] || [];
                if (!subfields.includes(state.subfield)) return false;
            }
            if (q) {
                const allSubfields = Object.values(it.areas).flat().join(" ");
                const hay = [
                    (it.name || ""), it.location || "", (it.tags || []).join(" "), allSubfields
                ].join(" ").toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
        sortItems();
    }

    function sortItems() {
        state.filtered.sort((a, b) => {
            if (state.sort === "name_asc") {
                return (a.name || "").localeCompare(b.name || "");
            }
            if (!a.nextDue && !b.nextDue) return (a.name || "").localeCompare(b.name || "");
            if (!a.nextDue) return 1;
            if (!b.nextDue) return -1;
            return a.nextDue - b.nextDue;
        });
    }

    function render() {
        applyFilters();
        const html = state.filtered.map(renderCard).join("");
        QS("#cards").innerHTML = html;
        QS("#resultCount").textContent = state.filtered.length;
        startCountdownTimer();
    }

    function renderAreaBadges(areas) {
        let html = "";
        for (const category in areas) {
            html += `<span class="badge rounded-pill badge-area badge-area-default">${category}</span>`;
            areas[category].forEach(subfield => {
                html += `<span class="badge rounded-pill text-bg-light border">${subfield}</span>`;
            });
        }
        return html;
    }

    function rebuildFilters() {
        const categoryFilter = QS("#categoryFilter");
        const subfieldFilter = QS("#subfieldFilter");
        const allCategories = new Set();
        const allSubfields = new Set();
        const categoryToSubfields = {};

        state.items.forEach(it => {
            for (const cat in it.areas) {
                allCategories.add(cat);
                if (!categoryToSubfields[cat]) categoryToSubfields[cat] = new Set();
                it.areas[cat].forEach(sub => {
                    allSubfields.add(sub);
                    categoryToSubfields[cat].add(sub);
                });
            }
        });

        categoryFilter.innerHTML = '<option value="all">All</option>';
        [...allCategories].sort().forEach(cat => {
            categoryFilter.innerHTML += `<option value="${cat}">${cat}</option>`;
        });

        window.updateSubfieldFilter = () => {
            const selectedCategory = categoryFilter.value;
            const subfieldsToShow = selectedCategory === "all"
                ? allSubfields
                : categoryToSubfields[selectedCategory] || new Set();

            subfieldFilter.innerHTML = '<option value="all">All</option>';
            [...subfieldsToShow].sort().forEach(sub => {
                subfieldFilter.innerHTML += `<option value="${sub}">${sub}</option>`;
            });

            if ([...subfieldsToShow].includes(state.subfield)) {
                subfieldFilter.value = state.subfield;
            } else {
                state.subfield = "all";
                subfieldFilter.value = "all";
            }
        };

        categoryFilter.value = state.category;
        updateSubfieldFilter();
    }

    function bindControls() {
        const on = (sel, type, handler) => {
            const el = QS(sel);
            if (el) el.addEventListener(type, handler);
        };

        on("#q", "input", e => { state.q = e.target.value; updatePermalink(); render(); });
        on("#statusFilter", "change", e => { state.status = e.target.value; updatePermalink(); render(); });
        on("#sortSelect", "change", e => { state.sort = e.target.value; updatePermalink(); render(); });

        on("#categoryFilter", "change", e => {
            state.category = e.target.value;
            state.subfield = "all";
            window.updateSubfieldFilter();
            updatePermalink();
            render();
        });

        on("#subfieldFilter", "change", e => {
            state.subfield = e.target.value;
            updatePermalink();
            render();
        });

        on("#themeToggle", "click", () => {
            const root = document.documentElement;
            const cur = root.getAttribute("data-bs-theme") || "light";
            const next = cur === "light" ? "dark" : "light";
            root.setAttribute("data-bs-theme", next);
            localStorage.setItem("theme", next);
        });

        const savedTheme = localStorage.getItem("theme");
        if (savedTheme) { document.documentElement.setAttribute("data-bs-theme", savedTheme); }
    }

    document.addEventListener("DOMContentLoaded", () => {
        parseQuery();
        bindControls();
        loadData().then(items => {
            state.items = items;
            rebuildFilters();
            render();
        }).catch(err => {
            console.error("Failed to load data:", err);
            QS("#cards").innerHTML = `<div class="alert alert-danger">Failed to load data.</div>`;
        });
    });

    function formatDateAOE(date) {
        return new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Etc/GMT+12',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).format(date) + " (AOE)";
    }

    function dBadge(item) {
        if (item.status === "coming_soon") {
            return `<span class="badge deadline-badge badge-comingsoon">Coming Soon!</span>`;
        }
        if (!item.nextDue) {
            return `<span class="badge deadline-badge badge-closed">Closed</span>`;
        }
        const now = new Date();
        const diffDays = Math.ceil((item.nextDue - now) / (1000 * 60 * 60 * 24));
        const cls = diffDays <= 7 ? "badge-soon" : "badge-upcoming";
        return `<span class="badge deadline-badge ${cls}">D-${diffDays}</span>`;
    }

    function renderTagChips(tags) {
        if (!tags || !tags.length) return "";
        return tags.map(t => `<span class="badge rounded-pill text-bg-light border">${t}</span>`).join("");
    }

    function renderCard(item) {
        const name = item.name || "";
        const url = item.site || "#";
        const note = item.note || "";
        const hasDeadlines = Array.isArray(item.deadlines) && item.deadlines.length > 0;

        const deadRows = hasDeadlines
            ? item.deadlines.map(d => `
                <div>
                  <span class="small">
                    <strong>${d.type}:</strong> ${formatDateAOE(d.due)}
                  </span>
                </div>
              `).join("")
            : `<span class="small text-body">Coming Soon!</span>`;

        const dBadgeHTML = dBadge(item);
        const countdownHTML = item.nextDue
            ? `<div class="js-countdown small mt-1" data-deadline="${item.nextDue.toISOString()}">--:--:--</div>`
            : "";

        return `
                <article class="card h-100 shadow-sm border-0">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div>
                            <h5 class="card-title mb-1">${name}</h5>
                            <div class="text-muted small">${item.location || ""}</div>
                            <div class="text-muted small">${item.dates?.conf_start}~${item.dates?.conf_end}</div>
                        </div>
                        <div class="text-end">${dBadgeHTML}${countdownHTML}</div>
                    </div>
                    <div class="mb-2 tag-list">
                        ${renderAreaBadges(item.areas)}
                        ${renderTagChips(item.tags)}
                    </div>
                    ${note ? `<p class="small mb-2">${note}</p>` : ""}
                    <div class="list-group list-group-flush mb-2">
                        ${deadRows}
                    </div>
                    ${url ? `<a class="btn btn-sm btn-outline-primary" href="${url}" target="_blank" rel="noopener">Website</a>` : ""}
                </article>`;
    }

    let __COUNTDOWN_TIMER = null;
    function startCountdownTimer() {
        if (__COUNTDOWN_TIMER) clearInterval(__COUNTDOWN_TIMER);
        updateCountdowns();
        if (QS(".js-countdown")) {
            __COUNTDOWN_TIMER = setInterval(updateCountdowns, 1000);
        }
    }
    function updateCountdowns() {
        const now = Date.now();
        let needsRerender = false;
        document.querySelectorAll(".js-countdown").forEach(el => {
            const iso = el.getAttribute("data-deadline");
            const due = iso ? Date.parse(iso) : NaN;
            if (isNaN(due)) return;
            const diff = due - now;
            if (diff <= 0) {
                el.textContent = "00:00:00";
                el.classList.remove("text-danger");
                needsRerender = true;
            } else {
                el.textContent = formatCountdown(diff);
                el.classList.toggle("text-danger", diff <= 24 * 3600 * 1000);
            }
        });
        if (needsRerender) {
            clearInterval(__COUNTDOWN_TIMER);
            __COUNTDOWN_TIMER = null;
            render();
        }
    }
    function formatCountdown(ms) {
        const sec = Math.floor(ms / 1000);
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = (n) => String(n).padStart(2, "0");
        const hhmmss = `${pad(h)}:${pad(m)}:${pad(s)}`;
        return d > 0 ? `${d}D ${hhmmss}` : hhmmss;
    }
})();