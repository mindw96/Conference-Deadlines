(function (window) {
    const CD = window.ConferenceDeadlines;
    const QS = CD.QS;

    const state = {
        items: [],
        filtered: [],
        q: '',
        category: 'all',
        subfield: 'all',
        status: 'all',
        sort: 'next_due_asc',
        showPast: false
    };

    function parseQuery() {
        const url = new URL(location.href);
        state.q = url.searchParams.get('q') || '';
        state.category = url.searchParams.get('category') || 'all';
        state.subfield = url.searchParams.get('subfield') || 'all';
        state.status = url.searchParams.get('status') || 'all';
        state.sort = url.searchParams.get('sort') || 'next_due_asc';

        QS('#q').value = state.q;
        QS('#statusFilter').value = state.status;
        QS('#sortSelect').value = state.sort;
    }

    function updatePermalink() {
        const url = new URL(location.href);
        url.searchParams.set('q', state.q);
        url.searchParams.set('category', state.category);
        url.searchParams.set('subfield', state.subfield);
        url.searchParams.set('status', state.status);
        url.searchParams.set('sort', state.sort);
        history.replaceState(null, '', url.toString());
    }

    function applyFilters() {
        const q = state.q.trim().toLowerCase();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        state.filtered = state.items.filter(item => {
            if (!state.showPast) {
                const confEnd = item.dates?.conf_end;
                if (confEnd && new Date(confEnd) < today) {
                    return false;
                }
            }

            if (state.status !== 'all' && item.status !== state.status) return false;
            if (state.category !== 'all' && !Object.prototype.hasOwnProperty.call(item.areas, state.category)) return false;

            if (state.subfield !== 'all') {
                const subfields = state.category === 'all'
                    ? Object.values(item.areas).flat()
                    : item.areas[state.category] || [];
                if (!subfields.includes(state.subfield)) return false;
            }

            if (q) {
                const allSubfields = Object.values(item.areas).flat().join(' ');
                const haystack = [
                    item.name || '',
                    item.location || '',
                    (item.tags || []).join(' '),
                    allSubfields
                ].join(' ').toLowerCase();

                if (!haystack.includes(q)) return false;
            }

            return true;
        });

        sortItems();
    }

    function sortItems() {
        state.filtered.sort((a, b) => {
            if (state.sort === 'name_asc') {
                return (a.name || '').localeCompare(b.name || '');
            }

            const aHasDeadline = !!a.nextDue;
            const bHasDeadline = !!b.nextDue;

            if (aHasDeadline && bHasDeadline) return a.nextDue - b.nextDue;
            if (aHasDeadline) return -1;
            if (bHasDeadline) return 1;

            const startDateA = a.dates?.conf_start;
            const startDateB = b.dates?.conf_start;

            if (startDateA && startDateB) {
                return new Date(startDateA) - new Date(startDateB);
            }

            return (a.name || '').localeCompare(b.name || '');
        });
    }

    function rebuildFilters() {
        const categoryFilter = QS('#categoryFilter');
        const subfieldFilter = QS('#subfieldFilter');
        const allCategories = new Set();
        const allSubfields = new Set();
        const categoryToSubfields = {};

        state.items.forEach(item => {
            for (const category in item.areas) {
                allCategories.add(category);
                categoryToSubfields[category] = categoryToSubfields[category] || new Set();
                item.areas[category].forEach(subfield => {
                    allSubfields.add(subfield);
                    categoryToSubfields[category].add(subfield);
                });
            }
        });

        categoryFilter.textContent = '';
        categoryFilter.append(new Option('All', 'all'));
        [...allCategories].sort().forEach(category => {
            categoryFilter.append(new Option(category, category));
        });

        window.updateSubfieldFilter = () => {
            const selectedCategory = categoryFilter.value;
            const subfieldsToShow = selectedCategory === 'all'
                ? allSubfields
                : categoryToSubfields[selectedCategory] || new Set();

            subfieldFilter.textContent = '';
            subfieldFilter.append(new Option('All', 'all'));
            [...subfieldsToShow].sort().forEach(subfield => {
                subfieldFilter.append(new Option(subfield, subfield));
            });

            if ([...subfieldsToShow].includes(state.subfield)) {
                subfieldFilter.value = state.subfield;
            } else {
                state.subfield = 'all';
                subfieldFilter.value = 'all';
            }
        };

        if (![...categoryFilter.options].some(option => option.value === state.category)) {
            state.category = 'all';
        }

        categoryFilter.value = state.category;
        window.updateSubfieldFilter();
    }

    function initBootstrapDecorations() {
        CD.QSA('[data-bs-toggle="tooltip"]').forEach(el => {
            bootstrap.Tooltip.getInstance(el)?.dispose();
            new bootstrap.Tooltip(el);
        });

        CD.QSA('[data-bs-toggle="popover"]').forEach(el => {
            bootstrap.Popover.getInstance(el)?.dispose();
            new bootstrap.Popover(el, { trigger: 'focus' });
        });
    }

    function render() {
        applyFilters();

        const cardsContainer = QS('#cards');
        const noResultsContainer = QS('#noResults');

        if (state.filtered.length === 0) {
            cardsContainer.textContent = '';
            cardsContainer.style.display = 'none';
            noResultsContainer.classList.remove('d-none');
        } else {
            cardsContainer.innerHTML = state.filtered.map(CD.render.renderCard).join('');
            cardsContainer.style.display = 'grid';
            noResultsContainer.classList.add('d-none');
        }

        QS('#resultCount').textContent = state.filtered.length;
        initBootstrapDecorations();
        CD.render.startCountdownTimer(render);
    }

    function bindControls() {
        const on = (selector, type, handler) => {
            const el = QS(selector);
            if (el) el.addEventListener(type, handler);
        };

        on('#q', 'input', event => {
            state.q = event.target.value;
            updatePermalink();
            render();
        });
        on('#statusFilter', 'change', event => {
            state.status = event.target.value;
            updatePermalink();
            render();
        });
        on('#sortSelect', 'change', event => {
            state.sort = event.target.value;
            updatePermalink();
            render();
        });
        on('#categoryFilter', 'change', event => {
            state.category = event.target.value;
            state.subfield = 'all';
            window.updateSubfieldFilter();
            updatePermalink();
            render();
        });
        on('#subfieldFilter', 'change', event => {
            state.subfield = event.target.value;
            updatePermalink();
            render();
        });
        on('#themeToggle', 'click', () => {
            const root = document.documentElement;
            const cur = root.getAttribute('data-bs-theme') || 'light';
            const next = cur === 'light' ? 'dark' : 'light';
            root.setAttribute('data-bs-theme', next);
            localStorage.setItem('theme', next);
            syncThemeToggle();
        });
        on('#showPastConf', 'change', event => {
            state.showPast = event.target.checked;
            render();
        });

        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-bs-theme', savedTheme);
        }

        syncThemeToggle();
    }

    // The toggle names the theme it switches to: moon/Dark while light, sun/Light while dark.
    function syncThemeToggle() {
        const button = QS('#themeToggle');
        if (!button) return;

        const isDark = (document.documentElement.getAttribute('data-bs-theme') || 'light') === 'dark';
        const icon = QS('#themeToggleIcon');
        const label = QS('#themeToggleLabel');

        if (icon) icon.className = isDark ? 'bi bi-sun' : 'bi bi-moon';
        if (label) label.textContent = isDark ? 'Light' : 'Dark';
        button.setAttribute('aria-pressed', String(isDark));
    }

    function showLoadError(error) {
        console.error('Failed to load data:', error);
        QS('#cards').innerHTML = CD.createErrorHTML('Failed to load data.');
    }

    document.addEventListener('DOMContentLoaded', () => {
        parseQuery();
        bindControls();
        CD.calendar.bindICSDownloads(QS('#cards'), state);
        CD.render.bindDeadlineToggles(QS('#cards'));
        CD.forms.bindSuggestionForms(state);

        CD.data.loadData()
            .then(items => {
                state.items = items;
                rebuildFilters();
                render();
            })
            .catch(showLoadError);
    });
})(window);
