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
    const conferenceListDiv = QS('#conference-list');
    const noConferencesDiv = QS('#no-conferences');
    const editModalEl = QS('#editModal');
    const editModal = new bootstrap.Modal(editModalEl); // 모달 인스턴스 생성

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

    async function fetchConferences() {
        const { data, error } = await supabase
            .from('conferences')
            .select('*')
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching conferences:', error);
            conferenceListDiv.innerHTML = `<div class="alert alert-danger">Failed to load conferences.</div>`;
            return;
        }
        renderConferences(data);
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

    function renderConferences(conferences) {
        if (conferences.length === 0) {
            noConferencesDiv.classList.remove('d-none');
            conferenceListDiv.innerHTML = '';
            return;
        }

        noConferencesDiv.classList.add('d-none');
        conferenceListDiv.innerHTML = conferences.map(conf => `
        <div class="card" data-id="${conf.id}">
            <div class="card-body">
                <div class="d-flex justify-content-between">
                    <div>
                        <h5 class="card-title mb-1">${conf.name}</h5>
                        <p class="card-text text-muted small">${conf.location || 'Location not set'}</p>
                    </div>
                    <div class="d-flex gap-2 align-items-start">
                        <button class="btn btn-outline-primary btn-sm edit-btn">Edit</button>
                        <button class="btn btn-outline-danger btn-sm delete-btn">Delete</button>
                    </div>
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
            fetchConferences();
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

        conferenceListDiv.addEventListener('click', (event) => {
            const target = event.target;
            const card = target.closest('.card');
            if (!card) return;

            const confId = card.dataset.id;

            if (target.classList.contains('delete-btn')) {
                handleDelete(confId, card);
            } else if (target.classList.contains('edit-btn')) {
                handleEdit(confId);
            }
        });

        QS('#editForm').addEventListener('submit', handleUpdate);

        async function handleDelete(id, cardElement) {
            if (confirm(`Are you sure you want to delete the conference "${id}"? This action cannot be undone.`)) {
                const { error } = await supabase.from('conferences').delete().eq('id', id);
                if (error) {
                    alert(`Error deleting conference: ${error.message}`);
                } else {
                    cardElement.remove();
                    alert('Conference deleted successfully.');
                }
            }
        }

        async function handleEdit(id) {
            // 특정 학회 정보 가져오기
            const { data, error } = await supabase.from('conferences').select('*').eq('id', id).single();

            if (error) {
                alert(`Could not fetch conference details: ${error.message}`);
                return;
            }

            // 모달 폼에 데이터 채우기
            QS('#editConfId').value = data.id;
            QS('#editConfName').value = data.name;
            QS('#editConfUrl').value = data.site_url;
            QS('#editConfLocation').value = data.location;
            QS('#editConfStartDate').value = data.conf_start_date;
            QS('#editConfEndDate').value = data.conf_end_date;

            // 모달 띄우기
            editModal.show();
        }

        async function handleUpdate(event) {
            event.preventDefault();
            const id = QS('#editConfId').value;

            // 폼에서 수정된 데이터 가져오기
            const updatedData = {
                name: QS('#editConfName').value,
                site_url: QS('#editConfUrl').value,
                location: QS('#editConfLocation').value,
                conf_start_date: QS('#editConfStartDate').value || null,
                conf_end_date: QS('#editConfEndDate').value || null,
            };

            // Supabase에 업데이트 요청
            const { error } = await supabase.from('conferences').update(updatedData).eq('id', id);

            if (error) {
                alert(`Error updating conference: ${error.message}`);
            } else {
                alert('Conference updated successfully!');
                editModal.hide();
                fetchConferences(); // 목록 새로고침
            }
        }
    });
})();
