(function (window) {
    const CD = window.ConferenceDeadlines = window.ConferenceDeadlines || {};

    const AOE_TIME_ZONE = 'Etc/GMT+12';
    const AOE_UTC_OFFSET = '-12:00';
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const HTML_ESCAPE = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    function QS(selector, root = document) {
        return root.querySelector(selector);
    }

    function QSA(selector, root = document) {
        return [...root.querySelectorAll(selector)];
    }

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPE[char]);
    }

    function escapeAttr(value) {
        return escapeHTML(value);
    }

    function safeURL(value) {
        if (!value) return '#';

        try {
            const url = new URL(String(value), window.location.href);
            if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
                return url.href;
            }
        } catch (error) {
            return '#';
        }

        return '#';
    }

    function escapeICSText(value) {
        return String(value ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\r\n|\r|\n/g, '\\n');
    }


    const aoeFormatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: AOE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const shortFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: AOE_TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const asDate = value => value instanceof Date ? value : typeof value === 'string' ? new Date(value) : new Date(NaN);

    function localDateKey(date = new Date()) {
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function calcDiffDays(targetDate, now = new Date()) {
        const day = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
        return Math.round((day(asDate(targetDate)) - day(now)) / 86400000);
    }

    function formatDateAOE(date) {
        if (!date) return 'N/A';
        const dateObj = asDate(date);
        if (Number.isNaN(dateObj.getTime())) return 'N/A';

        return aoeFormatter.format(dateObj) + ' (AOE)';
    }

    // "Aug 19, 2026 · 11:59" — the card's compact AOE stamp. The page header
    // states the timezone once, so the stamp itself stays unsuffixed.
    function formatDateAOEShort(date) {
        if (!date) return 'N/A';
        const dateObj = asDate(date);
        if (Number.isNaN(dateObj.getTime())) return 'N/A';

        const parts = shortFormatter.formatToParts(dateObj).reduce((acc, part) => {
            acc[part.type] = part.value;
            return acc;
        }, {});

        return `${parts.month} ${parts.day}, ${parts.year} · ${parts.hour}:${parts.minute}`;
    }

    // "Apr 13–17, 2027" — collapses the month when both ends share it.
    function formatConfRange(start, end) {
        const toUTCDate = value => {
            if (!value) return null;
            const dateObj = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
            return Number.isNaN(dateObj.getTime()) ? null : dateObj;
        };

        const startDate = toUTCDate(start);
        if (!startDate) return '';

        const endDate = toUTCDate(end);
        const head = `${MONTHS[startDate.getUTCMonth()]} ${startDate.getUTCDate()}`;
        if (!endDate) return `${head}, ${startDate.getUTCFullYear()}`;

        if (startDate.getUTCFullYear() !== endDate.getUTCFullYear()) {
            return head + ', ' + startDate.getUTCFullYear() + '–' + MONTHS[endDate.getUTCMonth()] + ' ' + endDate.getUTCDate() + ', ' + endDate.getUTCFullYear();
        }
        const tail = startDate.getUTCMonth() === endDate.getUTCMonth()
            ? String(endDate.getUTCDate())
            : `${MONTHS[endDate.getUTCMonth()]} ${endDate.getUTCDate()}`;

        return `${head}–${tail}, ${endDate.getUTCFullYear()}`;
    }

    function formatForDateTimeLocalInput(date) {
        if (!date) return '';
        const dateObj = asDate(date);
        if (Number.isNaN(dateObj.getTime())) return '';

        const formatted = aoeFormatter.format(dateObj);

        return formatted.replace(' ', 'T');
    }

    function fromAoeDateTimeLocalToIso(value) {
        if (!value) return null;
        const normalized = value.length === 16 ? `${value}:00` : value;
        const date = new Date(`${normalized}${AOE_UTC_OFFSET}`);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    function toUTCDateTimeStamp(value) {
        if (!value) return '';
        const date = asDate(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toISOString().replace(/-|:|\.\d+/g, '');
    }


    function validDateOnly(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(value + 'T00:00:00Z');
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }

    function isAreasObject(areas) {
        return !!areas && typeof areas === 'object' && !Array.isArray(areas)
            && Object.values(areas).every(fields => Array.isArray(fields) && fields.every(field => typeof field === 'string'));
    }

    function validAreas(areas) {
        return isAreasObject(areas) && Object.keys(areas).length <= 32 && Object.entries(areas).every(([key, fields]) =>
                key.trim().length > 0 && key.length <= 100 && Array.isArray(fields) && fields.length <= 64
                && fields.every(field => typeof field === 'string' && field.trim().length > 0 && field.length <= 100));
    }

    function validDeadlines(deadlines) {
        return Array.isArray(deadlines) && deadlines.length <= 64 && deadlines.every(d =>
            d && typeof d === 'object' && typeof d.type === 'string' && d.type.trim().length > 0 && d.type.length <= 100
            && typeof d.due === 'string' && d.due.length <= 40
            && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(d.due)
            && validDateOnly(d.due.slice(0, 10)) && Number.isFinite(Date.parse(d.due)));
    }

    function validateConference(p) {
        if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 300) return 'A conference name of at most 300 characters is required.';
        if (typeof p.site_url !== 'string' || p.site_url.length > 2000 || !/^https?:\/\/\S+$/i.test(p.site_url) || safeURL(p.site_url) === '#') return 'A valid HTTP(S) website URL is required.';
        if (p.location != null && (typeof p.location !== 'string' || p.location.length > 300)) return 'Location must be at most 300 characters.';
        if (!validAreas(p.areas)) return 'Use at most 32 categories and 64 subfields per category, each at most 100 characters.';
        for (const key of ['conf_start_date', 'conf_end_date']) {
            if (p[key] != null && !validDateOnly(p[key])) return 'Use valid conference dates.';
        }
        if (p.conf_start_date && p.conf_end_date && p.conf_end_date < p.conf_start_date) return 'End date cannot be before start date.';
        return '';
    }

    function suggestionAreas(suggestion, base = {}) {
        if (suggestion.areas != null) return suggestion.areas;
        const entries = Object.entries(base || {});
        if (typeof suggestion.category === 'string' && suggestion.category.trim()) {
            const category = suggestion.category.trim();
            return Object.fromEntries([...entries.filter(([key]) => key !== category),
                [category, String(suggestion.subfields || '').split(',').map(s => s.trim()).filter(Boolean)]]);
        }
        return Object.fromEntries(entries);
    }

    function validateSuggestion(suggestion) {
        if (!suggestion || typeof suggestion.is_edit !== 'boolean') return 'Invalid suggestion type.';
        if (!validDeadlines(suggestion.deadlines)) return 'Invalid deadlines. Reject this suggestion and request a corrected submission.';
        if (suggestion.is_edit && !suggestion.target_conference_id) return 'The target conference no longer exists.';
        return validateConference({ ...suggestion, areas: suggestionAreas(suggestion) });
    }

    function addAreaInput(container, category = '', subfields = []) {
        const div = document.createElement('div');
        div.className = 'input-group mb-2 area-group';
        div.innerHTML = '<input class="form-control area-category" aria-label="Category" maxlength="100" placeholder="Category (e.g., AI)" value="' + escapeAttr(category) + '">'
            + '<input class="form-control area-subfields" aria-label="Subfields" placeholder="Subfields (comma separated)" value="' + escapeAttr(subfields.join(', ')) + '" data-original-subfields="' + escapeAttr(JSON.stringify(subfields)) + '">'
            + '<button class="btn btn-outline-danger remove-area-btn" type="button" aria-label="Remove category">&times;</button>';
        container.appendChild(div);
    }

    function collectAreas(container) {
        const entries = QSA('.area-group', container).map(group => {
            const categoryInput = QS('.area-category', group);
            // Text inputs strip line breaks; compare against that displayed form before preserving the original.
            const category = categoryInput.value === categoryInput.defaultValue.replace(/[\r\n]/g, '')
                ? categoryInput.defaultValue : categoryInput.value.trim();
            const input = QS('.area-subfields', group);
            // Preserve commas inside existing subfield names when only other fields change.
            const fields = input.value === input.defaultValue.replace(/[\r\n]/g, '')
                ? JSON.parse(input.dataset.originalSubfields)
                : input.value.split(',').map(s => s.trim()).filter(Boolean);
            if (!category && fields.length) throw new Error('Enter a category for each group of subfields.');
            return [category, fields];
        }).filter(([category]) => category);
        if (new Set(entries.map(([category]) => category)).size !== entries.length) throw new Error('Combine duplicate categories into one row.');
        const areas = Object.fromEntries(entries);
        if (!validAreas(areas)) throw new Error('Category or subfield limits exceeded.');
        return areas;
    }

    function collectDeadlines(container, typeSelector, dueSelector) {
        const deadlines = QSA('.input-group', container).map(group => {
            const type = QS(typeSelector, group)?.value.trim() || '';
            const input = QS(dueSelector, group);
            const due = input?.value || '';
            if (!type && !due) return null;
            // The minute-resolution form must not round an unchanged timestamp.
            const iso = due && due === input.defaultValue && input.dataset.originalDue
                ? input.dataset.originalDue : fromAoeDateTimeLocalToIso(due);
            if (!type || !iso) throw new Error('Enter both a type and a valid date for every deadline, or remove the row.');
            return { type, due: iso };
        }).filter(Boolean);
        if (!validDeadlines(deadlines)) throw new Error('Use at most 64 deadlines with types of at most 100 characters.');
        return deadlines;
    }

    function createErrorHTML(message) {
        return `<div class="alert alert-danger">${escapeHTML(message)}</div>`;
    }

    Object.assign(CD, {
        localDateKey, validDateOnly, isAreasObject, validAreas, validDeadlines, validateConference, suggestionAreas,
        validateSuggestion, addAreaInput, collectAreas, collectDeadlines,
        AOE_TIME_ZONE,
        AOE_UTC_OFFSET,
        QS,
        QSA,
        escapeHTML,
        escapeAttr,
        safeURL,
        escapeICSText,
        calcDiffDays,
        formatDateAOE,
        formatDateAOEShort,
        formatConfRange,
        formatForDateTimeLocalInput,
        fromAoeDateTimeLocalToIso,
        toUTCDateTimeStamp,
        createErrorHTML
    });
})(window);
