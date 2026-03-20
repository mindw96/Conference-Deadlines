(function () {
    // --- UTILITY FUNCTIONS ---
    const QS = s => document.querySelector(s);

    // --- SUPABASE SETUP ---
    // IMPORTANT: Replace with your actual Supabase URL and Anon Key
    const SUPABASE_URL = 'https://tavlqhidtjxgwclhjkje.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhdmxxaGlkdGp4Z3djbGhqa2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwMTAwODIsImV4cCI6MjA3MTU4NjA4Mn0.8iIDnSyPPhcLm10VBfHQM3SkXvxpEJRxxtMqct-goyw';
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // --- APPLICATION STATE ---
    // Holds the application's current state, including filters, sort order, and data.
    const state = {
        items: [],
        filtered: [],
        q: "",
        category: "all",
        subfield: "all",
        status: "all",
        sort: "next_due_asc",
        showPast: false,
    };

    function formatForDateTimeLocalInput(date) {
        if (!date) return '';
        const dateObj = typeof date === 'string' ? new Date(date) : date;

        const formatted = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Etc/GMT+12', // AOE
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).format(dateObj);

        return formatted.replace(' ', 'T');
    }

    // --- URL MANAGEMENT ---
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

    // --- HELPER: 사용자 로컬 시간 기준으로 자정(00:00)을 반환 ---
    function toLocalMidnight(date) {
        const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const localStr = date.toLocaleString('en-US', { timeZone: userTZ });
        const local = new Date(localStr);
        return new Date(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, 0);
    }

    // --- HELPER: 로컬 자정 기준 D-day 차이 계산 (양수=미래, 음수=과거) ---
    function calcDiffDays(targetDate) {
        const now = new Date();
        const todayMidnight = toLocalMidnight(now);
        const targetMidnight = toLocalMidnight(targetDate);
        return Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
    }

    // --- DATA HANDLING ---
    function normalizeItem(raw) {
        const areas = (typeof raw.areas === 'object' && raw.areas !== null) ? raw.areas : {};
        const deadlinesList = Array.isArray(raw.deadlines) ? raw.deadlines : [];

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
                // ✅ 로컬 자정 기준으로 "soon" 판정
                const diffDays = calcDiffDays(nextDue);
                if (diffDays <= 7) status = "soon";
            }
        }
        return { ...raw, areas, deadlines, nextDue, status };
    }

    async function loadData() {
        const { data, error } = await supabaseClient
            .from('conferences')
            .select(`
                id, name, conf_start_date, conf_end_date, location, site_url, areas, tags, note, timezone,
                deadlines (
                    deadline_type,
                    due_date
                )
            `);

        if (error) {
            console.error("Error fetching data from Supabase:", error);
            throw error;
        }

        const transformedData = data.map(conf => {
            const deadlines = conf.deadlines.map(d => ({
                type: d.deadline_type,
                due: d.due_date
            }));

            return {
                ...conf,
                site: conf.site_url,
                dates: {
                    conf_start: conf.conf_start_date,
                    conf_end: conf.conf_end_date
                },
                deadlines: deadlines
            };
        });

        return transformedData.map(normalizeItem);
    }

    // --- CORE LOGIC (FILTER & SORT) ---
    function applyFilters() {
        const q = state.q.trim().toLowerCase();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        state.filtered = state.items.filter(it => {
            if (!state.showPast) {
                const confEnd = it.dates?.conf_end;
                if (confEnd) {
                    const confEndDate = new Date(confEnd);
                    if (confEndDate < today) {
                        return false;
                    }
                }
            }

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

            const aHasDeadline = !!a.nextDue;
            const bHasDeadline = !!b.nextDue;

            if (aHasDeadline && bHasDeadline) {
                return a.nextDue - b.nextDue;
            } else if (aHasDeadline) {
                return -1;
            } else if (bHasDeadline) {
                return 1;
            } else {
                const startDateA = a.dates?.conf_start;
                const startDateB = b.dates?.conf_start;

                if (startDateA && startDateB) {
                    return new Date(startDateA) - new Date(startDateB);
                }
                return (a.name || "").localeCompare(b.name || "");
            }
        });
    }

    // --- RENDERING ---
    function render() {
        applyFilters();

        const cardsContainer = QS("#cards");
        const noResultsContainer = QS("#noResults");

        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            const existingTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
            if (existingTooltip) {
                existingTooltip.dispose();
            }
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });

        if (state.filtered.length === 0) {
            cardsContainer.innerHTML = '';
            cardsContainer.style.display = 'none';
            noResultsContainer.classList.remove('d-none');
        } else {
            const html = state.filtered.map(renderCard).join("");
            cardsContainer.innerHTML = html;
            cardsContainer.style.display = 'grid';
            noResultsContainer.classList.add('d-none');
        }

        QS("#resultCount").textContent = state.filtered.length;
        startCountdownTimer();

        const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
        popoverTriggerList.map(function (popoverTriggerEl) {
            return new bootstrap.Popover(popoverTriggerEl, { trigger: 'focus' });
        });
    }

    function renderCard(item) {
        const name = item.name || "";
        const url = item.site || "#";
        const note = item.note || "";

        const conferenceEvent = {
            id: `${item.id}-conference`,
            title: item.name,
            start: item.dates?.conf_start,
            end: item.dates?.conf_end,
            location: item.location || '',
            description: `Conference Website: ${item.site || 'N/A'}`
        };

        let deadlineDisplayHTML;
        const hasDeadlines = item.deadlines && item.deadlines.length > 0;
        const now = new Date();

        if (!hasDeadlines) {
            deadlineDisplayHTML = '<span class="small text-body-secondary">Deadlines Coming Soon!</span>';

        } else if (!item.nextDue) {
            const summaryText = `<span class="text-body-secondary">All deadlines have passed</span>`;
            const allDeadlinesList = item.deadlines.map(d =>
                `<li class="list-group-item border-0 py-1 text-body-secondary"><small><strong>${d.type}:</strong> ${formatDateAOE(d.due)}</small></li>`
            ).join('');

            deadlineDisplayHTML = `
            <details class="deadline-details">
                <summary class="small">${summaryText}</summary>
                <ul class="list-group list-group-flush mt-2">
                    ${allDeadlinesList}
                </ul>
            </details>
        `;

        } else {
            if (item.deadlines.length === 1) {
                const singleDeadline = item.deadlines[0];
                deadlineDisplayHTML = `
                <div>
                    <span class="small">
                        <strong>${singleDeadline.type}:</strong> ${formatDateAOE(singleDeadline.due)}
                    </span>
                </div>
            `;
            } else {
                const nextDeadlineDetails = item.deadlines.find(d => d.due.getTime() === item.nextDue.getTime());
                const deadlineType = nextDeadlineDetails ? nextDeadlineDetails.type : 'Next Deadline';
                const summaryText = `<strong>${deadlineType}:</strong> ${formatDateAOE(item.nextDue)}`;
                const allDeadlinesList = item.deadlines.map(d => {
                    const isPassed = d.due < now;
                    const textClass = isPassed ? 'text-body-secondary' : '';
                    return `<li class="list-group-item border-0 py-1 ${textClass}"><small><strong>${d.type}:</strong> ${formatDateAOE(d.due)}</small></li>`;
                }).join('');

                deadlineDisplayHTML = `
                <details class="deadline-details">
                    <summary class="small">${summaryText}</summary>
                    <ul class="list-group list-group-flush mt-2">
                        ${allDeadlinesList}
                    </ul>
                </details>
            `;
            }
        }

        const deadlineMenuItemsHTML = item.deadlines.filter(deadline => deadline.due > now).map((deadline, index) => {
            const deadlineEvent = {
                id: `${item.id}-deadline-${index}`,
                title: `${item.name}: ${deadline.type}`,
                start: deadline.due,
                end: deadline.due,
                location: item.location || '',
                description: `Type: ${deadline.type}`
            };

            return `
            <li><h6 class="dropdown-header ps-3 text-body-secondary">${deadline.type}</h6></li>
            <li><a class="dropdown-item" href="${generateCalendarLink('google', deadlineEvent)}" target="_blank" rel="noopener">Google Calendar</a></li>
            <li><a class="dropdown-item" href="${generateCalendarLink('outlook', deadlineEvent)}" target="_blank" rel="noopener">Outlook Calendar</a></li>
            <li><a class="dropdown-item ics-download-link" href="#"
                   data-event-type="deadline"
                   data-conf-id="${item.id}"
                   data-deadline-index="${index}">Download ICS (.ics)</a></li>
        `;
        }).join('');

        const addToCalendarHTML =
            `
                <div class="dropdown">
                    <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                        <i class="bi bi-calendar2-plus"></i>
                    </button>
                    <ul class="dropdown-menu">
                        <li><h6 class="dropdown-header">Conference Schedule</h6></li>
                        <li><a class="dropdown-item" href="${generateCalendarLink('google', conferenceEvent)}" target="_blank" rel="noopener">Google Calendar</a></li>
                        <li><a class="dropdown-item" href="${generateCalendarLink('outlook', conferenceEvent)}" target="_blank" rel="noopener">Outlook Calendar</a></li>
                        <li><a class="dropdown-item ics-download-link" href="#"
                            data-event-type="conference"
                            data-conf-id="${item.id}">Download ICS (.ics)</a></li>
                        
                        ${deadlineMenuItemsHTML ? '<li><hr class="dropdown-divider"></li>' : ''}
            
                        ${deadlineMenuItemsHTML}
                    </ul>
                </div>
            `;

        const dBadgeHTML = dBadge(item);
        const countdownHTML = item.nextDue ? `<div class="js-countdown small mt-1" data-deadline="${item.nextDue.toISOString()}">--:--:--</div>` : "";

        return `
                <article class="card h-100 shadow-sm border-0">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                                <h5 class="card-title mb-1">${name}</h5>
                                <div class="text-muted small">${item.location || ""}</div>
                                <div class="text-muted small">${item.dates?.conf_start || ''} ~ ${item.dates?.conf_end || ''}</div>
                            </div>
                            <div class="text-end">${dBadgeHTML}${countdownHTML}</div>
                        </div>
                        <div class="mb-2 tag-list">
                            ${renderAreaBadges(item.areas)}
                            ${renderTagChips(item.tags)}
                        </div>
                        <div class="mb-2">
                            ${deadlineDisplayHTML} 
                        </div>
                        <div class="d-flex gap-2">
                            ${item.site ? `
                                <a href="${item.site}" class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener" 
                                data-bs-toggle="tooltip" title="Visit Website">
                                    <i class="bi bi-box-arrow-up-right"></i>
                                </a>` : ""}

                            ${addToCalendarHTML}

                            <button class="btn btn-sm btn-outline-secondary" 
                                    data-bs-toggle="modal" 
                                    data-bs-target="#suggestEditModal" 
                                    data-conf-id="${item.id}"
                                    data-bs-toggle="tooltip" title="Suggest an Edit">
                                <i class="bi bi-pencil-square"></i>
                            </button>
                        </div>
                    </div>
                </article>`;
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

    // --- UI & EVENT HANDLING ---
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

        on("#showPastConf", "change", e => {
            state.showPast = e.target.checked;
            render();
        });

        const savedTheme = localStorage.getItem("theme");
        if (savedTheme) { document.documentElement.setAttribute("data-bs-theme", savedTheme); }
    }

    function formatDateAOE(date) {
        return new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Etc/GMT+12',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).format(date) + " (AOE)";
    }

    // ✅ [수정] dBadge: 로컬 자정 기준 D-day 계산 + 지난 마감일은 D+ 표시
    function dBadge(item) {
        if (item.status === "coming_soon") {
            return `<span class="badge deadline-badge badge-comingsoon">Coming Soon!</span>`;
        }

        const now = new Date();

        // 마감일이 모두 지난 경우: 가장 최근 마감일 기준으로 D+ 표시
        if (!item.nextDue) {
            if (item.deadlines && item.deadlines.length > 0) {
                const lastDeadline = item.deadlines.reduce((latest, d) => d.due > latest.due ? d : latest);
                const diffDays = calcDiffDays(lastDeadline.due); // 음수값
                const daysPast = Math.abs(diffDays);
                return `<span class="badge deadline-badge badge-closed">D+${daysPast}</span>`;
            }
            return `<span class="badge deadline-badge badge-closed">Closed</span>`;
        }

        // 다가올 마감일이 있는 경우: 로컬 자정 기준 D-day 계산
        const diffDays = calcDiffDays(item.nextDue);

        if (diffDays === 0) {
            // 오늘이 마감일 (아직 실제 시각은 안 지남)
            return `<span class="badge deadline-badge badge-soon">D-DAY</span>`;
        }

        if (diffDays < 0) {
            // 자정 기준으로는 지났지만 nextDue가 아직 미래인 엣지케이스 방어
            return `<span class="badge deadline-badge badge-soon">D-DAY</span>`;
        }

        const cls = diffDays <= 7 ? "badge-soon" : "badge-upcoming";
        return `<span class="badge deadline-badge ${cls}">D-${diffDays}</span>`;
    }

    function renderTagChips(tags) {
        if (!tags || !tags.length) return "";
        return tags.map(t => `<span class="badge rounded-pill text-bg-light border">${t}</span>`).join("");
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

    function generateCalendarLink(type, eventDetails) {
        const toUTCFormat = (dateStr) => {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            return d.toISOString().replace(/-|:|\.\d+/g, '');
        };

        const title = encodeURIComponent(eventDetails.title);
        const startTime = toUTCFormat(eventDetails.start);
        const endTime = toUTCFormat(eventDetails.end);
        const location = encodeURIComponent(eventDetails.location || '');
        const details = encodeURIComponent(eventDetails.description);

        if (type === 'google') {
            return `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startTime}/${endTime}&location=${location}&details=${details}`;
        }

        if (type === 'outlook') {
            return `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${title}&startdt=${startTime}&enddt=${endTime}&location=${location}&body=${details}`;
        }

        return '#';
    }

    function generateICSContent(eventDetails) {
        const toUTCFormat = (dateStr) => {
            if (!dateStr) return '';
            return new Date(dateStr).toISOString().replace(/-|:|\.\d+/g, '');
        };

        const startDate = toUTCFormat(eventDetails.start);
        const endDate = toUTCFormat(eventDetails.end);

        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            `UID:${eventDetails.id}@alldeadlines.info`,
            `DTSTAMP:${toUTCFormat(new Date().toISOString())}`,
            `DTSTART:${startDate}`,
            `DTEND:${endDate}`,
            `SUMMARY:${eventDetails.title}`,
            `DESCRIPTION:${eventDetails.description.replace(/\n/g, '\\n')}`,
            `LOCATION:${eventDetails.location}`,
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');
    }

    function downloadICSFile(eventDetails) {
        const icsContent = generateICSContent(eventDetails);
        const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        const safeFileName = eventDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        link.setAttribute('download', `${safeFileName}.ics`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // --- INITIALIZATION ---
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

        // .ics download link event listener
        const cardsContainer = QS("#cards");
        cardsContainer.addEventListener('click', (event) => {
            if (!event.target.classList.contains('ics-download-link')) {
                return;
            }
            event.preventDefault();

            const link = event.target;
            const confId = link.getAttribute('data-conf-id');
            const eventType = link.getAttribute('data-event-type');
            const item = state.items.find(conf => conf.id === confId);

            if (!item) return;

            let eventDetails;

            if (eventType === 'conference') {
                eventDetails = {
                    id: `${item.id}-conference`,
                    title: item.name,
                    start: item.dates?.conf_start,
                    end: item.dates?.conf_end,
                    location: item.location || '',
                    description: `Conference Website: ${item.site || 'N/A'}`
                };
            } else if (eventType === 'deadline') {
                const deadlineIndex = parseInt(link.getAttribute('data-deadline-index'), 10);
                const deadline = item.deadlines[deadlineIndex];
                if (!deadline) return;

                eventDetails = {
                    id: `${item.id}-deadline-${deadlineIndex}`,
                    title: `${item.name}: ${deadline.type}`,
                    start: deadline.due,
                    end: deadline.due,
                    location: item.location || '',
                    description: `Type: ${deadline.type}`
                };
            }

            if (eventDetails) {
                downloadICSFile(eventDetails);
            }
        });

        // --- Suggestion Modal & Form Logic ---

        const suggestModal = QS('#suggestModal');
        const suggestionForm = QS("#suggestionForm");
        const subfieldsContainer = QS('#subfieldsContainer');
        const addSubfieldBtn = QS('#addSubfieldBtn');
        const suggestionDeadlinesContainer = QS('#suggestionDeadlinesContainer');
        const addSuggestionDeadlineBtn = QS('#addSuggestionDeadlineBtn');

        const suggestEditModalEl = QS('#suggestEditModal');
        const suggestEditForm = QS('#suggestEditForm');
        const suggestEditCategoryInput = QS('#suggestEditCategory');
        const suggestEditSubfieldsContainer = QS('#suggestEditSubfieldsContainer');
        const addSuggestEditSubfieldBtn = QS('#addSuggestEditSubfieldBtn');
        const suggestEditDeadlinesContainer = QS('#suggestEditDeadlinesContainer');
        const addSuggestEditDeadlineBtn = QS('#addSuggestEditDeadlineBtn');

        const addSubfieldInput = () => {
            const div = document.createElement('div');
            div.className = 'input-group mb-2';
            div.innerHTML = `
                <input type="text" class="form-control subfield-input" placeholder="e.g., NLP">
                <button class="btn btn-outline-danger remove-subfield-btn" type="button" aria-label="Remove subfield">&times;</button>
            `;
            subfieldsContainer.appendChild(div);
        };
        const resetSubfieldInputs = () => {
            if (!subfieldsContainer) return;
            subfieldsContainer.innerHTML = `
                <div class="input-group mb-2">
                    <input type="text" class="form-control subfield-input" placeholder="CV, NLP, ..." required>
                </div>
            `;
        };
        const addSuggestionDeadlineInput = () => {
            const div = document.createElement('div');
            div.className = 'input-group mb-2';
            div.innerHTML = `
            <input type="text" class="form-control suggestion-deadline-type" placeholder="Type (e.g., Full Paper)">
            <input type="datetime-local" class="form-control suggestion-deadline-due">
            <button class="btn btn-outline-danger remove-suggestion-deadline-btn" type="button">&times;</button>
        `;
            suggestionDeadlinesContainer.appendChild(div);
        };

        function addSuggestEditSubfieldInput(value = '') {
            const div = document.createElement('div');
            div.className = 'input-group mb-2';
            div.innerHTML = `
                <input type="text" class="form-control suggest-edit-subfield-input" value="${value}">
                <button class="btn btn-outline-danger remove-subfield-btn" type="button">&times;</button>
            `;
            suggestEditSubfieldsContainer.appendChild(div);
        }
        function addSuggestEditDeadlineInput(type = '', date = '') {
            const div = document.createElement('div');
            div.className = 'input-group mb-2';
            const formattedDate = formatForDateTimeLocalInput(date);
            div.innerHTML = `
                <input type="text" class="form-control deadline-type" placeholder="Type (e.g., Full Paper)" value="${type}">
                <input type="datetime-local" class="form-control deadline-date" value="${formattedDate}">
                <button class="btn btn-outline-danger remove-deadline-btn" type="button">&times;</button>
            `;
            suggestEditDeadlinesContainer.appendChild(div);
        }

        if (addSubfieldBtn) {
            addSubfieldBtn.addEventListener('click', addSubfieldInput);
        }
        if (subfieldsContainer) {
            subfieldsContainer.addEventListener('click', (event) => {
                if (event.target.classList.contains('remove-subfield-btn')) {
                    event.target.closest('.input-group').remove();
                }
            });
        }
        if (addSuggestionDeadlineBtn) {
            addSuggestionDeadlineBtn.addEventListener('click', addSuggestionDeadlineInput);
        }
        if (suggestionDeadlinesContainer) {
            suggestionDeadlinesContainer.addEventListener('click', (event) => {
                if (event.target.classList.contains('remove-suggestion-deadline-btn')) {
                    event.target.closest('.input-group').remove();
                }
            });
        }
        if (suggestModal) {
            suggestModal.addEventListener('hidden.bs.modal', () => {
                suggestionForm?.reset();
                QS('#suggestionAlert')?.classList.add('d-none');
                resetSubfieldInputs();
                if (suggestionDeadlinesContainer) {
                    suggestionDeadlinesContainer.innerHTML = `
                <div class="input-group mb-2">
                    <input type="text" class="form-control suggestion-deadline-type" placeholder="Type (e.g., Abstract)" required>
                    <input type="datetime-local" class="form-control suggestion-deadline-due" required>
                </div>
            `;
                }
            });
        }
        if (suggestionForm) {
            suggestionForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (!suggestionForm.checkValidity()) {
                    suggestionForm.reportValidity();
                    return;
                }

                const submitButton = suggestionForm.querySelector('button[type="submit"]');
                const alertBox = QS("#suggestionAlert");
                submitButton.disabled = true;
                submitButton.textContent = 'Submitting...';

                const subfieldValues = [...subfieldsContainer.querySelectorAll('.subfield-input')]
                    .map(input => input.value.trim()).filter(value => value);

                const deadlines = [];
                suggestionDeadlinesContainer.querySelectorAll('.input-group').forEach(group => {
                    const type = group.querySelector('.suggestion-deadline-type').value.trim();
                    const due = group.querySelector('.suggestion-deadline-due').value;
                    if (type && due) {
                        deadlines.push({ type: type, due: new Date(due + ':00-12:00').toISOString() });
                    }
                });

                const suggestion = {
                    name: QS("#confName").value,
                    site_url: QS("#confUrl").value,
                    location: QS("#confLocation").value,
                    conf_start_date: QS("#confStartDate").value || null,
                    conf_end_date: QS("#confEndDate").value || null,
                    category: QS("#category").value,
                    subfields: subfieldValues.join(', '),
                    deadlines: deadlines
                };

                const { error } = await supabaseClient.from('conference_suggestions').insert([suggestion]);

                if (error) {
                    alertBox.className = 'alert alert-danger';
                    alertBox.textContent = `Error: ${error.message}`;
                } else {
                    alertBox.className = 'alert alert-success';
                    alertBox.textContent = 'Thank you! Your suggestion has been submitted for review.';
                    suggestionForm.reset();
                    resetSubfieldInputs();
                    if (suggestionDeadlinesContainer) {
                        suggestionDeadlinesContainer.innerHTML = `
                    <div class="input-group mb-2">
                        <input type="text" class="form-control suggestion-deadline-type" placeholder="Type (e.g., Abstract)" required>
                        <input type="datetime-local" class="form-control suggestion-deadline-due" required>
                    </div>
                `;
                    }
                }
                alertBox.classList.remove('d-none');
                submitButton.disabled = false;
                submitButton.textContent = 'Submit for Review';
            });
        }

        suggestEditModalEl.addEventListener('show.bs.modal', (event) => {
            const button = event.relatedTarget;
            const confId = button.getAttribute('data-conf-id');
            const item = state.items.find(conf => conf.id === confId);
            if (!item) return;

            suggestEditForm.reset();
            suggestEditSubfieldsContainer.innerHTML = '';
            suggestEditDeadlinesContainer.innerHTML = '';

            QS('#suggestEditConfId').value = item.id;
            QS('#suggestEditConfName').value = item.name;
            QS('#suggestEditConfUrl').value = item.site;
            QS('#suggestEditConfLocation').value = item.location;
            QS('#suggestEditConfStartDate').value = item.dates?.conf_start;
            QS('#suggestEditConfEndDate').value = item.dates?.conf_end;

            if (item.areas) {
                const firstCategory = Object.keys(item.areas)[0] || '';
                suggestEditCategoryInput.value = firstCategory;
                const subfields = item.areas[firstCategory] || [];
                if (subfields.length > 0) {
                    subfields.forEach(sub => addSuggestEditSubfieldInput(sub));
                } else {
                    addSuggestEditSubfieldInput();
                }
            } else {
                addSuggestEditSubfieldInput();
            }

            if (item.deadlines && item.deadlines.length > 0) {
                item.deadlines.forEach(d => addSuggestEditDeadlineInput(d.type, d.due));
            } else {
                addSuggestEditDeadlineInput();
            }
        });

        addSuggestEditSubfieldBtn.addEventListener('click', () => addSuggestEditSubfieldInput());
        suggestEditSubfieldsContainer.addEventListener('click', (e) => {
            if (e.target.matches('.remove-subfield-btn')) {
                if (suggestEditSubfieldsContainer.querySelectorAll('.input-group').length > 1) {
                    e.target.closest('.input-group').remove();
                }
            }
        });
        addSuggestEditDeadlineBtn.addEventListener('click', () => addSuggestEditDeadlineInput());
        suggestEditDeadlinesContainer.addEventListener('click', (e) => {
            if (e.target.matches('.remove-deadline-btn')) {
                if (suggestEditDeadlinesContainer.querySelectorAll('.input-group').length > 1) {
                    e.target.closest('.input-group').remove();
                }
            }
        });

        suggestEditForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const submitButton = suggestEditForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;

            const targetId = QS('#suggestEditConfId').value;

            const deadlines = [];
            suggestEditDeadlinesContainer.querySelectorAll('.input-group').forEach(group => {
                const type = group.querySelector('.deadline-type').value.trim();
                const due = group.querySelector('.deadline-date').value;
                if (type && due) {
                    deadlines.push({ type, due: new Date(due + ':00-12:00').toISOString() });
                }
            });

            const category = suggestEditCategoryInput.value.trim();
            const subfields = [...suggestEditSubfieldsContainer.querySelectorAll('.suggest-edit-subfield-input')]
                .map(input => input.value.trim()).filter(Boolean).join(', ');

            const finalSuggestion = {
                name: QS('#suggestEditConfName').value,
                site_url: QS('#suggestEditConfUrl').value,
                location: QS('#suggestEditConfLocation').value,
                conf_start_date: QS('#suggestEditConfStartDate').value || null,
                conf_end_date: QS('#suggestEditConfEndDate').value || null,
                deadlines: deadlines,
                category: category,
                subfields: subfields,
                is_edit: true,
                target_conference_id: targetId,
            };

            const { error } = await supabaseClient.from('conference_suggestions').insert([finalSuggestion]);

            if (error) {
                alert(`Error submitting suggestion: ${error.message}`);
            } else {
                alert('Thank you! Your edit suggestion has been submitted for review.');
                const modal = bootstrap.Modal.getInstance(suggestEditModalEl);
                modal.hide();
            }
            submitButton.disabled = false;
        });
    });
})();