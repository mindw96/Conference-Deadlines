(function (window) {
    const CD = window.ConferenceDeadlines = window.ConferenceDeadlines || {};

    let countdownTimer = null;

    function renderAreaBadges(areas) {
        let html = '';

        for (const category in areas) {
            html += `<span class="cd-badge cd-badge-area">${CD.escapeHTML(category)}</span>`;
            (areas[category] || []).forEach(subfield => {
                html += `<span class="cd-badge">${CD.escapeHTML(subfield)}</span>`;
            });
        }

        return html;
    }

    function renderTagChips(tags) {
        if (!tags || !tags.length) return '';
        return tags
            .map(tag => `<span class="cd-badge">${CD.escapeHTML(tag)}</span>`)
            .join('');
    }

    function nextDeadline(item) {
        if (!item.nextDue) return null;
        return (item.deadlines || []).find(deadline => deadline.due.getTime() === item.nextDue.getTime()) || null;
    }

    function renderDeadlineList(deadlines, now) {
        return deadlines.map(deadline => `
            <li${deadline.due < now ? ' class="is-past"' : ''}>
                <span>${CD.escapeHTML(deadline.type)}</span>
                <span class="cd-mono">${CD.escapeHTML(CD.formatDateAOEShort(deadline.due))}</span>
            </li>
        `).join('');
    }

    // Footer left column: the next deadline stamp, or why there isn't one.
    function renderDeadlineInfo(item) {
        const deadlines = item.deadlines || [];

        if (!deadlines.length) {
            return '<div class="cd-eyebrow">Deadlines to be announced</div>';
        }

        const toggle = deadlines.length > 1
            ? `<button type="button" class="cd-more js-toggle-deadlines" aria-expanded="false">
                    All ${deadlines.length} <i class="bi bi-chevron-down" aria-hidden="true"></i>
               </button>`
            : '';

        if (!item.nextDue) {
            return `
                <div class="cd-eyebrow">Last deadline</div>
                <span class="cd-deadline-next is-past">All deadlines have passed</span>
                ${toggle}
            `;
        }

        return `
            <span class="cd-deadline-next">${CD.escapeHTML(CD.formatDateAOEShort(item.nextDue))}</span>
            ${toggle}
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
                    <li><h6 class="dropdown-header">${CD.escapeHTML(deadline.type)}</h6></li>
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
                <button class="cd-icon-btn has-caret" type="button" data-bs-toggle="dropdown" aria-expanded="false"
                    title="Add to calendar" aria-label="Add to calendar">
                    <i class="bi bi-calendar2-plus" aria-hidden="true"></i>
                    <i class="bi bi-chevron-down" aria-hidden="true"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
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
            return '<span class="cd-deadline-badge is-comingsoon">Coming Soon</span>';
        }

        if (!item.nextDue) {
            if (item.deadlines && item.deadlines.length > 0) {
                const lastDeadline = item.deadlines.reduce((latest, deadline) => deadline.due > latest.due ? deadline : latest);
                const daysPast = Math.abs(CD.calcDiffDays(lastDeadline.due));
                return `<span class="cd-deadline-badge is-closed">D+${CD.escapeHTML(daysPast)}</span>`;
            }
            return '<span class="cd-deadline-badge is-closed">Closed</span>';
        }

        const diffDays = CD.calcDiffDays(item.nextDue);
        if (diffDays <= 0) {
            return '<span class="cd-deadline-badge is-today">D-DAY</span>';
        }

        const cls = diffDays <= 7 ? 'is-soon' : 'is-upcoming';
        return `<span class="cd-deadline-badge ${cls}">D-${CD.escapeHTML(diffDays)}</span>`;
    }

    function renderCard(item) {
        const now = new Date();
        const site = CD.safeURL(item.site);
        const next = nextDeadline(item);
        const deadlines = item.deadlines || [];

        const websiteButton = site !== '#'
            ? `<a class="cd-icon-btn" href="${CD.escapeAttr(site)}" target="_blank" rel="noopener"
                    title="Visit Website" aria-label="Visit ${CD.escapeAttr(item.name)} website">
                    <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
               </a>`
            : '';

        const countdownHTML = item.nextDue
            ? `<div class="cd-countdown js-countdown" data-deadline="${CD.escapeAttr(item.nextDue.toISOString())}">--:--:--</div>`
            : '';

        const dateRange = CD.formatConfRange(item.dates?.conf_start, item.dates?.conf_end);

        return `
            <article class="cd-card">
                <div class="cd-card-top">
                    <div class="cd-card-ident">
                        <h5 class="cd-card-title">${CD.escapeHTML(item.name)}</h5>
                        <div class="cd-card-meta">${CD.escapeHTML(item.location || '')}</div>
                        ${dateRange ? `<div class="cd-card-meta cd-card-meta-dim">${CD.escapeHTML(dateRange)}</div>` : ''}
                    </div>
                    <div class="cd-card-status">
                        ${deadlineBadge(item)}
                        ${next ? `<div class="cd-eyebrow">${CD.escapeHTML(next.type)}</div>` : ''}
                        ${countdownHTML}
                    </div>
                </div>

                <div class="cd-taglist">
                    ${renderAreaBadges(item.areas)}
                    ${renderTagChips(item.tags)}
                </div>

                <div class="cd-card-foot">
                    <div class="cd-card-foot-row">
                        <div class="cd-deadline-info">${renderDeadlineInfo(item)}</div>
                        <div class="cd-actions">
                            ${websiteButton}
                            ${renderCalendarMenu(item)}
                            <button class="cd-icon-btn" type="button"
                                data-bs-toggle="modal"
                                data-bs-target="#suggestEditModal"
                                data-conf-id="${CD.escapeAttr(item.id)}"
                                title="Suggest an Edit"
                                aria-label="Suggest an edit for ${CD.escapeAttr(item.name)}">
                                <i class="bi bi-pencil" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                    ${deadlines.length > 1
                ? `<ul class="cd-deadline-list" hidden>${renderDeadlineList(deadlines, now)}</ul>`
                : ''}
                </div>
            </article>
        `;
    }

    // The "All N" disclosure below the next-deadline stamp. Bound once on the
    // grid container so it survives re-renders.
    function bindDeadlineToggles(cardsContainer) {
        cardsContainer.addEventListener('click', event => {
            const toggle = event.target.closest('.js-toggle-deadlines');
            if (!toggle) return;

            const foot = toggle.closest('.cd-card-foot');
            const list = foot ? CD.QS('.cd-deadline-list', foot) : null;
            if (!list) return;

            const expanded = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', String(!expanded));
            list.hidden = expanded;

            const count = list.children.length;
            toggle.innerHTML = expanded
                ? `All ${count} <i class="bi bi-chevron-down" aria-hidden="true"></i>`
                : 'Hide <i class="bi bi-chevron-down" aria-hidden="true"></i>';
        });
    }

    function formatCountdown(ms) {
        const sec = Math.floor(ms / 1000);
        const days = Math.floor(sec / 86400);
        const hours = Math.floor((sec % 86400) / 3600);
        const minutes = Math.floor((sec % 3600) / 60);
        const seconds = sec % 60;
        const pad = value => String(value).padStart(2, '0');
        const hhmmss = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
        return days > 0 ? `${days}d ${hhmmss}` : hhmmss;
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
                el.classList.remove('is-urgent');
                needsRerender = true;
            } else {
                el.textContent = formatCountdown(diff);
                el.classList.toggle('is-urgent', diff <= 24 * 3600 * 1000);
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
        bindDeadlineToggles,
        formatCountdown,
        startCountdownTimer,
        stopCountdownTimer
    };
})(window);
