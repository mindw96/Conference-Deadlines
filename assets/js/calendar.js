(function (window) {
    const CD = window.ConferenceDeadlines = window.ConferenceDeadlines || {};

    function createConferenceEvent(item) {
        return {
            id: `${item.id}-conference`,
            title: item.name,
            start: item.dates?.conf_start,
            end: item.dates?.conf_end,
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
        const title = encodeURIComponent(eventDetails.title || '');
        const startTime = CD.toUTCDateTimeStamp(eventDetails.start);
        const endTime = CD.toUTCDateTimeStamp(eventDetails.end || eventDetails.start);
        const location = encodeURIComponent(eventDetails.location || '');
        const details = encodeURIComponent(eventDetails.description || '');

        if (!startTime || !endTime) return '#';

        if (type === 'google') {
            return `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startTime}/${endTime}&location=${location}&details=${details}`;
        }

        if (type === 'outlook') {
            return `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${title}&startdt=${startTime}&enddt=${endTime}&location=${location}&body=${details}`;
        }

        return '#';
    }

    function generateICSContent(eventDetails) {
        const startDate = CD.toUTCDateTimeStamp(eventDetails.start);
        const endDate = CD.toUTCDateTimeStamp(eventDetails.end || eventDetails.start);

        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Conference Deadlines//alldeadlines.info//EN',
            'BEGIN:VEVENT',
            `UID:${CD.escapeICSText(eventDetails.id)}@alldeadlines.info`,
            `DTSTAMP:${CD.toUTCDateTimeStamp(new Date())}`,
            `DTSTART:${startDate}`,
            `DTEND:${endDate}`,
            `SUMMARY:${CD.escapeICSText(eventDetails.title)}`,
            `DESCRIPTION:${CD.escapeICSText(eventDetails.description)}`,
            `LOCATION:${CD.escapeICSText(eventDetails.location)}`,
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');
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
