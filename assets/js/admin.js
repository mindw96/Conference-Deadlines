(function () {
    const CD = window.ConferenceDeadlines;
    const QS = CD.QS;
    const supabase = CD.api.getClient();

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
        CD.addAreaInput(areasContainer, category, subfields);
    }

    function addDeadlineInput(type = '', date = '') {
        const div = document.createElement('div');
        div.className = 'input-group mb-2 deadline-group';
        const formattedDate = CD.formatForDateTimeLocalInput(date);
        div.innerHTML = `
            <input type="text" class="form-control deadline-type" placeholder="Deadline Type" value="${CD.escapeAttr(type)}">
            <input type="datetime-local" class="form-control deadline-date" value="${CD.escapeAttr(formattedDate)}">
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
                changes.push(`<b>${CD.escapeHTML(field)}:</b> "${CD.escapeHTML(originalValue)}" → "${CD.escapeHTML(suggestionValue)}"`);
            }
        });

        // 2. Compare 'areas' by creating a comparable string
        const originalAreas = original.areas ? JSON.stringify(original.areas) : '{}';

        const suggestionAreas = CD.suggestionAreas(suggestion, original.areas);
        const suggestionAreasString = JSON.stringify(suggestionAreas);

        if (originalAreas !== suggestionAreasString) {
            changes.push(`<b>Areas:</b> Have been updated.`);
        }

        // 3. Compare 'deadlines' by creating a comparable string
        const comparableDeadlines = deadlines => JSON.stringify(deadlines.map(d => ({
            type: d.type || d.deadline_type, due: new Date(d.due || d.due_date).toISOString()
        })).sort((a, b) => a.due.localeCompare(b.due) || a.type.localeCompare(b.type)));
        const originalDeadlines = comparableDeadlines(original.deadlines || []);
        const suggestionDeadlines = comparableDeadlines(suggestion.deadlines);

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
            const invalid = CD.validateSuggestion(s) || (isEdit && !conferenceMap.has(s.target_conference_id) ? 'Target conference missing.' : '');
            const editBadge = isEdit ? '<span class="badge bg-info">Edit Suggestion</span>' : '';
            const targetInfo = isEdit ? `<p class="card-text mb-1"><small><strong>Target:</strong> ${CD.escapeHTML(s.target_conference_id)}</small></p>` : '';

            // Deadlines를 보기 좋게 표시
            const deadlinesText = invalid ? CD.escapeHTML(invalid)
                : s.deadlines.map(d => CD.escapeHTML(d.type) + ': ' + CD.escapeHTML(CD.formatDateAOE(d.due))).join('<br>');

            let changesHTML = '';
            if (!invalid && isEdit && s.target_conference_id) {
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

            const categoryHTML = s.category ? `<p class="card-text mb-1"><strong>Category:</strong> ${CD.escapeHTML(s.category)}</p>` : '';
            const subfieldsHTML = s.subfields ? `<p class="card-text mb-1"><strong>Subfields:</strong> ${CD.escapeHTML(s.subfields)}</p>` : '';
            const siteURL = CD.safeURL(s.site_url);

            return `
                <div class="card" data-id="${CD.escapeAttr(s.id)}">
                    <div class="card-body">
                        <h5 class="card-title d-flex justify-content-between">
                            ${CD.escapeHTML(s.name)} ${editBadge}
                        </h5>
                        ${targetInfo}
                        <p class="card-text mb-1"><strong>URL:</strong> <a href="${CD.escapeAttr(siteURL)}" target="_blank" rel="noopener">${CD.escapeHTML(s.site_url)}</a></p>
                        <p class="card-text mb-1"><strong>Location:</strong> ${CD.escapeHTML(s.location || 'N/A')}</p>
                        <p class="card-text mb-1"><strong>Dates:</strong> ${CD.escapeHTML(s.conf_start_date || 'N/A')} to ${CD.escapeHTML(s.conf_end_date || 'N/A')}</p>
                        ${s.areas && CD.validAreas(s.areas) ? '<p><strong>Areas:</strong> ' + CD.escapeHTML(JSON.stringify(s.areas)) + '</p>' : categoryHTML + subfieldsHTML}
                        <p class="card-text mb-1"><strong>Deadlines:</strong><br><small>${deadlinesText}</small></p>
                        ${changesHTML}
                        <div class="mt-3">
                            <button class="btn btn-success btn-sm approve-btn" ${invalid ? 'disabled' : ''}>Approve</button>
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
            <div class="card" data-id="${CD.escapeAttr(conf.id)}">
                <div class="card-body">
                    <div class="d-flex justify-content-between">
                        <div>
                            <h5 class="card-title mb-1">${CD.escapeHTML(conf.name)}</h5>
                            <p class="card-text text-muted small">${CD.escapeHTML(conf.location || 'Location not set')}</p>
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
        const button = event.target.closest('.approve-btn, .reject-btn');
        if (!button) return;
        const card = button.closest('.card');
        button.disabled = true;
        try {
            if (button.matches('.reject-btn')) {
                const failure = await writeAffectingRows(supabase.from('conference_suggestions').delete().eq('id', card.dataset.id), 'Rejecting the suggestion');
                if (failure) throw new Error(failure);
            } else {
                const { error } = await supabase.rpc('approve_suggestion', { p_suggestion_id: card.dataset.id });
                if (error) throw new Error(error.code === '23505' ? 'This conference ID already exists. Submit an edit or rename the new submission.' : error.message);
            }
            await checkUserSession();
        } catch (error) {
            alert('Suggestion was not processed: ' + error.message);
        } finally {
            button.disabled = false;
        }
    }

    // PostgREST reports plain success when row-level security filters every
    // target row away, so a blocked write is indistinguishable from a real one
    // unless we ask for the affected rows back. An empty result is a failure.
    const RLS_HINT = 'It may have been removed by another administrator, or your session may lack permission. Refresh and check your administrator membership.';

    async function writeAffectingRows(query, action) {
        const { data, error } = await query.select('id');

        if (error) return error.message;
        if (!data || data.length === 0) return `${action} affected no rows. ${RLS_HINT}`;
        return null;
    }

    async function handleDelete(id, cardElement) {
        if (confirm(`Are you sure you want to delete "${id}"? This cannot be undone.`)) {
            const failure = await writeAffectingRows(
                supabase.from('conferences').delete().eq('id', id),
                'Deleting the conference'
            );

            if (failure) {
                alert(`Error: ${failure}`);
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

        if (data.areas != null && !CD.isAreasObject(data.areas)) {
            alert('This conference has malformed category data. Repair it in the database before editing.');
            return;
        }
        QS('#editConfId').value = data.id;
        QS('#editConfName').value = data.name;
        QS('#editConfUrl').value = data.site_url;
        QS('#editConfLocation').value = data.location;
        QS('#editConfStartDate').value = data.conf_start_date;
        QS('#editConfEndDate').value = data.conf_end_date;

        areasContainer.innerHTML = '';
        if (CD.isAreasObject(data.areas)) {
            for (const category of Object.keys(data.areas)) {
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

        try {
            const payload = {
                name: QS('#editConfName').value.trim(),
                site_url: QS('#editConfUrl').value.trim(),
                location: QS('#editConfLocation').value.trim(),
                conf_start_date: QS('#editConfStartDate').value || null,
                conf_end_date: QS('#editConfEndDate').value || null,
                areas: CD.collectAreas(areasContainer)
            };
            const problem = CD.validateConference(payload);
            if (problem) throw new Error(problem);
            const deadlines = CD.collectDeadlines(deadlinesContainer, '.deadline-type', '.deadline-date');
            const { error } = await supabase.rpc('save_conference', {
                p_id: id, p_conference: payload, p_deadlines: deadlines
            });
            if (error) throw error;
            editModal.hide();
            await checkUserSession();
        } catch (error) {
            alert('Conference was not updated: ' + error.message);
        } finally {
            submitButton.disabled = false;
        }
    }

    async function checkUserSession() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            loginView.classList.add('d-none');
            adminView.classList.remove('d-none');
            authControls.classList.remove('d-none');
            userEmailSpan.textContent = session.user.email;

            const [suggestionsResponse, conferencesResponse] = await Promise.allSettled([
                CD.api.selectAll('conference_suggestions'),
                CD.api.selectConferencesWithDeadlines()
            ]);
            const confResult = conferencesResponse.status === 'fulfilled' ? conferencesResponse.value : { error: conferencesResponse.reason };
            const suggestionsResult = suggestionsResponse.status === 'fulfilled' ? suggestionsResponse.value : { error: suggestionsResponse.reason };
            const conferences = confResult.data || [];
            if (confResult.error) conferenceListDiv.innerHTML = CD.createErrorHTML('Failed to load conferences.');
            else renderConferences(conferences.sort((a, b) => a.name.localeCompare(b.name)));
            if (suggestionsResult.error) suggestionsList.innerHTML = CD.createErrorHTML('Failed to load suggestions.');
            else renderSuggestions((suggestionsResult.data || []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))), conferences);
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
