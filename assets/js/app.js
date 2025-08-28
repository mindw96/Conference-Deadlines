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

    // --- URL MANAGEMENT ---
    /**
     * Reads filter/sort parameters from the URL query string and applies them to the state.
     * This allows users to share links with specific filters active.
     */
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

    /**
     * Updates the URL in the address bar to reflect the current filter/sort state.
     * This creates a permalink for the current view.
     */
    function updatePermalink() {
        const url = new URL(location.href);
        url.searchParams.set("q", state.q);
        url.searchParams.set("category", state.category);
        url.searchParams.set("subfield", state.subfield);
        url.searchParams.set("status", state.status);
        url.searchParams.set("sort", state.sort);
        history.replaceState(null, "", url.toString());
    }

    // --- DATA HANDLING ---
    /**
     * Processes a raw conference object from the database into a more usable format.
     * It calculates the status (upcoming, soon, closed) and finds the next deadline.
     * @param {object} raw - The raw conference object from Supabase.
     * @returns {object} The normalized conference object.
     */
    function normalizeItem(raw) {
        const areas = (typeof raw.areas === 'object' && raw.areas !== null) ? raw.areas : {};

        // With Supabase, `raw.deadlines` is always an array of {type, due} objects.
        const deadlinesList = Array.isArray(raw.deadlines) ? raw.deadlines : [];

        const parseable = (d) => d && d.due && !isNaN(Date.parse(d.due));
        const now = new Date();
        const deadlines = deadlinesList.filter(parseable).map(d => ({
            type: d.type || 'Deadline',
            due: new Date(d.due)
        }));

        // Calculate the next upcoming deadline and the conference's status.
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

    /**
     * Fetches and processes the conference data from the JSON file.
     *
     * Fetches and processes the conference data from the Supabase database.
     **/
    async function loadData() {
        // Fetch all conferences and their related deadlines in one go
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

        // Transform the data to match the application's expected format
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
    /**
     * Filters the global conference list based on the current state.
     */
    function applyFilters() {
        const q = state.q.trim().toLowerCase();

        // Get the current date, with time set to 00:00:00 for accurate comparison.
        const today = new Date();
        today.setHours(0, 0, 0, 0);


        state.filtered = state.items.filter(it => {
            // Filter out conferences where the end date has passed.
            if (!state.showPast) {
                const confEnd = it.dates?.conf_end;
                if (confEnd) {
                    const confEndDate = new Date(confEnd);
                    if (confEndDate < today) {
                        return false; // Hide if conference ended before today.
                    }
                }
            }

            // Existing filter logic for status, category, etc.
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

    /**
     * Sorts the filtered conference list based on the current sort order.
     */
    function sortItems() {
        state.filtered.sort((a, b) => {
            if (state.sort === "name_asc") {
                return (a.name || "").localeCompare(b.name || "");
            }

            // Default sort: by next upcoming deadline.
            const aHasDeadline = !!a.nextDue;
            const bHasDeadline = !!b.nextDue;

            if (aHasDeadline && bHasDeadline) {
                // 1. If both have deadlines, sort by the nearest deadline.
                return a.nextDue - b.nextDue;
            } else if (aHasDeadline) {
                // 2. If only 'a' has a deadline, 'a' comes first.
                return -1;
            } else if (bHasDeadline) {
                // 3. If only 'b' has a deadline, 'b' comes first.
                return 1;
            } else {
                // 4. If neither has a deadline (closed or coming_soon), sort by conference start date.
                const startDateA = a.dates?.conf_start;
                const startDateB = b.dates?.conf_start;

                if (startDateA && startDateB) {
                    return new Date(startDateA) - new Date(startDateB);
                }
                // Fallback to sorting by name if no start date is available.
                return (a.name || "").localeCompare(b.name || "");
            }
        });
    }

    // --- RENDERING ---
    /**
     * Main render function: applies filters/sort and updates the DOM with the results.
     */
    // app.js

    function render() {
        applyFilters();

        const cardsContainer = QS("#cards");
        const noResultsContainer = QS("#noResults");

        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            // 기존 툴팁이 있다면 파괴하고 새로 만듭니다.
            const existingTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
            if (existingTooltip) {
                existingTooltip.dispose();
            }
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });

        // [수정] 로직을 깔끔하게 정리합니다.
        if (state.filtered.length === 0) {
            // 결과가 없으면: '결과 없음' 메시지를 보여주고, 카드 컨테이너는 숨깁니다.
            cardsContainer.innerHTML = ''; // 기존 카드 내용 비우기
            cardsContainer.style.display = 'none';
            noResultsContainer.classList.remove('d-none');
        } else {
            // 결과가 있으면: 카드 컨테이너를 보여주고, '결과 없음' 메시지는 숨깁니다.
            const html = state.filtered.map(renderCard).join("");
            cardsContainer.innerHTML = html;
            cardsContainer.style.display = 'grid'; // 원래 display 속성으로 복원
            noResultsContainer.classList.add('d-none');
        }

        QS("#resultCount").textContent = state.filtered.length;
        startCountdownTimer();

        // Popover 기능을 활성화하는 코드
        const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
        popoverTriggerList.map(function (popoverTriggerEl) {
            return new bootstrap.Popover(popoverTriggerEl, { trigger: 'focus' });
        });
    }

    /**
     * Generates the HTML for a single conference card.
     * @param {object} item - The conference object to render.
     * @returns {string} The HTML string for the card.
     */
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
            // Case 1: 마감일 정보가 아예 없을 경우
            deadlineDisplayHTML = '<span class="small text-body-secondary">Deadlines Coming Soon!</span>';

        } else if (!item.nextDue) {
            // Case 2: 모든 마감일이 지났을 경우 (NEW RULE!)
            // 마감일 개수와 상관없이 무조건 details 태그로 감싸고, summary를 통일합니다.
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
            // Case 3: 다가올 마감일이 있을 경우 (기존 로직 유지)
            if (item.deadlines.length === 1) {
                // 3-1. 마감일이 정확히 하나일 경우
                const singleDeadline = item.deadlines[0];
                deadlineDisplayHTML = `
                <div>
                    <span class="small">
                        <strong>${singleDeadline.type}:</strong> ${formatDateAOE(singleDeadline.due)}
                    </span>
                </div>
            `;
            } else {
                // 3-2. 마감일이 여러 개일 경우
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
    /**
     * Scans all conference data to dynamically build the category and subfield filter options.
     */
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

    /**
     * Attaches event listeners to all user controls (search, filters, theme toggle, etc.).
     */
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

    function dBadge(item) {
        if (item.status === "coming_soon") {
            return `<span class="badge deadline-badge badge-comingsoon">Coming Soon!</span>`;
        }
        if (!item.nextDue) {
            return `<span class="badge deadline-badge badge-closed">Closed</span>`;
        }
        const now = new Date();
        const diffDays = Math.floor((item.nextDue - now) / (1000 * 60 * 60 * 24));
        const cls = diffDays <= 7 ? "badge-soon" : "badge-upcoming";
        const dayText = diffDays < 1 ? 'D-DAY' : `D-${diffDays}`;

        return `<span class="badge deadline-badge ${cls}">${dayText}</span>`;
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

    /**
     * Generates a calendar link for Google or Outlook based on event details.
     * @param {string} type - 'google' or 'outlook'.
     * @param {object} eventDetails - An object with event properties.
     * @returns {string} The generated calendar link.
     */
    function generateCalendarLink(type, eventDetails) {
        const toUTCFormat = (dateStr) => {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            // toISOString() -> "2025-12-25T00:00:00.000Z"
            // .replace(/-|:|\.\d+/g, '') -> "20251225T000000Z"
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

    /**
     * Generates the content for a universal .ics calendar file.
     * @param {object} eventDetails - An object with event properties.
     * @returns {string} The content of the .ics file.
     */
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

    /**
     * Triggers the download of a dynamically generated .ics file.
     * @param {object} item - The conference object.
     */
    function downloadICSFile(eventDetails) {
        const icsContent = generateICSContent(eventDetails);
        const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        // 파일 이름에 특수문자 제거
        const safeFileName = eventDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        link.setAttribute('download', `${safeFileName}.ics`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // --- INITIALIZATION ---
    /**
     * Main entry point: runs when the DOM is fully loaded.
     */
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
                // '학회 기간' ICS 파일 생성
                eventDetails = {
                    id: `${item.id}-conference`,
                    title: item.name,
                    start: item.dates?.conf_start,
                    end: item.dates?.conf_end,
                    location: item.location || '',
                    description: `Conference Website: ${item.site || 'N/A'}`
                };
            } else if (eventType === 'deadline') {
                // '개별 마감일' ICS 파일 생성
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
        const subfieldsContainer = QS('#subfieldsContainer');
        const addSubfieldBtn = QS('#addSubfieldBtn');
        const suggestModal = QS('#suggestModal');
        const suggestionForm = QS("#suggestionForm");
        const suggestionDeadlinesContainer = QS('#suggestionDeadlinesContainer');
        const addSuggestionDeadlineBtn = QS('#addSuggestionDeadlineBtn');
        const suggestEditModalEl = QS('#suggestEditModal');
        const suggestEditForm = QS('#suggestEditForm');
        const suggestEditCategoryInput = QS('#suggestEditCategory');
        const suggestEditSubfieldsContainer = QS('#suggestEditSubfieldsContainer');
        const addSuggestEditSubfieldBtn = QS('#addSuggestEditSubfieldBtn');

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
            const formattedDate = date ? new Date(date).toISOString().slice(0, 16) : '';
            div.innerHTML = `
        <input type="text" class="form-control deadline-type" placeholder="Type (e.g., Full Paper)" value="${type}">
        <input type="datetime-local" class="form-control deadline-date" value="${formattedDate}">
        <button class="btn btn-outline-danger remove-deadline-btn" type="button">&times;</button>
    `;
            suggestEditDeadlinesContainer.appendChild(div);
        }

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

        // Function to add a new subfield input field
        const addSubfieldInput = () => {
            const div = document.createElement('div');
            div.className = 'input-group mb-2';
            div.innerHTML = `
                <input type="text" class="form-control subfield-input" placeholder="e.g., NLP">
                <button class="btn btn-outline-danger remove-subfield-btn" type="button" aria-label="Remove subfield">&times;</button>
            `;
            subfieldsContainer.appendChild(div);
        };

        // Function to reset the subfield inputs to the initial state
        const resetSubfieldInputs = () => {
            if (!subfieldsContainer) return;
            subfieldsContainer.innerHTML = `
                <div class="input-group mb-2">
                    <input type="text" class="form-control subfield-input" placeholder="CV, NLP, ..." required>
                </div>
            `;
        };

        if (addSubfieldBtn && subfieldsContainer) {
            addSubfieldBtn.addEventListener('click', addSubfieldInput);

            // Use event delegation to handle removing subfield inputs
            subfieldsContainer.addEventListener('click', (event) => {
                if (event.target.classList.contains('remove-subfield-btn')) {
                    event.target.closest('.input-group').remove();
                }
            });
        }

        // Reset the form (including dynamic fields) when the modal is hidden
        if (suggestModal) {
            suggestModal.addEventListener('hidden.bs.modal', () => {
                suggestionForm?.reset();
                QS('#suggestionAlert')?.classList.add('d-none');
                resetSubfieldInputs();
            });
        }

        // Handle form submission
        if (suggestionForm && subfieldsContainer) {
            suggestionForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (!suggestionForm.checkValidity()) {
                    suggestionForm.reportValidity();
                    return;
                }

                const submitButton = suggestionForm.querySelector('button[type="submit"]');
                const alertBox = QS("#suggestionAlert");

                const subfieldValues = [...subfieldsContainer.querySelectorAll('.subfield-input')]
                    .map(input => input.value.trim())
                    .filter(value => value); // Filter out empty strings

                const deadlines = [];
                suggestionDeadlinesContainer.querySelectorAll('.input-group').forEach(group => {
                    const type = group.querySelector('.suggestion-deadline-type').value.trim();
                    const due = group.querySelector('.suggestion-deadline-due').value;
                    if (type && due) {
                        deadlines.push({
                            type: type,
                            due: new Date(due).toISOString()
                        });
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
                    deadlines: deadlines // <<< deadlines 배열을 JSONB 컬럼에 저장
                };

                submitButton.disabled = true;
                submitButton.textContent = 'Submitting...';

                const { error } = await supabaseClient.from('conference_suggestions').insert([suggestion]);

                if (error) {
                    alertBox.className = 'alert alert-danger';
                    alertBox.textContent = `Error: ${error.message}`;
                    console.error("Suggestion submission error:", error);
                } else {
                    alertBox.className = 'alert alert-success';
                    alertBox.textContent = 'Thank you! Your suggestion has been submitted for review.';
                    suggestionForm.reset();
                    resetSubfieldInputs();
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

            // 폼 초기화
            suggestEditForm.reset();
            suggestEditSubfieldsContainer.innerHTML = '';
            QS('#suggestEditDeadlinesContainer').innerHTML = '';

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
                    addSuggestEditSubfieldInput(); // 서브필드가 없으면 빈 칸 하나 추가
                }
            } else {
                addSuggestEditSubfieldInput(); // areas 정보가 아예 없어도 빈 칸 추가
            }

            // Deadlines 정보 채우기 (기존과 동일)
            if (item.deadlines && item.deadlines.length > 0) {
                item.deadlines.forEach(d => addSuggestEditDeadlineInput(d.type, d.due));
            }
        });

        addSuggestEditSubfieldBtn.addEventListener('click', () => addSuggestEditSubfieldInput());
        suggestEditSubfieldsContainer.addEventListener('click', (e) => {
            if (e.target.matches('.remove-subfield-btn')) {
                // 최소 1개의 입력 필드는 남겨두기
                if (suggestEditSubfieldsContainer.querySelectorAll('.input-group').length > 1) {
                    e.target.closest('.input-group').remove();
                }
            }
        });

        suggestEditForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const submitButton = suggestEditForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;

            const targetId = QS('#suggestEditConfId').value;

            // Deadlines 수집 (기존과 동일)
            const deadlines = [];
            suggestEditDeadlinesContainer.querySelectorAll('.input-group').forEach(group => {
                const type = group.querySelector('.deadline-type').value.trim();
                const due = group.querySelector('.deadline-date').value;
                if (type && due) deadlines.push({ type, due: new Date(due).toISOString() });
            });

            // Category와 Subfields 수집 (새 구조에 맞게)
            const category = suggestEditCategoryInput.value.trim();
            const subfields = [...suggestEditSubfieldsContainer.querySelectorAll('.suggest-edit-subfield-input')]
                .map(input => input.value.trim())
                .filter(Boolean)
                .join(', ');

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