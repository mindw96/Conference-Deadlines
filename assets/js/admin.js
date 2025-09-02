(function () {
    const QS = s => document.querySelector(s);

    function formatDateAOE(date) {
        if (!date) return 'N/A';
        // Date 객체가 아닐 경우 변환
        const dateObj = typeof date === 'string' ? new Date(date) : date;

        return new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Etc/GMT+12', // AOE timezone
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).format(dateObj) + " (AOE)";
    }

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
    const editModal = new bootstrap.Modal(editModalEl);
    const deadlinesContainer = QS('#editDeadlinesContainer');
    const areasContainer = QS('#editAreasContainer');
    let toastInstance = null;

    // --- HELPER FUNCTIONS for Edit Modal ---

    function addAreaInput(category = '', subfields = '') {
        const div = document.createElement('div');
        div.className = 'input-group mb-2 area-group';
        div.innerHTML = `
            <input type="text" class="form-control area-category" placeholder="Category (e.g., AI)" value="${category}">
            <input type="text" class="form-control area-subfields" placeholder="Subfields (comma separated)" value="${subfields}">
            <button class="btn btn-outline-danger remove-area-btn" type="button">&times;</button>
        `;
        areasContainer.appendChild(div);
    }

    function addDeadlineInput(type = '', date = '') {
        const div = document.createElement('div');
        div.className = 'input-group mb-2 deadline-group';
        const formattedDate = date ? new Date(date).toISOString().slice(0, 16) : '';
        div.innerHTML = `
            <input type="text" class="form-control deadline-type" placeholder="Deadline Type" value="${type}">
            <input type="datetime-local" class="form-control deadline-date" value="${formattedDate}">
            <button class="btn btn-outline-danger remove-deadline-btn" type="button">&times;</button>
        `;
        deadlinesContainer.appendChild(div);
    }

    // --- AUTH FUNCTIONS ---
    async function handleLogin(event) {
        event.preventDefault();
        const form = event.target;
        const email = form.elements.email.value;
        const password = form.elements.password.value;
        const { error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            if (toastInstance) {
                const toastBody = QS('#errorToast .toast-body');
                toastBody.textContent = error.message;
                toastInstance.show();
            } else {
                alert(error.message);
            }
        } else {
            checkUserSession();
        }
    }

    async function handleLogout() {
        await supabase.auth.signOut();
        checkUserSession();
    }

    async function fetchConferences() {
        const { data, error } = await supabase.from('conferences').select('*').order('name', { ascending: true });
        if (error) {
            console.error('Error fetching conferences:', error);
            conferenceListDiv.innerHTML = `<div class="alert alert-danger">Failed to load conferences.</div>`;
            return;
        }
        renderConferences(data);
    }

    /**
 * Compares two conference objects and returns an array of changes.
 * @param {object} original - The original conference data.
 * @param {object} suggestion - The suggested conference data.
 * @returns {string[]} An array of strings describing the changes.
 */
    function compareConferenceData(original, suggestion) {
        const changes = [];
        const fieldsToCompare = ['name', 'site_url', 'location', 'conf_start_date', 'conf_end_date'];

        // 1. Compare simple text fields
        fieldsToCompare.forEach(field => {
            // Treat null and empty strings as the same to avoid unnecessary diffs
            const originalValue = original[field] || '';
            const suggestionValue = suggestion[field] || '';

            if (originalValue !== suggestionValue) {
                changes.push(`<b>${field}:</b> "${originalValue}" → "${suggestionValue}"`);
            }
        });

        // 2. Compare 'areas' by creating a comparable string
        const originalAreas = original.areas ? JSON.stringify(original.areas) : '{}';

        const suggestionAreas = {};
        if (suggestion.category) {
            suggestionAreas[suggestion.category] = suggestion.subfields
                ? suggestion.subfields.split(',').map(s => s.trim())
                : [];
        }
        const suggestionAreasString = JSON.stringify(suggestionAreas);

        if (originalAreas !== suggestionAreasString) {
            changes.push(`<b>Areas:</b> Have been updated.`);
        }

        // 3. Compare 'deadlines' by creating a comparable string
        const originalDeadlines = original.deadlines ? JSON.stringify(original.deadlines.map(d => ({ type: d.deadline_type, due: d.due_date })).sort()) : '[]';
        const suggestionDeadlines = suggestion.deadlines ? JSON.stringify(suggestion.deadlines.sort()) : '[]';

        if (originalDeadlines !== suggestionDeadlines) {
            changes.push(`<b>Deadlines:</b> List has been updated.`);
        }

        return changes;
    }

    function renderSuggestions(suggestions, allConferences) {
        if (suggestions.length === 0) {
            noSuggestionsDiv.classList.remove('d-none');
            suggestionsList.innerHTML = '';
            return;
        }

        const conferenceMap = new Map(allConferences.map(conf => [conf.id, conf]));

        noSuggestionsDiv.classList.add('d-none');
        suggestionsList.innerHTML = suggestions.map(s => {
            const isEdit = s.is_edit;
            const editBadge = isEdit ? `<span class="badge bg-info">Edit Suggestion</span>` : '';
            const targetInfo = isEdit ? `<p class="card-text mb-1"><small><strong>Target:</strong> ${s.target_conference_id}</small></p>` : '';

            // Deadlines를 보기 좋게 표시
            const deadlinesText = s.deadlines
                ? s.deadlines.map(d => `${d.type}: ${formatDateAOE(d.due)}`).join('<br>')
                : formatDateAOE(s.deadline_date);

            let changesHTML = '';
            if (isEdit && s.target_conference_id) {
                const original = conferenceMap.get(s.target_conference_id);
                if (original) {
                    const changes = compareConferenceData(original, s);
                    if (changes.length > 0) {
                        changesHTML = `
                        <div class="alert alert-warning p-2 mt-2">
                            <h6 class="alert-heading small">Changes:</h6>
                            <ul class="list-unstyled mb-0 small">
                                ${changes.map(change => `<li>${change}</li>`).join('')}
                            </ul>
                        </div>
                    `;
                    }
                }
            }

            const categoryHTML = s.category ? `<p class="card-text mb-1"><strong>Category:</strong> ${s.category}</p>` : '';
            const subfieldsHTML = s.subfields ? `<p class="card-text mb-1"><strong>Subfields:</strong> ${s.subfields}</p>` : '';

            return `
                <div class="card" data-id="${s.id}">
                    <div class="card-body">
                        <h5 class="card-title d-flex justify-content-between">
                            ${s.name} ${editBadge}
                        </h5>
                        ${targetInfo}
                        <p class="card-text mb-1"><strong>URL:</strong> <a href="${s.site_url}" target="_blank" rel="noopener">${s.site_url}</a></p>
                        <p class="card-text mb-1"><strong>Location:</strong> ${s.location || 'N/A'}</p>
                        <p class="card-text mb-1"><strong>Dates:</strong> ${s.conf_start_date || 'N/A'} to ${s.conf_end_date || 'N/A'}</p>
                        ${categoryHTML}
                        ${subfieldsHTML}
                        <p class="card-text mb-1"><strong>Deadlines:</strong><br><small>${deadlinesText}</small></p>
                        ${changesHTML}
                        <div class="mt-3">
                            <button class="btn btn-success btn-sm approve-btn">Approve</button>
                            <button class="btn btn-danger btn-sm reject-btn">Reject</button>
                        </div>
                    </div>
                </div>
                `;
        }).join('');
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
            return; // Early return
        }

        if (button.matches('.approve-btn')) {
            // 1. 제안 데이터 가져오기
            const { data: suggestionData, error: fetchError } = await supabase
                .from('conference_suggestions').select('*').eq('id', suggestionId).single();

            if (fetchError) {
                alert(`Could not fetch suggestion details: ${fetchError.message}`);
                button.disabled = false;
                return;
            }

            const newAreas = {};
            if (suggestionData.category) {
                newAreas[suggestionData.category] = suggestionData.subfields
                    ? suggestionData.subfields.split(',').map(s => s.trim())
                    : [];
            }

            // 2. '수정 제안'인지 '신규 제안'인지에 따라 로직 분기
            if (suggestionData.is_edit) {
                // === UPDATE 로직 (수정 제안 승인) ===
                const targetId = suggestionData.target_conference_id;

                const updatedData = {
                    name: suggestionData.name,
                    site_url: suggestionData.site_url,
                    location: suggestionData.location,
                    conf_start_date: suggestionData.conf_start_date,
                    conf_end_date: suggestionData.conf_end_date,
                    areas: newAreas,
                };

                const { error: confError } = await supabase.from('conferences').update(updatedData).eq('id', targetId);
                if (confError) { alert(`Error updating conference: ${confError.message}`); button.disabled = false; return; }

                const { error: deleteError } = await supabase.from('deadlines').delete().eq('conference_id', targetId);
                if (deleteError) { alert(`Error clearing old deadlines: ${deleteError.message}`); button.disabled = false; return; }

                if (suggestionData.deadlines && suggestionData.deadlines.length > 0) {
                    const newDeadlines = suggestionData.deadlines.map(d => ({ conference_id: targetId, deadline_type: d.type, due_date: d.due }));
                    const { error: insertError } = await supabase.from('deadlines').insert(newDeadlines);
                    if (insertError) { alert(`Error inserting new deadlines: ${insertError.message}`); button.disabled = false; return; }
                }

            } else {
                // === INSERT 로직 (신규 제안 승인) ===
                const year = suggestionData.conf_start_date ? new Date(suggestionData.conf_start_date).getFullYear() : new Date().getFullYear();
                const newConferenceId = suggestionData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + year;

                const newConference = {
                    id: newConferenceId,
                    name: suggestionData.name,
                    conf_start_date: suggestionData.conf_start_date,
                    conf_end_date: suggestionData.conf_end_date,
                    location: suggestionData.location,
                    site_url: suggestionData.site_url,
                    areas: newAreas,
                    tags: suggestionData.tags || [],
                };

                const { error: confError } = await supabase.from('conferences').insert([newConference]);
                if (confError) {
                    alert(`Error inserting new conference: ${confError.message}`);
                    button.disabled = false;
                    return;
                }

                if (suggestionData.deadlines && suggestionData.deadlines.length > 0) {
                    const newDeadlines = suggestionData.deadlines.map(d => ({
                        conference_id: newConferenceId,
                        deadline_type: d.type,
                        due_date: d.due
                    }));
                    const { error: insertError } = await supabase.from('deadlines').insert(newDeadlines);
                    if (insertError) {
                        alert(`Conference was added, but deadline insertion failed: ${insertError.message}`);
                        // Conference was still added, so we continue to the success step.
                    }
                }
            }

            // 3. 제안 처리 완료 후 공통 로직
            await supabase.from('conference_suggestions').delete().eq('id', suggestionId);
            card.remove();
            fetchConferences(); // 목록 새로고침
            alert('Suggestion approved and applied successfully!');
            button.disabled = false;
        }
    }

    async function handleDelete(id, cardElement) {
        if (confirm(`Are you sure you want to delete "${id}"? This cannot be undone.`)) {
            const { error } = await supabase.from('conferences').delete().eq('id', id);
            if (error) {
                alert(`Error: ${error.message}`);
            } else {
                cardElement.remove();
                alert('Conference deleted.');
            }
        }
    }

    async function handleEdit(id) {
        const { data, error } = await supabase.from('conferences').select('*, deadlines(*)').eq('id', id).single();
        if (error) {
            alert(`Error fetching details: ${error.message}`);
            return;
        }

        QS('#editConfId').value = data.id;
        QS('#editConfName').value = data.name;
        QS('#editConfUrl').value = data.site_url;
        QS('#editConfLocation').value = data.location;
        QS('#editConfStartDate').value = data.conf_start_date;
        QS('#editConfEndDate').value = data.conf_end_date;

        areasContainer.innerHTML = '';
        if (data.areas) {
            for (const category in data.areas) {
                addAreaInput(category, data.areas[category].join(', '));
            }
        }

        deadlinesContainer.innerHTML = '';
        if (data.deadlines && data.deadlines.length > 0) {
            data.deadlines.forEach(d => addDeadlineInput(d.deadline_type, d.due_date));
        }

        editModal.show();
    }

    async function handleUpdate(event) {
        event.preventDefault();
        const id = QS('#editConfId').value;
        const submitButton = event.target.querySelector('button[type="submit"]');
        submitButton.disabled = true;

        const newAreas = {};
        areasContainer.querySelectorAll('.area-group').forEach(group => {
            const category = group.querySelector('.area-category').value.trim();
            const subfields = group.querySelector('.area-subfields').value.trim().split(',').map(s => s.trim()).filter(Boolean);
            if (category) {
                newAreas[category] = subfields;
            }
        });

        const updatedConferenceData = {
            name: QS('#editConfName').value,
            site_url: QS('#editConfUrl').value,
            location: QS('#editConfLocation').value,
            conf_start_date: QS('#editConfStartDate').value || null,
            conf_end_date: QS('#editConfEndDate').value || null,
            areas: newAreas,
        };

        const newDeadlines = [];
        deadlinesContainer.querySelectorAll('.deadline-group').forEach(group => {
            const type = group.querySelector('.deadline-type').value.trim();
            const date = group.querySelector('.deadline-date').value;
            if (type && date) {
                newDeadlines.push({ conference_id: id, deadline_type: type, due_date: new Date(date + ':00-12:00').toISOString() });
            }
        });

        const { error: confError } = await supabase.from('conferences').update(updatedConferenceData).eq('id', id);
        if (confError) { alert(`Conference update failed: ${confError.message}`); submitButton.disabled = false; return; }

        const { error: deleteError } = await supabase.from('deadlines').delete().eq('conference_id', id);
        if (deleteError) { alert(`Clearing old deadlines failed: ${deleteError.message}`); submitButton.disabled = false; return; }

        if (newDeadlines.length > 0) {
            const { error: insertError } = await supabase.from('deadlines').insert(newDeadlines);
            if (insertError) { alert(`Inserting new deadlines failed: ${insertError.message}`); submitButton.disabled = false; return; }
        }

        alert('Conference updated successfully!');
        editModal.hide();
        fetchConferences();
        submitButton.disabled = false;
    }

    async function checkUserSession() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            loginView.classList.add('d-none');
            adminView.classList.remove('d-none');
            authControls.classList.remove('d-none');
            userEmailSpan.textContent = session.user.email;

            try {
                const [suggestionsResponse, conferencesResponse] = await Promise.all([
                    supabase.from('conference_suggestions').select('*').order('created_at', { ascending: true }),
                    supabase.from('conferences').select('*, deadlines(*)').order('name', { ascending: true })
                ]);

                if (suggestionsResponse.error) throw suggestionsResponse.error;
                if (conferencesResponse.error) throw conferencesResponse.error;

                const suggestions = suggestionsResponse.data || [];
                const conferences = conferencesResponse.data || [];

                renderSuggestions(suggestions, conferences);
                renderConferences(conferences);

            } catch (error) {
                console.error('Error fetching admin data:', error);
                suggestionsList.innerHTML = `<div class="alert alert-danger">Failed to load data: ${error.message}</div>`;
            }
        } else {
            loginView.classList.remove('d-none');
            adminView.classList.add('d-none');
            authControls.classList.add('d-none');
            userEmailSpan.textContent = '';
        }
    }

    // --- INITIALIZATION ---
    document.addEventListener('DOMContentLoaded', () => {
        const errorToastEl = QS('#errorToast');
        if (errorToastEl) {
            toastInstance = new bootstrap.Toast(errorToastEl);
        }

        QS('#login-form').addEventListener('submit', handleLogin);
        QS('#logout-button').addEventListener('click', handleLogout);
        suggestionsList.addEventListener('click', handleSuggestionAction);

        conferenceListDiv.addEventListener('click', (event) => {
            const card = event.target.closest('.card');
            if (!card) return;
            const confId = card.dataset.id;
            if (event.target.matches('.delete-btn')) handleDelete(confId, card);
            if (event.target.matches('.edit-btn')) handleEdit(confId);
        });

        QS('#editForm').addEventListener('submit', handleUpdate);

        QS('#addAreaBtn').addEventListener('click', () => addAreaInput());
        areasContainer.addEventListener('click', (e) => {
            if (e.target.matches('.remove-area-btn')) e.target.closest('.area-group').remove();
        });

        QS('#addDeadlineBtn').addEventListener('click', () => addDeadlineInput());
        deadlinesContainer.addEventListener('click', (e) => {
            if (e.target.matches('.remove-deadline-btn')) e.target.closest('.deadline-group').remove();
        });

        checkUserSession();
    });

})();