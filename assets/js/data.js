(function (window) {
    const CD = window.ConferenceDeadlines = window.ConferenceDeadlines || {};

    function normalizeDeadlines(rawDeadlines) {
        if (Array.isArray(rawDeadlines)) {
            return rawDeadlines
                .filter(deadline => deadline && typeof deadline === 'object')
                .map(deadline => ({
                    type: deadline.type || deadline.deadline_type || 'Deadline',
                    due: deadline.due || deadline.due_date
                }))
                .filter(deadline => deadline.due && !Number.isNaN(Date.parse(deadline.due)))
                .map(deadline => ({
                    type: deadline.type,
                    due: new Date(deadline.due)
                }))
                .sort((a, b) => a.due - b.due);
        }

        if (typeof rawDeadlines === 'string' && rawDeadlines.trim()) {
            return normalizeDeadlines([{ type: 'Deadline', due: rawDeadlines }]);
        }

        return [];
    }

    function normalizeItem(raw) {
        const areas = CD.isAreasObject(raw.areas) ? raw.areas : {};
        const dates = raw.dates || {
            conf_start: raw.conf_start_date,
            conf_end: raw.conf_end_date
        };
        const deadlines = normalizeDeadlines(raw.deadlines);
        const item = {
            ...raw,
            areas,
            malformedAreas: raw.areas != null && !CD.isAreasObject(raw.areas),
            dates,
            site: raw.site || raw.site_url,
            tags: Array.isArray(raw.tags) ? raw.tags : [],
            deadlines,
            subfields: Object.values(areas).flat(),
            searchText: [raw.name, raw.location, ...(Array.isArray(raw.tags) ? raw.tags : []), ...Object.keys(areas), ...Object.values(areas).flat()].join(' ').toLowerCase()
        };
        refreshTimeState(item);
        return item;
    }

    function refreshTimeState(item, now = new Date()) {
        item.nextDue = item.deadlines.find(deadline => deadline.due > now)?.due || null;
        item.status = item.nextDue ? (CD.calcDiffDays(item.nextDue, now) <= 7 ? 'soon' : 'upcoming')
            : item.deadlines.length ? 'closed' : 'coming_soon';
    }

    function transformSupabaseConference(conf) {
        return normalizeItem({
            ...conf,
            site: conf.site_url,
            dates: {
                conf_start: conf.conf_start_date,
                conf_end: conf.conf_end_date
            },
            deadlines: conf.deadlines || []
        });
    }

    async function loadFromSupabase() {
        const { data, error } = await CD.api.selectConferencesWithDeadlines();

        if (error) {
            throw error;
        }

        return (data || []).map(transformSupabaseConference);
    }

    async function loadFromJson() {
        const response = await fetch('conferences.json', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to load conferences.json (${response.status})`);
        }

        const data = await response.json();
        return data.map(normalizeItem);
    }

    async function loadData() {
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
        const demo = local && new URL(window.location.href).searchParams.get('demo') === '1';
        if (demo) return { items: await loadFromJson(), source: 'demo' };
        return { items: await loadFromSupabase(), source: 'live' };
    }

    CD.data = {
        refreshTimeState,
        normalizeDeadlines,
        normalizeItem,
        loadFromSupabase,
        loadFromJson,
        loadData
    };
})(window);
