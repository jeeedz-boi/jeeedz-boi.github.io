// Sharely - Split Bill Calculator

(() => {
    const state = {
        people: [], // [{ id, name, color }]
        items: [],  // [{ id, name, priceCents, participantIds: [] }]
        discount: { type: 'percent', value: 0 } // type: 'percent' | 'amount'; value: number (percent or cents)
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
    const URL_PARAM_KEY = 'd';
    const COLOR_PALETTE = [
        '#6ea8fe', '#59f1c8', '#ffd166', '#f4978e', '#b18cff', '#80ed99',
        '#f4a261', '#00c2ff', '#ff85a1', '#b8f7d4', '#bde0fe', '#caffbf'
    ];
    let nextColorIndex = 0;

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
                state.discount = parsed.discount && typeof parsed.discount === 'object'
                    ? { type: parsed.discount.type === 'amount' ? 'amount' : 'percent', value: Number(parsed.discount.value) || 0 }
                    : { type: 'percent', value: 0 };
                ensurePersonColors();
                resetColorIndexFromState();
            }
        } catch (e) {
            console.warn('Failed to parse saved data', e);
        }
    }

    // Base64url helpers
    function toBase64Url(str) {
        const utf8 = new TextEncoder().encode(str);
        let binary = '';
        utf8.forEach(b => { binary += String.fromCharCode(b); });
        const b64 = btoa(binary);
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }
    function fromBase64Url(b64url) {
        const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
        const binary = atob(b64 + pad);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }

    function encodeStateToQuery(stateObj) {
        // Compact v1 schema: [1, people:[[name,color?],...], items:[[name,priceCents,[personIdx...]],...], discount:[typeFlag,value]]
        const people = stateObj.people.map(p => [p.name, p.color || null]);
        const idToIndex = new Map(stateObj.people.map((p, idx) => [p.id, idx]));
        const items = stateObj.items.map(it => [
            it.name,
            Number(it.priceCents) || 0,
            (it.participantIds || []).map(id => idToIndex.get(id)).filter(i => i >= 0)
        ]);
        const discount = stateObj.discount && typeof stateObj.discount === 'object'
            ? [stateObj.discount.type === 'amount' ? 1 : 0, Number(stateObj.discount.value) || 0]
            : [0, 0];
        const compact = [1, people, items, discount];
        return toBase64Url(JSON.stringify(compact));
    }
    function tryDecodeStateFromQuery(paramValue) {
        try {
            const json = fromBase64Url(paramValue);
            const parsed = JSON.parse(json);
            // New compact v1 format
            if (Array.isArray(parsed) && parsed[0] === 1) {
                const peopleArr = Array.isArray(parsed[1]) ? parsed[1] : [];
                const itemsArr = Array.isArray(parsed[2]) ? parsed[2] : [];
                const discountArr = Array.isArray(parsed[3]) ? parsed[3] : [0, 0];
                const people = peopleArr.map(entry => ({ id: uid(), name: String(entry && entry[0] != null ? entry[0] : ''), color: entry && entry[1] ? entry[1] : undefined }));
                const items = itemsArr.map(entry => {
                    const name = String(entry && entry[0] != null ? entry[0] : '');
                    const priceCents = Number(entry && entry[1]) || 0;
                    const participantIdxs = Array.isArray(entry && entry[2]) ? entry[2] : [];
                    const participantIds = participantIdxs.map(i => people[i] && people[i].id).filter(Boolean);
                    return { id: uid(), name, priceCents, participantIds };
                });
                const discount = { type: (discountArr && discountArr[0] === 1) ? 'amount' : 'percent', value: Number(discountArr && discountArr[1]) || 0 };
                return { people, items, discount };
            }
            // Legacy full JSON format
            if (parsed && Array.isArray(parsed.people) && Array.isArray(parsed.items)) {
                return parsed;
            }
        } catch (_) {
            // ignore
        }
        return null;
    }

    function addPerson(name) {
        const trimmed = name.trim();
        if (!trimmed) return;
        const exists = state.people.some(p => p.name.toLowerCase() === trimmed.toLowerCase());
        if (exists) return;
        state.people.push({ id: uid(), name: trimmed, color: pickNextColor() });
        save();
        render();
    }

    function pickNextColor() {
        const color = COLOR_PALETTE[nextColorIndex % COLOR_PALETTE.length];
        nextColorIndex++;
        return color;
    }

    function resetColorIndexFromState() {
        const count = state.people.filter(p => p && p.color).length;
        nextColorIndex = count % COLOR_PALETTE.length;
    }

    function ensurePersonColors() {
        for (const person of state.people) {
            if (!person.color) person.color = pickNextColor();
        }
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

    function assignAllParticipants(itemId) {
        const item = state.items.find(i => i.id === itemId);
        if (!item) return;
        const allIds = state.people.map(p => p.id);
        item.participantIds = allIds.slice();
        save();
        renderTotalsOnly();
        const li = document.querySelector(`[data-item-id="${itemId}"]`);
        if (li) renderItemRow(li, item);
    }

    function unassignAllParticipants(itemId) {
        const item = state.items.find(i => i.id === itemId);
        if (!item) return;
        item.participantIds = [];
        save();
        renderTotalsOnly();
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

    function calculateBillTotalCents() {
        let sum = 0;
        for (const item of state.items) sum += item.priceCents || 0;
        return sum;
    }

    function applyDiscountToTotals(preTotalsMap) {
        const entries = state.people.map(p => ({ id: p.id, name: p.name, amount: preTotalsMap[p.id] || 0 }));
        const sum = entries.reduce((acc, e) => acc + e.amount, 0);
        if (sum === 0) return { perPerson: Object.fromEntries(entries.map(e => [e.id, 0])), net: 0, discountCents: 0 };
        let discountCents = 0;
        if (state.discount.type === 'percent') {
            const pct = Math.max(0, Math.min(100, Number(state.discount.value) || 0));
            discountCents = Math.round(sum * (pct / 100));
        } else {
            discountCents = Math.max(0, Math.min(sum, Math.round(Number(state.discount.value) || 0)));
        }
        const target = sum - discountCents;
        if (discountCents === 0) return { perPerson: Object.fromEntries(entries.map(e => [e.id, e.amount])), net: sum, discountCents: 0 };

        const factor = target / sum;
        const adjusted = entries.map(e => ({ id: e.id, raw: e.amount * factor }));
        const rounded = adjusted.map(a => ({ id: a.id, cents: Math.round(a.raw) }));
        let totalRounded = rounded.reduce((acc, r) => acc + r.cents, 0);
        let diff = target - totalRounded;
        if (diff !== 0) {
            const order = entries
                .map((e, idx) => ({ id: e.id, base: e.amount, idx }))
                .sort((a, b) => b.base - a.base);
            let i = 0;
            while (diff !== 0 && order.length > 0) {
                const id = order[i % order.length].id;
                const entry = rounded.find(r => r.id === id);
                entry.cents += diff > 0 ? 1 : -1;
                diff += diff > 0 ? -1 : 1;
                i++;
            }
        }
        return { perPerson: Object.fromEntries(rounded.map(r => [r.id, r.cents])), net: target, discountCents };
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
            const isActive = item.participantIds.includes(p.id);
            const style = isActive ? `style="background:${p.color};color:${getContrastTextColor(p.color)};border-color:transparent;"` : '';
            return `<span class="person-tag ${isActive ? 'active' : ''}" ${style} data-toggle="${p.id}">${escapeHtml(p.name)}</span>`;
        }).join('');
        li.innerHTML = `
            <span class="name">${escapeHtml(item.name)}</span>
            <span class="price">$${fromCents(item.priceCents)}</span>
            <span class="spacer"></span>
            <div class="people-tags">${peopleTags}</div>
            <div class="row-actions"> 
                <button data-assign-all>Assign all</button>
                <button data-unassign-all>Unassign all</button>
                <button class="danger" data-remove-item>Remove</button>
            <div/>
        `;
        // Bind events
        li.querySelectorAll('[data-toggle]').forEach(tag => {
            tag.addEventListener('click', () => toggleParticipant(item.id, tag.getAttribute('data-toggle')));
        });
        li.querySelector('[data-assign-all]').addEventListener('click', () => assignAllParticipants(item.id));
        li.querySelector('[data-unassign-all]').addEventListener('click', () => unassignAllParticipants(item.id));
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
        const preTotals = calculateTotalsCents();
        const billTotal = calculateBillTotalCents();
        const { perPerson, net, discountCents } = applyDiscountToTotals(preTotals);

        const controls = `
            <div class="row" style="grid-column: 1 / -1; gap: 8px; align-items: center;">
                <span class="pill">Discount</span>
                <select id="discount-type">
                    <option value="percent" ${state.discount.type === 'percent' ? 'selected' : ''}>Percent (%)</option>
                    <option value="amount" ${state.discount.type === 'amount' ? 'selected' : ''}>Amount ($)</option>
                </select>
                <input id="discount-value" type="number" min="0" step="0.01" placeholder="0" value="${formatDiscountInputValue(state.discount)}">
                <span class="spacer"></span>
                <span class="pill">Items: $${fromCents(billTotal)}</span>
                <span class="pill">Discount: -$${fromCents(discountCents)}</span>
                <span class="pill" style="font-weight:700;">Total: $${fromCents(net)}</span>
            </div>
        `;

        const peopleTotalsHtml = state.people.map(p => {
            const amount = fromCents(perPerson[p.id] || 0);
            return `
                <div class="total-card">
                    <h3>${escapeHtml(p.name)}</h3>
                    <div class="amount">$${amount}</div>
                </div>
            `;
        }).join('');
        const inner = peopleTotalsHtml || '<div class="muted">Add people and items to see totals.</div>';
        els.totals.innerHTML = `<div class="totals-grid">${controls}${inner}</div>`;

        const typeSel = document.getElementById('discount-type');
        const valInput = document.getElementById('discount-value');
        if (typeSel && valInput) {
            typeSel.addEventListener('change', () => {
                const newType = typeSel.value === 'amount' ? 'amount' : 'percent';
                const raw = Number(valInput.value);
                if (newType === 'amount') {
                    state.discount = { type: 'amount', value: Math.round((Number.isFinite(raw) ? raw : 0) * 100) };
                } else {
                    state.discount = { type: 'percent', value: Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0)) };
                }
                save();
                renderTotalsOnly();
            });
            valInput.addEventListener('input', () => {
                const raw = Number(valInput.value);
                if (state.discount.type === 'amount') {
                    state.discount.value = Math.round((Number.isFinite(raw) ? raw : 0) * 100);
                } else {
                    state.discount.value = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
                }
                save();
                renderTotalsOnly();
            });
        }
    }

    function formatDiscountInputValue(discount) {
        if (!discount) return '0';
        if (discount.type === 'amount') return (Number(discount.value || 0) / 100).toFixed(2);
        return String(Number(discount.value || 0));
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
    function exportShareLink() {
        const params = new URLSearchParams(location.search);
        params.set(URL_PARAM_KEY, encodeStateToQuery(state));
        const url = `${location.origin}${location.pathname}?${params.toString()}`;
        navigator.clipboard.writeText(url).then(() => {
            alert('Share link copied to clipboard');
        }, () => {
            // Fallback: open prompt
            const ok = prompt('Copy link:', url);
        });
    }
    function importJsonFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result);
                if (parsed && Array.isArray(parsed.people) && Array.isArray(parsed.items)) {
                    state.people = parsed.people;
                    state.items = parsed.items;
                    ensurePersonColors();
                    resetColorIndexFromState();
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
    document.getElementById('share-btn').addEventListener('click', exportShareLink);
    els.exportBtn.addEventListener('click', exportJson);
    els.importBtn.addEventListener('click', () => els.importInput.click());
    els.importInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) importJsonFile(file);
        e.target.value = '';
    });

    // Init
    // Load from URL if present, else from localStorage
    (function initLoad() {
        const params = new URLSearchParams(location.search);
        const encoded = params.get(URL_PARAM_KEY);
        if (encoded) {
            const decoded = tryDecodeStateFromQuery(encoded);
            if (decoded) {
                state.people = decoded.people;
                state.items = decoded.items;
                state.discount = decoded.discount && typeof decoded.discount === 'object'
                    ? { type: decoded.discount.type === 'amount' ? 'amount' : 'percent', value: Number(decoded.discount.value) || 0 }
                    : { type: 'percent', value: 0 };
                ensurePersonColors();
                resetColorIndexFromState();
                save();
                // Clean the URL so subsequent reloads don't keep the query param
                params.delete(URL_PARAM_KEY);
                const cleanUrl = `${location.origin}${location.pathname}${params.toString() ? '?' + params.toString() : ''}${location.hash}`;
                history.replaceState(null, '', cleanUrl);
            } else {
                load();
            }
        } else {
            load();
        }
    })();
    render();

    function getContrastTextColor(hex) {
        const c = hex.replace('#', '').trim();
        const r = parseInt(c.substring(0, 2), 16);
        const g = parseInt(c.substring(2, 4), 16);
        const b = parseInt(c.substring(4, 6), 16);
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        return yiq >= 160 ? '#08121f' : '#ffffff';
    }
})();


