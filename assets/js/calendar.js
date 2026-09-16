(function (window) {
    const CD = window.ConferenceDeadlines = window.ConferenceDeadlines || {};

    function createConferenceEvent(item) {
        const start = item.dates?.conf_start;
        const last = item.dates?.conf_end || start;
        if (!CD.validDateOnly(start) || !CD.validDateOnly(last) || last < start) return null;
        const exclusiveEnd = new Date(last + 'T00:00:00Z');
        exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
        return {
            allDay: true,
            id: `${item.id}-conference`,
            title: item.name,
            start,
            end: exclusiveEnd.toISOString().slice(0, 10),
            location: item.location || '',
            description: `Conference Website: ${item.site || 'N/A'}`
        };
    }

    function createDeadlineEvent(item, deadline, index) {
        return {
            id: `${item.id}-deadline-${index}`,
            title: `${item.name}: ${deadline.type}`,
            start: deadline.due,
            end: deadline.due,
            location: item.location || '',
            description: `Type: ${deadline.type}`
        };
    }

    function generateCalendarLink(type, eventDetails) {
        if (!eventDetails) return '#';
        const title = encodeURIComponent(eventDetails.title || '');
        const startTime = eventStamp(eventDetails.start, eventDetails.allDay);
        const endTime = eventStamp(eventDetails.end || eventDetails.start, eventDetails.allDay);
        const location = encodeURIComponent(eventDetails.location || '');
        const details = encodeURIComponent(eventDetails.description || '');

        if (!startTime || !endTime) return '#';

        if (type === 'google') {
            return `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startTime}/${endTime}&location=${location}&details=${details}`;
        }

        if (type === 'outlook') {
            const outlookStart = encodeURIComponent(eventDetails.allDay ? eventDetails.start : new Date(eventDetails.start).toISOString());
            const outlookEnd = encodeURIComponent(eventDetails.allDay ? eventDetails.end : new Date(eventDetails.end || eventDetails.start).toISOString());
            return `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${title}&startdt=${outlookStart}&enddt=${outlookEnd}&location=${location}&body=${details}${eventDetails.allDay ? '&allday=true' : ''}`;
        }

        return '#';
    }

    function eventStamp(value, allDay) {
        return allDay ? (CD.validDateOnly(value) ? value.replace(/-/g, '') : '') : CD.toUTCDateTimeStamp(value);
    }

    // RFC 5545 limits content lines to 75 UTF-8 octets (continuations start with one space).
    function foldLine(line) {
        const lines = [];
        let part = '';
        const encoder = new TextEncoder();
        for (const char of line) {
            if (encoder.encode(part + char).length > 75) { lines.push(part); part = ' '; }
            part += char;
        }
        lines.push(part);
        return lines.join('\r\n');
    }

    function generateICSContent(eventDetails) {
        if (!eventDetails) throw new Error('Conference dates are unavailable.');
        const startDate = eventStamp(eventDetails.start, eventDetails.allDay);
        const endDate = eventStamp(eventDetails.end || eventDetails.start, eventDetails.allDay);
        if (!startDate || !endDate) throw new Error('Invalid calendar dates.');
        const dateType = eventDetails.allDay ? ';VALUE=DATE' : '';

        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Conference Deadlines//alldeadlines.info//EN',
            'BEGIN:VEVENT',
            `UID:${CD.escapeICSText(eventDetails.id)}@alldeadlines.info`,
            `DTSTAMP:${CD.toUTCDateTimeStamp(new Date())}`,
            `DTSTART${dateType}:${startDate}`,
            `DTEND${dateType}:${endDate}`,
            `SUMMARY:${CD.escapeICSText(eventDetails.title)}`,
            `DESCRIPTION:${CD.escapeICSText(eventDetails.description)}`,
            `LOCATION:${CD.escapeICSText(eventDetails.location)}`,
            'END:VEVENT',
            'END:VCALENDAR'
        ].map(foldLine).join('\r\n') + '\r\n';
    }

    function downloadICSFile(eventDetails) {
        const icsContent = generateICSContent(eventDetails);
        const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        const safeFileName = String(eventDetails.title || 'conference-event')
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase();
        link.setAttribute('download', `${safeFileName}.ics`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function bindICSDownloads(cardsContainer, state) {
        cardsContainer.addEventListener('click', event => {
            const link = event.target.closest('.ics-download-link');
            if (!link) return;

            event.preventDefault();

            const confId = link.getAttribute('data-conf-id');
            const eventType = link.getAttribute('data-event-type');
            const item = state.items.find(conf => conf.id === confId);
            if (!item) return;

            let eventDetails = null;

            if (eventType === 'conference') {
                eventDetails = createConferenceEvent(item);
            } else if (eventType === 'deadline') {
                const deadlineIndex = parseInt(link.getAttribute('data-deadline-index'), 10);
                const deadline = item.deadlines[deadlineIndex];
                if (!deadline) return;
                eventDetails = createDeadlineEvent(item, deadline, deadlineIndex);
            }

            if (eventDetails) {
                downloadICSFile(eventDetails);
            }
        });
    }

    CD.calendar = {
        createConferenceEvent,
        createDeadlineEvent,
        generateCalendarLink,
        generateICSContent,
        downloadICSFile,
        bindICSDownloads
    };
})(window);
