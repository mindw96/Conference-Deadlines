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
            .replace(/\r?\n/g, '\\n');
    }

    function toLocalMidnight(date) {
        const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const localStr = date.toLocaleString('en-US', { timeZone: userTZ });
        const local = new Date(localStr);
        return new Date(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, 0);
    }

    function calcDiffDays(targetDate) {
        const now = new Date();
        const todayMidnight = toLocalMidnight(now);
        const targetMidnight = toLocalMidnight(targetDate);
        return Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
    }

    function formatDateAOE(date) {
        if (!date) return 'N/A';
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        if (Number.isNaN(dateObj.getTime())) return 'N/A';

        return new Intl.DateTimeFormat('sv-SE', {
            timeZone: AOE_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(dateObj) + ' (AOE)';
    }

    // "Aug 19, 2026 · 11:59" — the card's compact AOE stamp. The page header
    // states the timezone once, so the stamp itself stays unsuffixed.
    function formatDateAOEShort(date) {
        if (!date) return 'N/A';
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        if (Number.isNaN(dateObj.getTime())) return 'N/A';

        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: AOE_TIME_ZONE,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(dateObj).reduce((acc, part) => {
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

        const tail = startDate.getUTCMonth() === endDate.getUTCMonth()
            ? String(endDate.getUTCDate())
            : `${MONTHS[endDate.getUTCMonth()]} ${endDate.getUTCDate()}`;

        return `${head}–${tail}, ${endDate.getUTCFullYear()}`;
    }

    function formatForDateTimeLocalInput(date) {
        if (!date) return '';
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        if (Number.isNaN(dateObj.getTime())) return '';

        const formatted = new Intl.DateTimeFormat('sv-SE', {
            timeZone: AOE_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).format(dateObj);

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
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toISOString().replace(/-|:|\.\d+/g, '');
    }

    function createErrorHTML(message) {
        return `<div class="alert alert-danger">${escapeHTML(message)}</div>`;
    }

    Object.assign(CD, {
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
