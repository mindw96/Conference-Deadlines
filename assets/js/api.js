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

    async function selectConferencesWithDeadlines() {
        return getClient()
            .from('conferences')
            .select(`
                id, name, conf_start_date, conf_end_date, location, site_url, areas, tags, note, timezone,
                deadlines (
                    deadline_type,
                    due_date
                )
            `);
    }

    async function insertConferenceSuggestion(suggestion) {
        return getClient()
            .from('conference_suggestions')
            .insert([suggestion]);
    }

    CD.api = {
        config,
        getClient,
        selectConferencesWithDeadlines,
        insertConferenceSuggestion
    };
})(window);
