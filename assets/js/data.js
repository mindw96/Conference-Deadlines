(function (window) {
    const CD = window.ConferenceDeadlines = window.ConferenceDeadlines || {};

    function normalizeDeadlines(rawDeadlines) {
        if (Array.isArray(rawDeadlines)) {
            return rawDeadlines
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
        const areas = (typeof raw.areas === 'object' && raw.areas !== null) ? raw.areas : {};
        const dates = raw.dates || {
            conf_start: raw.conf_start_date,
            conf_end: raw.conf_end_date
        };
        const deadlines = normalizeDeadlines(raw.deadlines);
        const now = new Date();

        let nextDue = null;
        let status = deadlines.length === 0 ? 'coming_soon' : 'closed';

        for (const deadline of deadlines) {
            if (deadline.due > now) {
                nextDue = deadline.due;
                status = 'upcoming';
                break;
            }
        }

        if (nextDue && CD.calcDiffDays(nextDue) <= 7) {
            status = 'soon';
        }

        return {
            ...raw,
            areas,
            dates,
            site: raw.site || raw.site_url,
            tags: Array.isArray(raw.tags) ? raw.tags : [],
            deadlines,
            nextDue,
            status
        };
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
        try {
            return await loadFromSupabase();
        } catch (error) {
            console.warn('Supabase load failed; falling back to conferences.json.', error);
            return loadFromJson();
        }
    }

    CD.data = {
        normalizeDeadlines,
        normalizeItem,
        loadFromSupabase,
        loadFromJson,
        loadData
    };
})(window);
