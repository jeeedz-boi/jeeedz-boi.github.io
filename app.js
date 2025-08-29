// Sharely - Split Bill Calculator

(() => {
    const state = {
        people: [], // [{ id, name, color }]
        items: [],  // [{ id, name, priceCents, participantIds: [] }]
        discount: { type: 'percent', value: 0 }, // type: 'percent' | 'amount'; value: number (percent or cents)
        vat: { type: 'percent', value: 0 }, // type: 'percent' | 'amount'; value: number (percent or cents)
        serviceCharge: { type: 'percent', value: 0 } // type: 'percent' | 'amount'; value: number (percent or cents)
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
                state.vat = parsed.vat && typeof parsed.vat === 'object'
                    ? { type: parsed.vat.type === 'amount' ? 'amount' : 'percent', value: Number(parsed.vat.value) || 0 }
                    : { type: 'percent', value: 0 };
                state.serviceCharge = parsed.serviceCharge && typeof parsed.serviceCharge === 'object'
                    ? { type: parsed.serviceCharge.type === 'amount' ? 'amount' : 'percent', value: Number(parsed.serviceCharge.value) || 0 }
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
        const vat = stateObj.vat && typeof stateObj.vat === 'object'
            ? [stateObj.vat.type === 'amount' ? 1 : 0, Number(stateObj.vat.value) || 0]
            : [0, 0];
        const serviceCharge = stateObj.serviceCharge && typeof stateObj.serviceCharge === 'object'
            ? [stateObj.serviceCharge.type === 'amount' ? 1 : 0, Number(stateObj.serviceCharge.value) || 0]
            : [0, 0];
        const compact = [1, people, items, discount, vat, serviceCharge];
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
                const vatArr = Array.isArray(parsed[4]) ? parsed[4] : [0, 0];
                const serviceChargeArr = Array.isArray(parsed[5]) ? parsed[5] : [0, 0];
                const people = peopleArr.map(entry => ({ id: uid(), name: String(entry && entry[0] != null ? entry[0] : ''), color: entry && entry[1] ? entry[1] : undefined }));
                const items = itemsArr.map(entry => {
                    const name = String(entry && entry[0] != null ? entry[0] : '');
                    const priceCents = Number(entry && entry[1]) || 0;
                    const participantIdxs = Array.isArray(entry && entry[2]) ? entry[2] : [];
                    const participantIds = participantIdxs.map(i => people[i] && people[i].id).filter(Boolean);
                    return { id: uid(), name, priceCents, participantIds };
                });
                const discount = { type: (discountArr && discountArr[0] === 1) ? 'amount' : 'percent', value: Number(discountArr && discountArr[1]) || 0 };
                const vat = { type: (vatArr && vatArr[0] === 1) ? 'amount' : 'percent', value: Number(vatArr && vatArr[1]) || 0 };
                const serviceCharge = { type: (serviceChargeArr && serviceChargeArr[0] === 1) ? 'amount' : 'percent', value: Number(serviceChargeArr && serviceChargeArr[1]) || 0 };
                return { people, items, discount, vat, serviceCharge };
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

    function applyVatAndServiceChargeToTotals(preTotalsMap) {
        const entries = state.people.map(p => ({ id: p.id, name: p.name, amount: preTotalsMap[p.id] || 0 }));
        const sum = entries.reduce((acc, e) => acc + e.amount, 0);
        if (sum === 0) return { perPerson: Object.fromEntries(entries.map(e => [e.id, 0])), net: sum, vatCents: 0, serviceChargeCents: 0 };

        let vatCents = 0;
        let serviceChargeCents = 0;

        // Calculate VAT
        if (state.vat.type === 'percent') {
            const pct = Math.max(0, Math.min(100, Number(state.vat.value) || 0));
            vatCents = Math.round(sum * (pct / 100));
        } else {
            vatCents = Math.max(0, Math.round(Number(state.vat.value) || 0));
        }

        // Calculate Service Charge
        if (state.serviceCharge.type === 'percent') {
            const pct = Math.max(0, Math.min(100, Number(state.serviceCharge.value) || 0));
            serviceChargeCents = Math.round(sum * (pct / 100));
        } else {
            serviceChargeCents = Math.max(0, Math.round(Number(state.serviceCharge.value) || 0));
        }

        const totalCharges = vatCents + serviceChargeCents;
        const target = sum + totalCharges;

        if (totalCharges === 0) return { perPerson: Object.fromEntries(entries.map(e => [e.id, e.amount])), net: sum, vatCents: 0, serviceChargeCents: 0 };

        // Distribute charges proportionally based on each person's share
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
        return { perPerson: Object.fromEntries(rounded.map(r => [r.id, r.cents])), net: target, vatCents, serviceChargeCents };
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
            <span class="price">${fromCents(item.priceCents)}</span>
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
        const { perPerson: discountPerPerson, net: discountNet, discountCents } = applyDiscountToTotals(preTotals);
        const { perPerson: finalPerPerson, net: finalNet, vatCents, serviceChargeCents } = applyVatAndServiceChargeToTotals(discountPerPerson);

                 const controls = `
             <div class="row" style="grid-column: 1 / -1; gap: 8px; align-items: center;">
                 <span class="pill" style="min-width: 120px;">Discount</span>
                 <select id="discount-type" style="min-width: 100px;">
                     <option value="percent" ${state.discount.type === 'percent' ? 'selected' : ''}>Percent (%)</option>
                     <option value="amount" ${state.discount.type === 'amount' ? 'selected' : ''}>Amount</option>
                 </select>
                 <input id="discount-value" type="text" placeholder="0" value="${formatDiscountInputValue(state.discount)}" style="min-width: 120px;">
                 <span class="spacer"></span>
                 <span class="pill">Items: ${fromCents(billTotal)}</span>
                 <span class="pill">Discount: -${fromCents(discountCents)}</span>
                 <span class="pill">Subtotal: ${fromCents(discountNet)}</span>
             </div>
             <div class="row" style="grid-column: 1 / -1; gap: 8px; align-items: center;">
                 <span class="pill" style="min-width: 120px;">VAT</span>
                 <select id="vat-type" style="min-width: 100px;">
                     <option value="percent" ${state.vat.type === 'percent' ? 'selected' : ''}>Percent (%)</option>
                     <option value="amount" ${state.vat.type === 'amount' ? 'selected' : ''}>Amount</option>
                 </select>
                 <input id="vat-value" type="text" placeholder="0" value="${formatDiscountInputValue(state.vat)}" style="min-width: 120px;">
                 <span class="spacer"></span>
                 <span class="pill">VAT: +${fromCents(vatCents)}</span>
             </div>
             <div class="row" style="grid-column: 1 / -1; gap: 8px; align-items: center;">
                 <span class="pill" style="min-width: 120px;">Service Charge</span>
                 <select id="service-charge-type" style="min-width: 100px;">
                     <option value="percent" ${state.serviceCharge.type === 'percent' ? 'selected' : ''}>Percent (%)</option>
                     <option value="amount" ${state.serviceCharge.type === 'amount' ? 'selected' : ''}>Amount</option>
                 </select>
                 <input id="service-charge-value" type="text" placeholder="0" value="${formatDiscountInputValue(state.serviceCharge)}" style="min-width: 120px;">
                 <span class="spacer"></span>
                 <span class="pill">Service: +${fromCents(serviceChargeCents)}</span>
                 <span class="pill" style="font-weight:700;">Total: ${fromCents(finalNet)}</span>
             </div>
         `;

        const peopleTotalsHtml = state.people.map(p => {
            const amount = fromCents(finalPerPerson[p.id] || 0);
            return `
                <div class="total-card">
                    <h3>${escapeHtml(p.name)}</h3>
                    <div class="amount">${amount}</div>
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
                updateTotalsDisplay();
            });
            valInput.addEventListener('input', () => {
                const raw = Number(valInput.value);
                if (state.discount.type === 'amount') {
                    state.discount.value = Math.round((Number.isFinite(raw) ? raw : 0) * 100);
                } else {
                    state.discount.value = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
                }
                save();
                updateTotalsDisplay();
            });
        }

        // VAT event listeners
        const vatTypeSel = document.getElementById('vat-type');
        const vatValInput = document.getElementById('vat-value');
        if (vatTypeSel && vatValInput) {
            vatTypeSel.addEventListener('change', () => {
                const newType = vatTypeSel.value === 'amount' ? 'amount' : 'percent';
                const raw = Number(vatValInput.value);
                if (newType === 'amount') {
                    state.vat = { type: 'amount', value: Math.round((Number.isFinite(raw) ? raw : 0) * 100) };
                } else {
                    state.vat = { type: 'percent', value: Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0)) };
                }
                save();
                updateTotalsDisplay();
            });
            vatValInput.addEventListener('input', () => {
                const raw = Number(vatValInput.value);
                if (state.vat.type === 'amount') {
                    state.vat.value = Math.round((Number.isFinite(raw) ? raw : 0) * 100);
                } else {
                    state.vat.value = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
                }
                save();
                updateTotalsDisplay();
            });
        }

        // Service Charge event listeners
        const serviceTypeSel = document.getElementById('service-charge-type');
        const serviceValInput = document.getElementById('service-charge-value');
        if (serviceTypeSel && serviceValInput) {
            serviceTypeSel.addEventListener('change', () => {
                const newType = serviceTypeSel.value === 'amount' ? 'amount' : 'percent';
                const raw = Number(serviceValInput.value);
                if (newType === 'amount') {
                    state.serviceCharge = { type: 'amount', value: Math.round((Number.isFinite(raw) ? raw : 0) * 100) };
                } else {
                    state.serviceCharge = { type: 'percent', value: Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0)) };
                }
                save();
                updateTotalsDisplay();
            });
            serviceValInput.addEventListener('input', () => {
                const raw = Number(serviceValInput.value);
                if (state.serviceCharge.type === 'amount') {
                    state.serviceCharge.value = Math.round((Number.isFinite(raw) ? raw : 0) * 100);
                } else {
                    state.serviceCharge.value = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
                }
                save();
                updateTotalsDisplay();
            });
        }
    }

    function formatDiscountInputValue(discount) {
        if (!discount) return '0';
        if (discount.type === 'amount') return String(Number(discount.value || 0) / 100);
        return String(Number(discount.value || 0));
    }

    function updateTotalsDisplay() {
        const preTotals = calculateTotalsCents();
        const billTotal = calculateBillTotalCents();
        const { perPerson: discountPerPerson, net: discountNet, discountCents } = applyDiscountToTotals(preTotals);
        const { perPerson: finalPerPerson, net: finalNet, vatCents, serviceChargeCents } = applyVatAndServiceChargeToTotals(discountPerPerson);

        // Update only the display values without recreating HTML
        const allPills = document.querySelectorAll('.pill');
        allPills.forEach(pill => {
            const text = pill.textContent;
            if (text.includes('Items:')) {
                pill.textContent = `Items: ${fromCents(billTotal)}`;
            } else if (text.includes('Discount:')) {
                pill.textContent = `Discount: -${fromCents(discountCents)}`;
            } else if (text.includes('Subtotal:')) {
                pill.textContent = `Subtotal: ${fromCents(discountNet)}`;
            } else if (text.includes('VAT:')) {
                pill.textContent = `VAT: +${fromCents(vatCents)}`;
            } else if (text.includes('Service:')) {
                pill.textContent = `Service: +${fromCents(serviceChargeCents)}`;
            } else if (text.includes('Total:') && !text.includes('Items:') && !text.includes('Discount:') && !text.includes('Subtotal:') && !text.includes('VAT:') && !text.includes('Service:')) {
                pill.textContent = `Total: ${fromCents(finalNet)}`;
            }
        });

        // Update people totals
        const totalCards = document.querySelectorAll('.total-card .amount');
        totalCards.forEach((card, index) => {
            const person = state.people[index];
            if (person && finalPerPerson[person.id]) {
                card.textContent = `${fromCents(finalPerPerson[person.id])}`;
            }
        });
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
                    if (parsed.discount && typeof parsed.discount === 'object') {
                        state.discount = { type: parsed.discount.type === 'amount' ? 'amount' : 'percent', value: Number(parsed.discount.value) || 0 };
                    }
                    if (parsed.vat && typeof parsed.vat === 'object') {
                        state.vat = { type: parsed.vat.type === 'amount' ? 'amount' : 'percent', value: Number(parsed.vat.value) || 0 };
                    }
                    if (parsed.serviceCharge && typeof parsed.serviceCharge === 'object') {
                        state.serviceCharge = { type: parsed.serviceCharge.type === 'amount' ? 'amount' : 'percent', value: Number(parsed.serviceCharge.value) || 0 };
                    }
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
        state.discount = { type: 'percent', value: 0 };
        state.vat = { type: 'percent', value: 0 };
        state.serviceCharge = { type: 'percent', value: 0 };
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
                state.vat = decoded.vat && typeof decoded.vat === 'object'
                    ? { type: decoded.vat.type === 'amount' ? 'amount' : 'percent', value: Number(decoded.vat.value) || 0 }
                    : { type: 'percent', value: 0 };
                state.serviceCharge = decoded.serviceCharge && typeof decoded.serviceCharge === 'object'
                    ? { type: decoded.serviceCharge.type === 'amount' ? 'amount' : 'percent', value: Number(decoded.serviceCharge.value) || 0 }
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


