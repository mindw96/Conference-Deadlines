(function (window) {
    const CD = window.ConferenceDeadlines = window.ConferenceDeadlines || {};

    const config = {
        supabaseUrl: 'https://tavlqhidtjxgwclhjkje.supabase.co',
        supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhdmxxaGlkdGp4Z3djbGhqa2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwMTAwODIsImV4cCI6MjA3MTU4NjA4Mn0.8iIDnSyPPhcLm10VBfHQM3SkXvxpEJRxxtMqct-goyw'
    };

    function getClient() {
        if (!window.supabase) {
            throw new Error('Supabase client library is not loaded.');
        }

        if (!CD.supabaseClient) {
            CD.supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        }

        return CD.supabaseClient;
    }

    // Keyset pagination also works when a project's API cap is below our requested page size.
    async function selectAll(table, columns = '*') {
        const rows = [];
        let lastId = null;
        for (;;) {
            let query = getClient().from(table).select(columns).order('id', { ascending: true }).limit(500);
            if (lastId !== null) query = query.gt('id', lastId);
            const { data, error } = await query;
            if (error) return { data: null, error };
            if (!data?.length) return { data: rows, error: null };
            const nextId = data[data.length - 1].id;
            if (nextId == null || nextId === lastId) throw new Error('Invalid pagination response.');
            rows.push(...data);
            lastId = nextId;
        }
    }

    async function selectConferencesWithDeadlines() {
        return selectAll('conferences', '*, deadlines(deadline_type, due_date)');
    }

    async function insertConferenceSuggestion(suggestion) {
        const payload = { is_edit: false, ...suggestion };
        const problem = CD.validateSuggestion(payload);
        if (problem) throw new Error(problem);
        return getClient()
            .from('conference_suggestions')
            .insert([payload]);
    }

    CD.api = {
        selectAll,
        config,
        getClient,
        selectConferencesWithDeadlines,
        insertConferenceSuggestion
    };
})(window);
