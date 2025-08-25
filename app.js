// Sharely - Split Bill Calculator

(() => {
    const state = {
        people: [], // [{ id, name }]
        items: []   // [{ id, name, priceCents, participantIds: [] }]
    };

    const els = {
        personForm: document.getElementById('person-form'),
        personName: document.getElementById('person-name'),
        peopleList: document.getElementById('people-list'),
        itemForm: document.getElementById('item-form'),
        itemName: document.getElementById('item-name'),
        itemPrice: document.getElementById('item-price'),
        itemsList: document.getElementById('items-list'),
        totals: document.getElementById('totals'),
        resetBtn: document.getElementById('reset-btn'),
        exportBtn: document.getElementById('export-btn'),
        importBtn: document.getElementById('import-btn'),
        importInput: document.getElementById('import-input')
    };

    const STORAGE_KEY = 'sharely:v1';

    function toCents(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.round(n * 100);
    }
    function fromCents(cents) {
        return (cents / 100).toFixed(2);
    }
    function uid() {
        return Math.random().toString(36).slice(2, 10);
    }

    function save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    function load() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.people) && Array.isArray(parsed.items)) {
                state.people = parsed.people;
                state.items = parsed.items;
            }
        } catch (e) {
            console.warn('Failed to parse saved data', e);
        }
    }

    function addPerson(name) {
        const trimmed = name.trim();
        if (!trimmed) return;
        const exists = state.people.some(p => p.name.toLowerCase() === trimmed.toLowerCase());
        if (exists) return;
        state.people.push({ id: uid(), name: trimmed });
        save();
        render();
    }

    function removePerson(personId) {
        state.people = state.people.filter(p => p.id !== personId);
        // Also remove from all items' participantIds
        state.items.forEach(item => {
            item.participantIds = item.participantIds.filter(id => id !== personId);
        });
        save();
        render();
    }

    function addItem(name, price) {
        const trimmed = name.trim();
        const priceCents = toCents(price);
        if (!trimmed || priceCents <= 0) return;
        state.items.push({ id: uid(), name: trimmed, priceCents, participantIds: [] });
        save();
        render();
    }

    function removeItem(itemId) {
        state.items = state.items.filter(i => i.id !== itemId);
        save();
        render();
    }

    function toggleParticipant(itemId, personId) {
        const item = state.items.find(i => i.id === itemId);
        if (!item) return;
        const idx = item.participantIds.indexOf(personId);
        if (idx >= 0) item.participantIds.splice(idx, 1);
        else item.participantIds.push(personId);
        save();
        renderTotalsOnly();
        // Update only tags for perf? Simpler to re-render the item row for correctness
        const li = document.querySelector(`[data-item-id="${itemId}"]`);
        if (li) renderItemRow(li, item);
    }

    function calculateTotalsCents() {
        const totals = Object.fromEntries(state.people.map(p => [p.id, 0]));
        for (const item of state.items) {
            const sharers = item.participantIds.length;
            if (sharers === 0) continue;
            const share = Math.round(item.priceCents / sharers);
            for (const pid of item.participantIds) {
                totals[pid] = (totals[pid] || 0) + share;
            }
        }
        return totals;
    }

    // Rendering
    function renderPeople() {
        els.peopleList.innerHTML = '';
        for (const person of state.people) {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="name">${escapeHtml(person.name)}</span>
                <span class="spacer"></span>
                <button class="danger" data-remove-person="${person.id}">Remove</button>
            `;
            els.peopleList.appendChild(li);
            li.querySelector('[data-remove-person]').addEventListener('click', () => removePerson(person.id));
        }
    }

    function renderItemRow(li, item) {
        const peopleTags = state.people.map(p => {
            const active = item.participantIds.includes(p.id) ? 'active' : '';
            return `<span class="person-tag ${active}" data-toggle="${p.id}">${escapeHtml(p.name)}</span>`;
        }).join('');
        li.innerHTML = `
            <span class="name">${escapeHtml(item.name)}</span>
            <span class="price">$${fromCents(item.priceCents)}</span>
            <span class="spacer"></span>
            <div class="people-tags">${peopleTags}</div>
            <button class="danger" data-remove-item>Remove</button>
        `;
        // Bind events
        li.querySelectorAll('[data-toggle]').forEach(tag => {
            tag.addEventListener('click', () => toggleParticipant(item.id, tag.getAttribute('data-toggle')));
        });
        li.querySelector('[data-remove-item]').addEventListener('click', () => removeItem(item.id));
    }

    function renderItems() {
        els.itemsList.innerHTML = '';
        for (const item of state.items) {
            const li = document.createElement('li');
            li.dataset.itemId = item.id;
            renderItemRow(li, item);
            els.itemsList.appendChild(li);
        }
    }

    function renderTotalsOnly() {
        const totalsCents = calculateTotalsCents();
        const totalHtml = state.people.map(p => {
            const amount = fromCents(totalsCents[p.id] || 0);
            return `
                <div class="total-card">
                    <h3>${escapeHtml(p.name)}</h3>
                    <div class="amount">$${amount}</div>
                </div>
            `;
        }).join('');
        els.totals.innerHTML = `<div class="totals-grid">${totalHtml || '<div class="muted">Add people and items to see totals.</div>'}</div>`;
    }

    function render() {
        renderPeople();
        renderItems();
        renderTotalsOnly();
    }

    // Helpers
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Import/Export/Reset
    function exportJson() {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sharely.json';
        a.click();
        URL.revokeObjectURL(url);
    }
    function importJsonFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result);
                if (parsed && Array.isArray(parsed.people) && Array.isArray(parsed.items)) {
                    state.people = parsed.people;
                    state.items = parsed.items;
                    save();
                    render();
                } else {
                    alert('Invalid file');
                }
            } catch (e) {
                alert('Failed to read file');
            }
        };
        reader.readAsText(file);
    }
    function resetAll() {
        if (!confirm('Clear all data?')) return;
        state.people = [];
        state.items = [];
        save();
        render();
    }

    // Events
    els.personForm.addEventListener('submit', (e) => {
        e.preventDefault();
        addPerson(els.personName.value);
        els.personName.value = '';
        els.personName.focus();
    });
    els.itemForm.addEventListener('submit', (e) => {
        e.preventDefault();
        addItem(els.itemName.value, els.itemPrice.value);
        els.itemName.value = '';
        els.itemPrice.value = '';
        els.itemName.focus();
    });

    els.resetBtn.addEventListener('click', resetAll);
    els.exportBtn.addEventListener('click', exportJson);
    els.importBtn.addEventListener('click', () => els.importInput.click());
    els.importInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) importJsonFile(file);
        e.target.value = '';
    });

    // Init
    load();
    render();
})();


