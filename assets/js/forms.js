(function (window) {
    const CD = window.ConferenceDeadlines = window.ConferenceDeadlines || {};

    function defaultSubfieldHTML(required = false) {
        return `
            <div class="input-group mb-2">
                <input type="text" class="form-control subfield-input" placeholder="CV, NLP, ..." ${required ? 'required' : ''}>
            </div>
        `;
    }

    function defaultSuggestionDeadlineHTML(required = false) {
        return `
            <div class="input-group mb-2">
                <input type="text" class="form-control suggestion-deadline-type" placeholder="Type (e.g., Abstract)" ${required ? 'required' : ''}>
                <input type="datetime-local" class="form-control suggestion-deadline-due" ${required ? 'required' : ''}>
            </div>
        `;
    }

    function addSubfieldInput(container) {
        const div = document.createElement('div');
        div.className = 'input-group mb-2';
        div.innerHTML = `
            <input type="text" class="form-control subfield-input" placeholder="e.g., NLP">
            <button class="btn btn-outline-danger remove-subfield-btn" type="button" aria-label="Remove subfield">&times;</button>
        `;
        container.appendChild(div);
    }

    function addSuggestionDeadlineInput(container) {
        const div = document.createElement('div');
        div.className = 'input-group mb-2';
        div.innerHTML = `
            <input type="text" class="form-control suggestion-deadline-type" placeholder="Type (e.g., Full Paper)">
            <input type="datetime-local" class="form-control suggestion-deadline-due">
            <button class="btn btn-outline-danger remove-suggestion-deadline-btn" type="button" aria-label="Remove deadline">&times;</button>
        `;
        container.appendChild(div);
    }

    function addSuggestEditSubfieldInput(container, value = '') {
        const div = document.createElement('div');
        div.className = 'input-group mb-2';
        div.innerHTML = `
            <input type="text" class="form-control suggest-edit-subfield-input" value="${CD.escapeAttr(value)}">
            <button class="btn btn-outline-danger remove-subfield-btn" type="button" aria-label="Remove subfield">&times;</button>
        `;
        container.appendChild(div);
    }

    function addSuggestEditDeadlineInput(container, type = '', date = '') {
        const div = document.createElement('div');
        div.className = 'input-group mb-2';
        const formattedDate = CD.formatForDateTimeLocalInput(date);
        div.innerHTML = `
            <input type="text" class="form-control deadline-type" placeholder="Type (e.g., Full Paper)" value="${CD.escapeAttr(type)}">
            <input type="datetime-local" class="form-control deadline-date" value="${CD.escapeAttr(formattedDate)}">
            <button class="btn btn-outline-danger remove-deadline-btn" type="button" aria-label="Remove deadline">&times;</button>
        `;
        container.appendChild(div);
    }

    function resetSuggestionForm(form, alertBox, subfieldsContainer, deadlinesContainer) {
        form?.reset();
        alertBox?.classList.add('d-none');
        if (subfieldsContainer) subfieldsContainer.innerHTML = defaultSubfieldHTML(true);
        if (deadlinesContainer) deadlinesContainer.innerHTML = defaultSuggestionDeadlineHTML(true);
    }

    function collectSuggestionDeadlines(container, typeSelector, dueSelector) {
        const deadlines = [];

        CD.QSA('.input-group', container).forEach(group => {
            const type = CD.QS(typeSelector, group)?.value.trim();
            const due = CD.QS(dueSelector, group)?.value;
            const dueIso = CD.fromAoeDateTimeLocalToIso(due);

            if (type && dueIso) {
                deadlines.push({ type, due: dueIso });
            }
        });

        return deadlines;
    }

    function bindAddSuggestionForm() {
        const suggestModal = CD.QS('#suggestModal');
        const suggestionForm = CD.QS('#suggestionForm');
        const subfieldsContainer = CD.QS('#subfieldsContainer');
        const addSubfieldBtn = CD.QS('#addSubfieldBtn');
        const suggestionDeadlinesContainer = CD.QS('#suggestionDeadlinesContainer');
        const addSuggestionDeadlineBtn = CD.QS('#addSuggestionDeadlineBtn');
        const alertBox = CD.QS('#suggestionAlert');

        if (!suggestionForm || !subfieldsContainer || !suggestionDeadlinesContainer) return;

        addSubfieldBtn?.addEventListener('click', () => addSubfieldInput(subfieldsContainer));
        subfieldsContainer.addEventListener('click', event => {
            if (event.target.classList.contains('remove-subfield-btn')) {
                event.target.closest('.input-group')?.remove();
            }
        });

        addSuggestionDeadlineBtn?.addEventListener('click', () => addSuggestionDeadlineInput(suggestionDeadlinesContainer));
        suggestionDeadlinesContainer.addEventListener('click', event => {
            if (event.target.classList.contains('remove-suggestion-deadline-btn')) {
                event.target.closest('.input-group')?.remove();
            }
        });

        suggestModal?.addEventListener('hidden.bs.modal', () => {
            resetSuggestionForm(suggestionForm, alertBox, subfieldsContainer, suggestionDeadlinesContainer);
        });

        suggestionForm.addEventListener('submit', async event => {
            event.preventDefault();
            if (!suggestionForm.checkValidity()) {
                suggestionForm.reportValidity();
                return;
            }

            const submitButton = suggestionForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.textContent = 'Submitting...';

            const subfieldValues = CD.QSA('.subfield-input', subfieldsContainer)
                .map(input => input.value.trim())
                .filter(Boolean);

            const suggestion = {
                name: CD.QS('#confName').value.trim(),
                site_url: CD.QS('#confUrl').value.trim(),
                location: CD.QS('#confLocation').value.trim(),
                conf_start_date: CD.QS('#confStartDate').value || null,
                conf_end_date: CD.QS('#confEndDate').value || null,
                category: CD.QS('#category').value.trim(),
                subfields: subfieldValues.join(', '),
                deadlines: collectSuggestionDeadlines(
                    suggestionDeadlinesContainer,
                    '.suggestion-deadline-type',
                    '.suggestion-deadline-due'
                )
            };

            const { error } = await CD.api.insertConferenceSuggestion(suggestion);

            if (error) {
                alertBox.className = 'alert alert-danger';
                alertBox.textContent = `Error: ${error.message}`;
            } else {
                alertBox.className = 'alert alert-success';
                alertBox.textContent = 'Thank you! Your suggestion has been submitted for review.';
                resetSuggestionForm(suggestionForm, alertBox, subfieldsContainer, suggestionDeadlinesContainer);
            }

            alertBox.classList.remove('d-none');
            submitButton.disabled = false;
            submitButton.textContent = 'Submit for Review';
        });
    }

    function bindSuggestEditForm(state) {
        const suggestEditModalEl = CD.QS('#suggestEditModal');
        const suggestEditForm = CD.QS('#suggestEditForm');
        const suggestEditCategoryInput = CD.QS('#suggestEditCategory');
        const suggestEditSubfieldsContainer = CD.QS('#suggestEditSubfieldsContainer');
        const addSuggestEditSubfieldBtn = CD.QS('#addSuggestEditSubfieldBtn');
        const suggestEditDeadlinesContainer = CD.QS('#suggestEditDeadlinesContainer');
        const addSuggestEditDeadlineBtn = CD.QS('#addSuggestEditDeadlineBtn');

        if (!suggestEditModalEl || !suggestEditForm) return;

        suggestEditModalEl.addEventListener('show.bs.modal', event => {
            const button = event.relatedTarget;
            const confId = button?.getAttribute('data-conf-id');
            const item = state.items.find(conf => conf.id === confId);
            if (!item) return;

            suggestEditForm.reset();
            suggestEditSubfieldsContainer.innerHTML = '';
            suggestEditDeadlinesContainer.innerHTML = '';

            CD.QS('#suggestEditConfId').value = item.id || '';
            CD.QS('#suggestEditConfName').value = item.name || '';
            CD.QS('#suggestEditConfUrl').value = item.site || '';
            CD.QS('#suggestEditConfLocation').value = item.location || '';
            CD.QS('#suggestEditConfStartDate').value = item.dates?.conf_start || '';
            CD.QS('#suggestEditConfEndDate').value = item.dates?.conf_end || '';

            const firstCategory = item.areas ? Object.keys(item.areas)[0] || '' : '';
            suggestEditCategoryInput.value = firstCategory;
            const subfields = item.areas?.[firstCategory] || [];
            if (subfields.length > 0) {
                subfields.forEach(subfield => addSuggestEditSubfieldInput(suggestEditSubfieldsContainer, subfield));
            } else {
                addSuggestEditSubfieldInput(suggestEditSubfieldsContainer);
            }

            if (item.deadlines && item.deadlines.length > 0) {
                item.deadlines.forEach(deadline => addSuggestEditDeadlineInput(suggestEditDeadlinesContainer, deadline.type, deadline.due));
            } else {
                addSuggestEditDeadlineInput(suggestEditDeadlinesContainer);
            }
        });

        addSuggestEditSubfieldBtn?.addEventListener('click', () => addSuggestEditSubfieldInput(suggestEditSubfieldsContainer));
        suggestEditSubfieldsContainer.addEventListener('click', event => {
            if (event.target.matches('.remove-subfield-btn') && suggestEditSubfieldsContainer.querySelectorAll('.input-group').length > 1) {
                event.target.closest('.input-group')?.remove();
            }
        });

        addSuggestEditDeadlineBtn?.addEventListener('click', () => addSuggestEditDeadlineInput(suggestEditDeadlinesContainer));
        suggestEditDeadlinesContainer.addEventListener('click', event => {
            if (event.target.matches('.remove-deadline-btn') && suggestEditDeadlinesContainer.querySelectorAll('.input-group').length > 1) {
                event.target.closest('.input-group')?.remove();
            }
        });

        suggestEditForm.addEventListener('submit', async event => {
            event.preventDefault();
            const submitButton = suggestEditForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;

            const category = suggestEditCategoryInput.value.trim();
            const subfields = CD.QSA('.suggest-edit-subfield-input', suggestEditSubfieldsContainer)
                .map(input => input.value.trim())
                .filter(Boolean)
                .join(', ');

            const finalSuggestion = {
                name: CD.QS('#suggestEditConfName').value.trim(),
                site_url: CD.QS('#suggestEditConfUrl').value.trim(),
                location: CD.QS('#suggestEditConfLocation').value.trim(),
                conf_start_date: CD.QS('#suggestEditConfStartDate').value || null,
                conf_end_date: CD.QS('#suggestEditConfEndDate').value || null,
                deadlines: collectSuggestionDeadlines(
                    suggestEditDeadlinesContainer,
                    '.deadline-type',
                    '.deadline-date'
                ),
                category,
                subfields,
                is_edit: true,
                target_conference_id: CD.QS('#suggestEditConfId').value
            };

            const { error } = await CD.api.insertConferenceSuggestion(finalSuggestion);

            if (error) {
                alert(`Error submitting suggestion: ${error.message}`);
            } else {
                alert('Thank you! Your edit suggestion has been submitted for review.');
                bootstrap.Modal.getInstance(suggestEditModalEl)?.hide();
            }

            submitButton.disabled = false;
        });
    }

    function bindSuggestionForms(state) {
        bindAddSuggestionForm();
        bindSuggestEditForm(state);
    }

    CD.forms = {
        bindSuggestionForms,
        collectSuggestionDeadlines
    };
})(window);
