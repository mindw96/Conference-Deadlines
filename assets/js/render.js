(function (window) {
    const CD = window.ConferenceDeadlines = window.ConferenceDeadlines || {};

    let countdownTimer = null;

    function renderAreaBadges(areas) {
        let html = '';

        for (const category in areas) {
            html += `<span class="badge rounded-pill badge-area badge-area-default">${CD.escapeHTML(category)}</span>`;
            (areas[category] || []).forEach(subfield => {
                html += `<span class="badge rounded-pill text-bg-light border">${CD.escapeHTML(subfield)}</span>`;
            });
        }

        return html;
    }

    function renderTagChips(tags) {
        if (!tags || !tags.length) return '';
        return tags
            .map(tag => `<span class="badge rounded-pill text-bg-light border">${CD.escapeHTML(tag)}</span>`)
            .join('');
    }

    function renderDeadlineList(deadlines, now) {
        return deadlines.map(deadline => {
            const textClass = deadline.due < now ? ' text-body-secondary' : '';
            return `
                <li class="list-group-item border-0 py-1${textClass}">
                    <small><strong>${CD.escapeHTML(deadline.type)}:</strong> ${CD.escapeHTML(CD.formatDateAOE(deadline.due))}</small>
                </li>
            `;
        }).join('');
    }

    function renderDeadlineDisplay(item) {
        const deadlines = item.deadlines || [];
        const now = new Date();

        if (deadlines.length === 0) {
            return '<span class="small text-body-secondary">Deadlines Coming Soon!</span>';
        }

        if (!item.nextDue) {
            return `
                <details class="deadline-details">
                    <summary class="small"><span class="text-body-secondary">All deadlines have passed</span></summary>
                    <ul class="list-group list-group-flush mt-2">
                        ${renderDeadlineList(deadlines, now)}
                    </ul>
                </details>
            `;
        }

        if (deadlines.length === 1) {
            const deadline = deadlines[0];
            return `
                <div>
                    <span class="small">
                        <strong>${CD.escapeHTML(deadline.type)}:</strong> ${CD.escapeHTML(CD.formatDateAOE(deadline.due))}
                    </span>
                </div>
            `;
        }

        const nextDeadline = deadlines.find(deadline => deadline.due.getTime() === item.nextDue.getTime());
        const deadlineType = nextDeadline ? nextDeadline.type : 'Next Deadline';

        return `
            <details class="deadline-details">
                <summary class="small">
                    <strong>${CD.escapeHTML(deadlineType)}:</strong> ${CD.escapeHTML(CD.formatDateAOE(item.nextDue))}
                </summary>
                <ul class="list-group list-group-flush mt-2">
                    ${renderDeadlineList(deadlines, now)}
                </ul>
            </details>
        `;
    }

    function renderCalendarMenu(item) {
        const now = new Date();
        const conferenceEvent = CD.calendar.createConferenceEvent(item);
        const deadlineMenuItemsHTML = (item.deadlines || [])
            .map((deadline, index) => ({ deadline, index }))
            .filter(({ deadline }) => deadline.due > now)
            .map(({ deadline, index }) => {
                const deadlineEvent = CD.calendar.createDeadlineEvent(item, deadline, index);
                const googleLink = CD.calendar.generateCalendarLink('google', deadlineEvent);
                const outlookLink = CD.calendar.generateCalendarLink('outlook', deadlineEvent);

                return `
                    <li><h6 class="dropdown-header ps-3 text-body-secondary">${CD.escapeHTML(deadline.type)}</h6></li>
                    <li><a class="dropdown-item" href="${CD.escapeAttr(googleLink)}" target="_blank" rel="noopener">Google Calendar</a></li>
                    <li><a class="dropdown-item" href="${CD.escapeAttr(outlookLink)}" target="_blank" rel="noopener">Outlook Calendar</a></li>
                    <li><a class="dropdown-item ics-download-link" href="#"
                        data-event-type="deadline"
                        data-conf-id="${CD.escapeAttr(item.id)}"
                        data-deadline-index="${CD.escapeAttr(index)}">Download ICS (.ics)</a></li>
                `;
            }).join('');

        const conferenceGoogleLink = CD.calendar.generateCalendarLink('google', conferenceEvent);
        const conferenceOutlookLink = CD.calendar.generateCalendarLink('outlook', conferenceEvent);

        return `
            <div class="dropdown">
                <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Add to calendar">
                    <i class="bi bi-calendar2-plus"></i>
                </button>
                <ul class="dropdown-menu">
                    <li><h6 class="dropdown-header">Conference Schedule</h6></li>
                    <li><a class="dropdown-item" href="${CD.escapeAttr(conferenceGoogleLink)}" target="_blank" rel="noopener">Google Calendar</a></li>
                    <li><a class="dropdown-item" href="${CD.escapeAttr(conferenceOutlookLink)}" target="_blank" rel="noopener">Outlook Calendar</a></li>
                    <li><a class="dropdown-item ics-download-link" href="#"
                        data-event-type="conference"
                        data-conf-id="${CD.escapeAttr(item.id)}">Download ICS (.ics)</a></li>
                    ${deadlineMenuItemsHTML ? '<li><hr class="dropdown-divider"></li>' : ''}
                    ${deadlineMenuItemsHTML}
                </ul>
            </div>
        `;
    }

    function deadlineBadge(item) {
        if (item.status === 'coming_soon') {
            return '<span class="badge deadline-badge badge-comingsoon">Coming Soon!</span>';
        }

        if (!item.nextDue) {
            if (item.deadlines && item.deadlines.length > 0) {
                const lastDeadline = item.deadlines.reduce((latest, deadline) => deadline.due > latest.due ? deadline : latest);
                const daysPast = Math.abs(CD.calcDiffDays(lastDeadline.due));
                return `<span class="badge deadline-badge badge-closed">D+${CD.escapeHTML(daysPast)}</span>`;
            }
            return '<span class="badge deadline-badge badge-closed">Closed</span>';
        }

        const diffDays = CD.calcDiffDays(item.nextDue);
        if (diffDays <= 0) {
            return '<span class="badge deadline-badge badge-soon">D-DAY</span>';
        }

        const cls = diffDays <= 7 ? 'badge-soon' : 'badge-upcoming';
        return `<span class="badge deadline-badge ${cls}">D-${CD.escapeHTML(diffDays)}</span>`;
    }

    function renderCard(item) {
        const site = CD.safeURL(item.site);
        const websiteButton = site !== '#'
            ? `
                <a href="${CD.escapeAttr(site)}" class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener"
                    data-bs-toggle="tooltip" title="Visit Website" aria-label="Visit ${CD.escapeAttr(item.name)} website">
                    <i class="bi bi-box-arrow-up-right"></i>
                </a>
            `
            : '';
        const countdownHTML = item.nextDue
            ? `<div class="js-countdown small mt-1" data-deadline="${CD.escapeAttr(item.nextDue.toISOString())}">--:--:--</div>`
            : '';

        return `
            <article class="card h-100 shadow-sm border-0">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div>
                            <h5 class="card-title mb-1">${CD.escapeHTML(item.name)}</h5>
                            <div class="text-muted small">${CD.escapeHTML(item.location || '')}</div>
                            <div class="text-muted small">${CD.escapeHTML(item.dates?.conf_start || '')} ~ ${CD.escapeHTML(item.dates?.conf_end || '')}</div>
                        </div>
                        <div class="text-end">${deadlineBadge(item)}${countdownHTML}</div>
                    </div>
                    <div class="mb-2 tag-list">
                        ${renderAreaBadges(item.areas)}
                        ${renderTagChips(item.tags)}
                    </div>
                    <div class="mb-2">
                        ${renderDeadlineDisplay(item)}
                    </div>
                    <div class="d-flex gap-2">
                        ${websiteButton}
                        ${renderCalendarMenu(item)}
                        <button class="btn btn-sm btn-outline-secondary"
                            data-bs-toggle="modal"
                            data-bs-target="#suggestEditModal"
                            data-conf-id="${CD.escapeAttr(item.id)}"
                            title="Suggest an Edit"
                            aria-label="Suggest an edit for ${CD.escapeAttr(item.name)}">
                            <i class="bi bi-pencil-square"></i>
                        </button>
                    </div>
                </div>
            </article>
        `;
    }

    function formatCountdown(ms) {
        const sec = Math.floor(ms / 1000);
        const days = Math.floor(sec / 86400);
        const hours = Math.floor((sec % 86400) / 3600);
        const minutes = Math.floor((sec % 3600) / 60);
        const seconds = sec % 60;
        const pad = value => String(value).padStart(2, '0');
        const hhmmss = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
        return days > 0 ? `${days}D ${hhmmss}` : hhmmss;
    }

    function updateCountdowns(onExpire) {
        const now = Date.now();
        let needsRerender = false;

        CD.QSA('.js-countdown').forEach(el => {
            const iso = el.getAttribute('data-deadline');
            const due = iso ? Date.parse(iso) : NaN;
            if (Number.isNaN(due)) return;

            const diff = due - now;
            if (diff <= 0) {
                el.textContent = '00:00:00';
                el.classList.remove('text-danger');
                needsRerender = true;
            } else {
                el.textContent = formatCountdown(diff);
                el.classList.toggle('text-danger', diff <= 24 * 3600 * 1000);
            }
        });

        if (needsRerender && typeof onExpire === 'function') {
            stopCountdownTimer();
            onExpire();
        }
    }

    function startCountdownTimer(onExpire) {
        stopCountdownTimer();
        updateCountdowns(onExpire);

        if (CD.QS('.js-countdown')) {
            countdownTimer = setInterval(() => updateCountdowns(onExpire), 1000);
        }
    }

    function stopCountdownTimer() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    }

    CD.render = {
        renderCard,
        renderAreaBadges,
        renderTagChips,
        deadlineBadge,
        formatCountdown,
        startCountdownTimer,
        stopCountdownTimer
    };
})(window);
