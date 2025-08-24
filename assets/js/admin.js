(function () {
    const QS = s => document.querySelector(s);

    // --- SUPABASE SETUP ---
    const SUPABASE_URL = 'https://tavlqhidtjxgwclhjkje.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhdmxxaGlkdGp4Z3djbGhqa2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwMTAwODIsImV4cCI6MjA3MTU4NjA4Mn0.8iIDnSyPPhcLm10VBfHQM3SkXvxpEJRxxtMqct-goyw';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // --- UI ELEMENTS ---
    const loginView = QS('#login-view');
    const adminView = QS('#admin-view');
    const authControls = QS('#auth-controls');
    const userEmailSpan = QS('#user-email');
    const suggestionsList = QS('#suggestions-list');
    const noSuggestionsDiv = QS('#no-suggestions');
    let toastInstance = null; // To hold the Bootstrap Toast instance


    // --- AUTH FUNCTIONS ---
    async function handleLogin(event) {
        event.preventDefault();
        const form = event.target; // event.target은 submit 이벤트가 발생한 form 요소를 가리킵니다.
        const email = form.elements.email.value; // form 안에서 id가 'email'인 요소의 값을 찾습니다.
        const password = form.elements.password.value; // form 안에서 id가 'password'인 요소의 값을 찾습니다.


        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            // Show error in a toast notification
            if (toastInstance) {
                const toastBody = QS('#errorToast .toast-body');
                toastBody.textContent = error.message;
                toastInstance.show();
            }
        } else {
            checkUserSession();
        }
    }

    async function handleLogout() {
        await supabase.auth.signOut();
        checkUserSession();
    }

    // --- DATA FUNCTIONS ---
    async function fetchSuggestions() {
        const { data, error } = await supabase
            .from('conference_suggestions')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching suggestions:', error);
            suggestionsList.innerHTML = `<div class="alert alert-danger">Failed to load suggestions.</div>`;
            return;
        }

        renderSuggestions(data);
    }

    function renderSuggestions(suggestions) {
        if (suggestions.length === 0) {
            noSuggestionsDiv.classList.remove('d-none');
            suggestionsList.innerHTML = '';
            return;
        }

        noSuggestionsDiv.classList.add('d-none');
        suggestionsList.innerHTML = suggestions.map(s => `
            <div class="card" data-id="${s.id}">
                <div class="card-body">
                    <h5 class="card-title">${s.name}</h5>
                    <p class="card-text mb-1"><strong>URL:</strong> <a href="${s.site_url}" target="_blank" rel="noopener">${s.site_url}</a></p>
                    <p class="card-text mb-1"><strong>Location:</strong> ${s.location || 'N/A'}</p>
                    <p class="card-text mb-1"><strong>Dates:</strong> ${s.conf_start_date || 'N/A'} to ${s.conf_end_date || 'N/A'}</p>
                    <p class="card-text mb-1"><strong>Deadline:</strong> ${s.deadline_date ? new Date(s.deadline_date).toLocaleString() : 'N/A'}</p>
                    <div class="mt-3">
                        <button class="btn btn-success btn-sm approve-btn">Approve</button>
                        <button class="btn btn-danger btn-sm reject-btn">Reject</button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async function handleSuggestionAction(event) {
        const button = event.target;
        if (!button.matches('.approve-btn, .reject-btn')) return;

        const card = button.closest('.card');
        const suggestionId = card.dataset.id;
        button.disabled = true;

        if (button.matches('.reject-btn')) {
            const { error } = await supabase.from('conference_suggestions').delete().eq('id', suggestionId);
            if (error) {
                alert(`Error rejecting suggestion: ${error.message}`);
                button.disabled = false;
            } else {
                card.remove();
            }
        } else if (button.matches('.approve-btn')) {
            // 1. Get the full suggestion data
            const { data: suggestionData, error: fetchError } = await supabase
                .from('conference_suggestions').select('*').eq('id', suggestionId).single();

            if (fetchError) {
                alert(`Could not fetch suggestion details: ${fetchError.message}`);
                button.disabled = false;
                return;
            }

            // 2. Prepare data for the main 'conferences' table
            const newConference = {
                id: suggestionData.name.toLowerCase().replace(/\s+/g, '-') + '-' + new Date(suggestionData.conf_start_date).getFullYear(),
                name: suggestionData.name,
                conf_start_date: suggestionData.conf_start_date,
                conf_end_date: suggestionData.conf_end_date,
                location: suggestionData.location,
                site_url: suggestionData.site_url,
                // For simplicity, we leave areas and tags empty for the admin to fill later if needed
                areas: {},
                tags: [],
            };

            // 3. Insert into 'conferences' table
            const { error: confError } = await supabase.from('conferences').insert([newConference]);
            if (confError) {
                alert(`Error inserting into conferences: ${confError.message}`);
                button.disabled = false;
                return;
            }

            // 4. Insert into 'deadlines' table if a deadline exists
            if (suggestionData.deadline_date) {
                const newDeadline = {
                    conference_id: newConference.id,
                    deadline_type: 'Deadline',
                    due_date: suggestionData.deadline_date,
                };
                const { error: deadlineError } = await supabase.from('deadlines').insert([newDeadline]);
                if (deadlineError) {
                    alert(`Conference was added, but deadline failed: ${deadlineError.message}`);
                    // Don't re-enable button, as part of the action succeeded.
                }
            }

            // 5. Delete the original suggestion
            await supabase.from('conference_suggestions').delete().eq('id', suggestionId);
            card.remove();
        }
    }

    // --- INITIALIZATION ---
    async function checkUserSession() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            loginView.classList.add('d-none');
            adminView.classList.remove('d-none');
            authControls.classList.remove('d-none');
            userEmailSpan.textContent = session.user.email;
            fetchSuggestions();
        } else {
            loginView.classList.remove('d-none');
            adminView.classList.add('d-none');
            authControls.classList.add('d-none');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        QS('#login-form').addEventListener('submit', handleLogin);
        QS('#logout-button').addEventListener('click', handleLogout);
        suggestionsList.addEventListener('click', handleSuggestionAction);

        // Initialize the toast instance
        const errorToastEl = QS('#errorToast');
        if (errorToastEl) {
            toastInstance = new bootstrap.Toast(errorToastEl);
        }

        checkUserSession();
    });
})();
