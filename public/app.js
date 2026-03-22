// ── Globals ────────────────────────────────────────────────────────────────
let selectedBookCode = null;
let currentUser = JSON.parse(sessionStorage.getItem("currentUser"));
let allBooks = [];
let currentPage = 1;
const PAGE_SIZE = 10;
let sortState = [];
const FEE_PER_DAY = 20;
let bulkMode = false;
let bulkSelected = new Set();
let myBorrowedCodes = new Set();

// ── Books: Load ────────────────────────────────────────────────────────────

async function loadBooks() {
    const [booksRes, myBorrowsRes] = await Promise.all([
        fetch("/books"),
        currentUser ? fetch(`/borrows/active/user/${currentUser.id}`) : Promise.resolve(null)
    ]);
    allBooks = await booksRes.json();
    if (myBorrowsRes) {
        const myBorrows = await myBorrowsRes.json();
        myBorrowedCodes = new Set(myBorrows.map(r => r.book_code));
    }
    currentPage = 1;
    renderTable();
}

// ── Books: Filter & Sort ───────────────────────────────────────────────────

function getFilteredBooks() {
    const query = (document.getElementById("searchInput")?.value || "").toLowerCase();
    if (!query) return [...allBooks];
    return allBooks.filter(b =>
        [b.title, b.author, b.category, b.dewey_decimal, b.book_code]
            .some(v => (v || "").toLowerCase().includes(query))
    );
}

function getSortedBooks(books) {
    if (!sortState.length) return books;
    return [...books].sort((a, b) => {
        for (const { col, dir } of sortState) {
            const isAdmin = currentUser?.role === "admin";
            let va, vb;
            if (col === "status") {
                const statusOf = (b) => {
                    if (isAdmin) return b.available === 0 ? "Unavailable" : b.available < b.stock ? "Borrowed" : "Available";
                    return myBorrowedCodes.has(b.book_code) ? "Borrowed" : b.available === 0 ? "Unavailable" : "Available";
                };
                va = statusOf(a); vb = statusOf(b);
            } else {
                va = a[col] ?? ""; vb = b[col] ?? "";
            }
            if (!isNaN(Number(va)) && !isNaN(Number(vb))) {
                va = Number(va); vb = Number(vb);
            } else {
                va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
            }
            if (va < vb) return dir === "asc" ? -1 : 1;
            if (va > vb) return dir === "asc" ? 1 : -1;
        }
        return 0;
    });
}

function toggleSort(col) {
    const idx = sortState.findIndex(s => s.col === col);
    if (idx === -1) {
        sortState.push({ col, dir: "asc" });
    } else if (sortState[idx].dir === "asc") {
        sortState[idx].dir = "desc";
    } else {
        sortState.splice(idx, 1);
    }
    renderSortTags();
    renderTable();
}

function removeSort(col) {
    sortState = sortState.filter(s => s.col !== col);
    renderSortTags();
    renderTable();
}

function renderSortTags() {
    const container = document.getElementById("sortTags");
    if (!container) return;
    container.innerHTML = sortState.map((s, i) =>
        `<span class="sort-tag">${i + 1}. ${s.col} ${s.dir === "asc" ? "↑" : "↓"}
         <span class="sort-tag-remove" onclick="removeSort('${s.col}')">✕</span></span>`
    ).join("");
    document.querySelectorAll("#bookTable th.sortable").forEach(th => {
        const s = sortState.find(x => x.col === th.dataset.col);
        const icon = th.querySelector(".sort-icon");
        if (!icon) return;
        icon.textContent = s ? (s.dir === "asc" ? " ↑" : " ↓") : "";
        th.classList.toggle("sort-active", !!s);
    });
}

// ── Books: Render Table ────────────────────────────────────────────────────

function renderTable() {
    const filtered = getSortedBooks(getFilteredBooks());
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const page = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const tbody = document.querySelector("#bookTable tbody");
    tbody.innerHTML = "";
    const isAdmin = currentUser?.role === "admin";

    page.forEach(book => {
        const avail = book.available > 0;
        const row = document.createElement("tr");
        row.id = `row-${book.book_code}`;
        if (selectedBookCode === book.book_code) row.classList.add("selected");

        const borrowed = book.stock - book.available;
        const iHaveit = myBorrowedCodes.has(book.book_code);
        let statusLabel, statusClass;
        if (iHaveit)                    { statusLabel = "Borrowed";    statusClass = "status-borrowed"; }
        else if (book.available === 0)  { statusLabel = "Unavailable"; statusClass = "unavailable"; }
        else                            { statusLabel = "Available";   statusClass = "available"; }
        // Admin always uses objective state
        let adminStatusLabel, adminStatusClass;
        if (book.available === 0)       { adminStatusLabel = "Unavailable"; adminStatusClass = "unavailable"; }
        else if (borrowed > 0)          { adminStatusLabel = "Borrowed";    adminStatusClass = "status-borrowed"; }
        else                            { adminStatusLabel = "Available";   adminStatusClass = "available"; }
        const statusBadge = isAdmin
            ? `<span class="badge ${adminStatusClass}">${adminStatusLabel}</span>`
            : `<span class="badge ${statusClass}">${statusLabel}</span>`;
        const availCount = book.available;
        const stockClass = availCount >= 5 ? "stock-high" : availCount >= 2 ? "stock-mid" : "stock-low";
        const stockBadge = `<span class="badge ${stockClass}">${availCount}</span>`;

        let borrowedByCell = "";
        if (isAdmin && borrowed > 0) {
            if (borrowed === 1) {
                borrowedByCell = `<span class="borrowed-by-label">Borrowed by <a href="#" class="borrowed-by-link" onclick="showBorrowersForBook('${book.book_code}',${book.stock}); return false;" id="bbl-${book.book_code}">loading…</a></span>`;
            } else {
                borrowedByCell = `<span class="borrowed-by-label"><a href="#" class="borrowed-by-link" onclick="showBorrowersForBook('${book.book_code}',${book.stock}); return false;">Check who borrowed</a></span>`;
            }
        }

        const actionsCell = isAdmin ? (bulkMode
            ? ""
            : `<td class="actions-cell">
            <button class="icon-btn" title="Edit" onclick="editBookPrompt('${book.book_code}')">&#9998;</button>
            <button class="icon-btn btn-danger-icon" title="Delete" onclick="deleteBook('${book.book_code}')">&#128465;</button>
            ${borrowedByCell}
        </td>`) : "";

        row.innerHTML = `
            ${bulkMode ? `<td class="bulk-check-cell"><input type="checkbox" class="bulk-cb" data-code="${book.book_code}" ${bulkSelected.has(book.book_code) ? "checked" : ""} onchange="onBulkCheck(this)"></td>` : ""}
            <td>${book.book_code}</td>
            <td>${book.title}</td>
            <td>${book.author}</td>
            <td>${book.year || ""}</td>
            <td>${book.category || ""}</td>
            <td>${book.dewey_decimal || ""}</td>
            ${isAdmin && !bulkMode ? `<td>${book.stock}</td>` : ""}
            <td>${statusBadge}</td>
            ${!isAdmin ? `<td>${stockBadge}</td>` : ""}
            ${actionsCell}
        `;
        row.addEventListener("click", e => {
            if (e.target.closest("button") || e.target.closest("a")) return;
            if (bulkMode) {
                const cb = row.querySelector(".bulk-cb");
                if (cb && e.target !== cb) { cb.checked = !cb.checked; onBulkCheck(cb); }
                return;
            }
            toggleSelectedBook(book.book_code);
        });
        tbody.appendChild(row);
    });

    // Populate single-borrower labels
    if (isAdmin) populateSingleBorrowerLabels(page);

    renderPagination(totalPages);
}

async function populateSingleBorrowerLabels(page) {
    const res = await fetch("/borrows/active");
    const active = await res.json();
    page.forEach(book => {
        const link = document.getElementById(`bbl-${book.book_code}`);
        if (!link) return;
        const forBook = active.filter(r => r.book_code === book.book_code);
        if (forBook.length === 1) {
            const b = forBook[0];
            const num = b.student_number || b.employee_number || b.name;
            link.textContent = num;
        }
    });
}

// ── Books: Pagination ──────────────────────────────────────────────────────

function renderPagination(totalPages) {
    const html = (() => {
        if (totalPages <= 1) return "";
        let h = `<button onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;
        for (let i = 1; i <= totalPages; i++) {
            h += `<button onclick="goPage(${i})" class="${i === currentPage ? "page-active" : ""}">${i}</button>`;
        }
        h += `<button onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""}>›</button>`;
        return h;
    })();
    const top = document.getElementById("paginationTop");
    const bot = document.getElementById("pagination");
    if (top) top.innerHTML = html;
    if (bot) bot.innerHTML = html;
}

function goPage(p) {
    const totalPages = Math.max(1, Math.ceil(getFilteredBooks().length / PAGE_SIZE));
    currentPage = Math.max(1, Math.min(p, totalPages));
    renderTable();
}

// ── Books: Selection ───────────────────────────────────────────────────────

function toggleSelectedBook(book_code) {
    if (selectedBookCode === book_code) {
        selectedBookCode = null;
        document.querySelectorAll("#bookTable tbody tr").forEach(r => r.classList.remove("selected"));
    } else {
        selectedBookCode = book_code;
        document.querySelectorAll("#bookTable tbody tr").forEach(r => r.classList.remove("selected"));
        const row = document.getElementById(`row-${book_code}`);
        if (row) row.classList.add("selected");
    }
}

// ── Borrow ─────────────────────────────────────────────────────────────────

async function borrowBook() {
    if (!selectedBookCode) return showInfo("No Book Selected", "Please select a book from the table first.");
    const book = allBooks.find(b => b.book_code === selectedBookCode);
    if (!book || book.available <= 0) return showInfo("Unavailable", "There are no available copies of this book.");

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);
    const dueDateStr = dueDate.toISOString().split("T")[0];

    const res = await fetch("/borrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_code: selectedBookCode, user_id: currentUser.id, due_date: dueDateStr })
    });
    const data = await res.json();
    if (!res.ok) return showInfo("Cannot Borrow", data.error);
    showToast(`Borrowed! Due: ${dueDate.toLocaleDateString()}`);
    loadBooks();
}

// ── Return ─────────────────────────────────────────────────────────────────

function showReturnPanel() {
    if (!selectedBookCode) return showInfo("No Book Selected", "Please select a book from the table first.");
    const book = allBooks.find(b => b.book_code === selectedBookCode);
    if (book && book.available === book.stock) return showInfo("Not Borrowed", "This book is not currently borrowed by anyone.");
    document.getElementById("returningBookCode").textContent = selectedBookCode;
    document.getElementById("returnDateInput").value = new Date().toISOString().split("T")[0];
    document.getElementById("returnMessage").textContent = "";
    document.getElementById("returnPanel").style.display = "block";
}

function cancelReturn() {
    document.getElementById("returnPanel").style.display = "none";
    document.getElementById("returnMessage").textContent = "";
}

async function confirmReturn() {
    const returnDateStr = document.getElementById("returnDateInput").value;
    const msg = document.getElementById("returnMessage");
    if (!returnDateStr) {
        msg.style.color = "#e65100";
        msg.textContent = "Please select a return date.";
        return;
    }

    const res = await fetch(`/borrow_records?book_code=${selectedBookCode}&user_id=${currentUser.id}`);
    const records = await res.json();
    if (!records.length) {
        msg.style.color = "#e65100";
        msg.textContent = "No active borrow record found for this book.";
        return;
    }

    const record = records[0];
    const returnDate = new Date(returnDateStr);
    const dueDate = new Date(record.due_date);
    const overdueDays = Math.max(0, Math.floor((returnDate - dueDate) / 86400000));

    await fetch("/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_code: selectedBookCode, user_id: currentUser.id, return_date: returnDateStr })
    });

    if (overdueDays > 0) {
        const fee = overdueDays * FEE_PER_DAY;
        msg.style.color = "#e65100";
        msg.textContent = `⚠️ Overdue by ${overdueDays} day(s). Fee: ₱${fee}`;
        addFeeRow(selectedBookCode, record, returnDateStr, overdueDays, fee);
    } else {
        msg.style.color = "#2e7d32";
        msg.textContent = "✓ Returned on time. No overdue fees.";
    }

    loadBooks();
    setTimeout(() => {
        document.getElementById("returnPanel").style.display = "none";
        msg.textContent = "";
    }, 3500);
}

function addFeeRow(book_code, record, returnDate, overdueDays, fee) {
    const feeList = document.getElementById("feeList");
    if (!feeList) return;
    const row = document.createElement("tr");
    row.innerHTML = `
        <td>${book_code}</td>
        <td>${new Date(record.due_date).toLocaleDateString()}</td>
        <td>${new Date(returnDate).toLocaleDateString()}</td>
        <td>${overdueDays} day(s)</td>
        <td style="color:#e65100; font-weight:600;">₱${fee}</td>
    `;
    feeList.appendChild(row);
    document.getElementById("feesSection").style.display = "block";
}

// ── Admin: Add / Edit / Delete Books ──────────────────────────────────────

function onCategoryChange() {
    const sel = document.getElementById("category");
    const newInput = document.getElementById("newCategoryInput");
    if (sel.value === "__new__") {
        newInput.style.display = "inline-block";
        newInput.focus();
    } else {
        newInput.style.display = "none";
        newInput.value = "";
    }
}

async function addBook() {
    if (selectedBookCode) return showInfo("Book Selected", "A book is currently selected. Deselect it or use Edit Selected.");
    const title = document.getElementById("title").value.trim();
    const author = document.getElementById("author").value.trim();
    const year = document.getElementById("year").value.trim();
    const catSel = document.getElementById("category").value;
    const newCatInput = document.getElementById("newCategoryInput").value.trim();
    const category = catSel === "__new__" ? newCatInput : catSel;
    const dewey_decimal = document.getElementById("dewey_decimal").value.trim();
    const stock = document.getElementById("stock").value.trim();

    if (!title || !author || !year || !category) return showInfo("Missing Fields", "Please fill in all required fields.");

    // Check if this is a new category — preview prefix and confirm
    const previewRes = await fetch(`/books/preview-prefix?category=${encodeURIComponent(category)}`);
    const preview = await previewRes.json();

    if (preview.isNew) {
        document.getElementById("newCatMessage").innerHTML =
            `You are creating a new category named <strong>"${category}"</strong>.<br>
             Books in this category will use the prefix <strong>"${preview.prefix}"</strong> for their IDs (e.g. ${preview.prefix}-001).<br><br>
             Do you want to proceed?`;
        document.getElementById("newCatConfirmBtn").onclick = () => {
            closeNewCatModal();
            doAddBook(title, author, year, category, dewey_decimal, stock);
        };
        document.getElementById("newCatModal").style.display = "flex";
    } else {
        doAddBook(title, author, year, category, dewey_decimal, stock);
    }
}

async function doAddBook(title, author, year, category, dewey_decimal, stock) {
    const res = await fetch("/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            title, author, year, category, dewey_decimal, stock,
            actor_id: currentUser.id, actor_name: currentUser.name
        })
    });
    const data = await res.json();
    if (!res.ok) return showInfo("Error", data.error);
    showToast(`Book "${title}" added as ${data.book_code}`);
    clearBookForm();
    loadBooks();
}

async function editBookPrompt(book_code) {
    const book = await fetch(`/books/${book_code}`).then(r => r.json());
    document.getElementById("title").value = book.title;
    document.getElementById("author").value = book.author;
    document.getElementById("year").value = book.year;
    document.getElementById("dewey_decimal").value = book.dewey_decimal || "";
    document.getElementById("stock").value = book.stock || 1;

    const catSel = document.getElementById("category");
    const newInput = document.getElementById("newCategoryInput");
    // Check if category is in the select options
    const opt = [...catSel.options].find(o => o.value === book.category);
    if (opt) {
        catSel.value = book.category;
        newInput.style.display = "none";
        newInput.value = "";
    } else {
        catSel.value = "__new__";
        newInput.style.display = "inline-block";
        newInput.value = book.category;
    }

    toggleSelectedBook(book_code);
    // Ensure selected even if already was selected
    selectedBookCode = book_code;
    document.querySelectorAll("#bookTable tbody tr").forEach(r => r.classList.remove("selected"));
    const row = document.getElementById(`row-${book_code}`);
    if (row) row.classList.add("selected");
}

async function editBook() {
    if (!selectedBookCode) return showInfo("No Book Selected", "Please select a book to edit first.");
    const title = document.getElementById("title").value.trim();
    const author = document.getElementById("author").value.trim();
    const year = document.getElementById("year").value.trim();
    const catSel = document.getElementById("category").value;
    const newCatInput = document.getElementById("newCategoryInput").value.trim();
    const category = catSel === "__new__" ? newCatInput : catSel;
    const dewey_decimal = document.getElementById("dewey_decimal").value.trim();
    const stock = document.getElementById("stock").value.trim();

    const res = await fetch(`/books/${selectedBookCode}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            title, author, year, category, dewey_decimal, stock,
            actor_id: currentUser.id, actor_name: currentUser.name
        })
    });
    const data = await res.json();
    if (!res.ok) return showInfo("Error", data.error);
    showToast("Book updated successfully.");
    clearBookForm();
    loadBooks();
}

async function deleteBook(book_code) {
    showConfirm(
        "Delete Book",
        `Are you sure you want to delete <strong>${book_code}</strong>? This cannot be undone.`,
        async () => {
            const res = await fetch(`/books/${book_code}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ actor_id: currentUser.id, actor_name: currentUser.name })
            });
            if (!res.ok) { const d = await res.json(); return showInfo("Error", d.error); }
            if (selectedBookCode === book_code) clearBookForm();
            showToast("Book deleted.");
            loadBooks();
        }
    );
}

function clearBookForm() {
    ["title", "author", "year", "dewey_decimal"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    const stockEl = document.getElementById("stock");
    if (stockEl) stockEl.value = "1";
    const cat = document.getElementById("category");
    if (cat) cat.value = "";
    const newCat = document.getElementById("newCategoryInput");
    if (newCat) { newCat.value = ""; newCat.style.display = "none"; }
    selectedBookCode = null;
    document.querySelectorAll("#bookTable tbody tr").forEach(r => r.classList.remove("selected"));
}

function closeNewCatModal() {
    document.getElementById("newCatModal").style.display = "none";
}

// ── Admin: Borrowed-By ─────────────────────────────────────────────────────

async function showBorrowersForBook(book_code, stock) {
    const res = await fetch("/borrows/active");
    const active = await res.json();
    const forBook = active.filter(r => r.book_code === book_code);
    if (!forBook.length) return showInfo("No Borrowers", "No active borrowers found for this book.");

    if (forBook.length === 1 && stock === 1) {
        // Single stock, single borrower — go straight to profile
        openUserModal(forBook[0].user_id);
        return;
    }

    // Multi-borrower table modal
    const today = new Date();
    const tbody = document.querySelector("#borrowersTable tbody");
    tbody.innerHTML = forBook.map(b => {
        const due = new Date(b.due_date);
        const overdueDays = Math.max(0, Math.floor((today - due) / 86400000));
        const fee = overdueDays > 0 ? `<span style="color:#e65100;font-weight:600;">₱${overdueDays * FEE_PER_DAY}</span>` : `<span style="color:#2e7d32;">None</span>`;
        const num = b.student_number || b.employee_number || "—";
        return `<tr>
            <td><a href="#" class="borrowed-by-link" onclick="closeBorrowersModal(); openUserModal(${b.user_id}); return false;">${num}</a></td>
            <td>${b.email}</td>
            <td>${new Date(b.borrow_date).toLocaleDateString()}</td>
            <td>${due.toLocaleDateString()}</td>
            <td>${fee}</td>
        </tr>`;
    }).join("");

    document.getElementById("borrowersModalTitle").textContent = `Borrowers of ${book_code}`;
    document.getElementById("borrowersModal").style.display = "flex";
}

function closeBorrowersModal() {
    document.getElementById("borrowersModal").style.display = "none";
}

// ── Admin: User Dashboard ──────────────────────────────────────────────────

async function searchUsers() {
    const q = document.getElementById("userSearchInput").value.trim();
    if (!q) return;
    const res = await fetch(`/users/search?q=${encodeURIComponent(q)}`);
    const users = await res.json();
    const container = document.getElementById("userSearchResults");
    if (!users.length) {
        container.innerHTML = `<p style="font-size:13px; color:#999; margin:0;">No users found.</p>`;
        return;
    }
    container.innerHTML = `<table>
        <thead><tr><th>Name</th><th>Role</th><th>Number</th><th>Email</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map(u => `
            <tr>
                <td>${u.name}</td>
                <td>${u.user_type}</td>
                <td>${u.student_number || u.employee_number || "—"}</td>
                <td>${u.email}</td>
                <td>${u.banned ? `<span class="badge unavailable">Banned</span>` : `<span class="badge available">Active</span>`}</td>
                <td><a href="#" class="borrowed-by-link" onclick="openUserModal(${u.id}); return false;">View</a></td>
            </tr>`).join("")}
        </tbody>
    </table>`;
}

// ── Admin: User Modal ──────────────────────────────────────────────────────

let _modalUserId = null;

async function openUserModal(userId) {
    _modalUserId = userId;
    const [user, borrows] = await Promise.all([
        fetch(`/users/${userId}`).then(r => r.json()),
        fetch(`/users/${userId}/borrows`).then(r => r.json())
    ]);

    document.getElementById("modalUserName").textContent = user.name;
    document.getElementById("modalUserMeta").textContent =
        `${user.user_type} · ${user.student_number || user.employee_number || ""} · ${user.email}`;

    // Ban / Unban button
    const banDiv = document.getElementById("modalBanActions");
    if (user.banned) {
        banDiv.innerHTML = `
            <span class="badge unavailable" style="align-self:center;">Banned</span>
            <button onclick="unbanUser(${userId})" style="font-size:12px; padding:6px 14px;">Unban User</button>`;
    } else {
        banDiv.innerHTML = `
            <button onclick="banUser(${userId})" class="btn-ban" style="font-size:12px; padding:6px 14px;">Ban User</button>`;
    }

    const today = new Date();
    const active = borrows.filter(b => !b.return_date);
    const history = borrows.filter(b => b.return_date);

    // Active borrows
    const activeTbody = document.querySelector("#modalActiveBorrows tbody");
    activeTbody.innerHTML = active.length
        ? active.map(b => `<tr>
            <td>${b.book_code}</td>
            <td>${b.title}</td>
            <td>${new Date(b.borrow_date).toLocaleDateString()}</td>
            <td>${new Date(b.due_date).toLocaleDateString()}</td>
          </tr>`).join("")
        : `<tr><td colspan="4" style="color:#aaa;text-align:center;">None</td></tr>`;

    // Outstanding fees: returned overdue unpaid + still borrowed overdue
    const feeRows = [];
    history.forEach(b => {
        const due = new Date(b.due_date);
        const ret = new Date(b.return_date);
        if (ret > due && !b.fee_paid) feeRows.push({ ...b, days: Math.floor((ret - due) / 86400000), live: false });
    });
    active.forEach(b => {
        const due = new Date(b.due_date);
        const days = Math.max(0, Math.floor((today - due) / 86400000));
        if (days > 0) feeRows.push({ ...b, days, live: true });
    });

    const feesTbody = document.querySelector("#modalFees tbody");
    feesTbody.innerHTML = feeRows.length
        ? feeRows.map(b => {
            const fee = b.days * FEE_PER_DAY;
            const statusCell = b.live
                ? `<span style="color:#e65100;font-size:11px;">Ongoing</span>`
                : `<button onclick="markFeePaid(${userId},${b.id},this)" style="font-size:11px;padding:4px 10px;">Mark Paid</button>`;
            return `<tr>
                <td>${b.book_code}</td>
                <td>${b.title}</td>
                <td>${b.days} day(s)</td>
                <td style="color:#e65100;font-weight:600;">₱${fee}</td>
                <td>${statusCell}</td>
            </tr>`;
          }).join("")
        : `<tr><td colspan="5" style="color:#aaa;text-align:center;">No outstanding fees</td></tr>`;

    // History
    const histTbody = document.querySelector("#modalHistory tbody");
    histTbody.innerHTML = history.length
        ? history.map(b => `<tr>
            <td>${b.book_code}</td>
            <td>${b.title}</td>
            <td>${new Date(b.borrow_date).toLocaleDateString()}</td>
            <td>${new Date(b.return_date).toLocaleDateString()}</td>
          </tr>`).join("")
        : `<tr><td colspan="4" style="color:#aaa;text-align:center;">No history</td></tr>`;

    document.getElementById("userModal").style.display = "flex";
}

async function markFeePaid(userId, borrowId, btn) {
    await fetch(`/users/${userId}/borrows/${borrowId}/pay`, { method: "POST" });
    btn.closest("td").innerHTML = `<span style="color:#2e7d32;font-size:11px;font-weight:600;">Paid</span>`;
}

function closeUserModal() {
    document.getElementById("userModal").style.display = "none";
    _modalUserId = null;
}

async function banUser(userId) {
    showConfirm(
        "Ban User",
        "Are you sure you want to ban this user? They will be unable to log in.",
        async () => {
            await fetch(`/users/${userId}/ban`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ actor_id: currentUser.id, actor_name: currentUser.name })
            });
            showToast("User has been banned.");
            closeUserModal();
            searchUsers();
        }
    );
}

async function unbanUser(userId) {
    showConfirm(
        "Unban User",
        "Are you sure you want to unban this user?",
        async () => {
            await fetch(`/users/${userId}/unban`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ actor_id: currentUser.id, actor_name: currentUser.name })
            });
            showToast("User has been unbanned.");
            closeUserModal();
            searchUsers();
        }
    );
}

// ── Admin: Add User Modal ──────────────────────────────────────────────────

function openAddUserModal() {
    document.getElementById("newUserRole").value = "";
    document.getElementById("newUserName").value = "";
    document.getElementById("newUserNumber").value = "";
    document.getElementById("newUserEmail").value = "";
    document.getElementById("addUserError").style.display = "none";
    document.getElementById("addUserModal").style.display = "flex";
}

function closeAddUserModal() {
    document.getElementById("addUserModal").style.display = "none";
}

async function submitAddUser() {
    const role = document.getElementById("newUserRole").value;
    const name = document.getElementById("newUserName").value.trim();
    const number = document.getElementById("newUserNumber").value.trim();
    const email = document.getElementById("newUserEmail").value.trim();
    const errEl = document.getElementById("addUserError");

    if (!role || !name || !number || !email) {
        errEl.textContent = "All fields are required.";
        errEl.style.display = "block";
        return;
    }

    const res = await fetch("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            user_type: role,
            name,
            email,
            student_number: role === "student" ? number : null,
            employee_number: role !== "student" ? number : null,
            actor_id: currentUser.id,
            actor_name: currentUser.name
        })
    });
    const data = await res.json();
    if (!res.ok) {
        errEl.textContent = data.error;
        errEl.style.display = "block";
        return;
    }
    closeAddUserModal();
    showToast(`User "${data.name}" added successfully.`);
    searchUsers();
}

// ── Admin: Audit Log ───────────────────────────────────────────────────────

function downloadAuditLog() {
    window.location.href = "/audit-log/download";
}

// ── Admin: Bulk Select ─────────────────────────────────────────────────────

function toggleBulkMode() {
    bulkMode = !bulkMode;
    bulkSelected.clear();
    selectedBookCode = null;

    const bar = document.getElementById("bulkBar");
    const btn = document.getElementById("bulkToggleBtn");
    const checkAllTh = document.getElementById("bulkCheckAllTh");
    const cols = document.querySelectorAll("#bookTable colgroup col");
    // col indices: 0=bulk, 1=ID, 2=Title, 3=Author, 4=Year, 5=Category, 6=Dewey, 7=Stock, 8=Status, 9=Actions
    const stockTh = document.querySelector("#bookTable thead th:nth-child(9)");  // Stock th (after bulk col shown)
    const actionsTh = document.querySelector("#bookTable thead th:last-child");

    if (bulkMode) {
        bar.style.display = "flex";
        btn.style.display = "none";
        if (checkAllTh) checkAllTh.style.display = "";
        if (cols[7]) cols[7].style.display = "none";
        if (cols[9]) cols[9].style.display = "none";
        document.getElementById("thStock").style.display = "none";
        document.getElementById("thActions").style.display = "none";
    } else {
        bar.style.display = "none";
        btn.style.display = "";
        if (checkAllTh) checkAllTh.style.display = "none";
        const checkAll = document.getElementById("checkAll");
        if (checkAll) checkAll.checked = false;
        if (cols[7]) cols[7].style.display = "";
        if (cols[9]) cols[9].style.display = "";
        document.getElementById("thStock").style.display = "";
        document.getElementById("thActions").style.display = "";
    }
    updateBulkBar();
    renderTable();
}

function onBulkCheck(cb) {
    const code = cb.dataset.code;
    if (cb.checked) bulkSelected.add(code);
    else bulkSelected.delete(code);
    updateBulkBar();
    const page = getSortedBooks(getFilteredBooks())
        .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const checkAll = document.getElementById("checkAll");
    if (checkAll) checkAll.checked = page.length > 0 && page.every(b => bulkSelected.has(b.book_code));
}

function toggleCheckAll(cb) {
    const page = getSortedBooks(getFilteredBooks())
        .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    page.forEach(b => {
        if (cb.checked) bulkSelected.add(b.book_code);
        else bulkSelected.delete(b.book_code);
    });
    updateBulkBar();
    renderTable();
}

function updateBulkBar() {
    const count = bulkSelected.size;
    const countEl = document.getElementById("bulkCount");
    const editBtn = document.getElementById("bulkEditBtn");
    const delBtn = document.getElementById("bulkDeleteBtn");
    if (countEl) countEl.textContent = `${count} selected`;
    if (editBtn) editBtn.disabled = count === 0;
    if (delBtn) delBtn.disabled = count === 0;
}

function openBulkEditModal() {
    if (!bulkSelected.size) return;
    document.getElementById("bulkCategory").value = "";
    document.getElementById("bulkNewCategory").value = "";
    document.getElementById("bulkNewCategory").style.display = "none";
    document.getElementById("bulkAuthor").value = "";
    document.getElementById("bulkDewey").value = "";
    document.getElementById("bulkStock").value = "";
    document.getElementById("bulkEditError").style.display = "none";
    document.getElementById("bulkEditModal").style.display = "flex";
}

function closeBulkEditModal() {
    document.getElementById("bulkEditModal").style.display = "none";
}

function onBulkCategoryChange() {
    const sel = document.getElementById("bulkCategory");
    const inp = document.getElementById("bulkNewCategory");
    if (sel.value === "__new__") { inp.style.display = "block"; inp.focus(); }
    else { inp.style.display = "none"; inp.value = ""; }
}

async function submitBulkEdit() {
    const catSel = document.getElementById("bulkCategory").value;
    const newCat = document.getElementById("bulkNewCategory").value.trim();
    const category = catSel === "__new__" ? (newCat || null) : (catSel || null);
    const author = document.getElementById("bulkAuthor").value.trim() || null;
    const dewey_decimal = document.getElementById("bulkDewey").value.trim() || null;
    const stockRaw = document.getElementById("bulkStock").value.trim();
    const stock = stockRaw ? Math.min(9999, Math.max(1, parseInt(stockRaw))) : null;
    const errEl = document.getElementById("bulkEditError");

    if (!category && !author && !dewey_decimal && !stock) {
        errEl.textContent = "Please fill in at least one field to update.";
        errEl.style.display = "block";
        return;
    }
    errEl.style.display = "none";

    const codes = [...bulkSelected];
    let successCount = 0;
    await Promise.all(codes.map(async code => {
        const book = allBooks.find(b => b.book_code === code);
        if (!book) return;
        const res = await fetch(`/books/${code}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: book.title,
                author: author ?? book.author,
                year: book.year,
                category: category ?? book.category,
                dewey_decimal: dewey_decimal ?? book.dewey_decimal,
                stock: stock ?? book.stock,
                actor_id: currentUser.id,
                actor_name: currentUser.name
            })
        });
        if (res.ok) successCount++;
    }));

    closeBulkEditModal();
    toggleBulkMode();
    showToast(`${successCount} book(s) updated successfully.`);
    loadBooks();
}

async function bulkDelete() {
    if (!bulkSelected.size) return;
    const count = bulkSelected.size;
    showConfirm(
        "Bulk Delete",
        `Are you sure you want to delete <strong>${count} book(s)</strong>? This cannot be undone.`,
        async () => {
            const codes = [...bulkSelected];
            await Promise.all(codes.map(code =>
                fetch(`/books/${code}`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ actor_id: currentUser.id, actor_name: currentUser.name })
                })
            ));
            toggleBulkMode();
            showToast(`${count} book(s) deleted.`);
            loadBooks();
        }
    );
}

// ── UI Utilities ───────────────────────────────────────────────────────────

let _toastTimer = null;
function showToast(message, duration = 3000) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("toast-show");
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove("toast-show"), duration);
}

function showInfo(title, message) {
    const modal = document.getElementById("infoModal");
    if (!modal) { return; }
    document.getElementById("infoTitle").textContent = title;
    document.getElementById("infoMessage").innerHTML = message;
    modal.style.display = "flex";
}

function closeInfoModal() {
    const modal = document.getElementById("infoModal");
    if (modal) modal.style.display = "none";
}

function showConfirm(title, message, onConfirm) {
    const modal = document.getElementById("confirmModal");
    if (!modal) { if (confirm(message)) onConfirm(); return; }
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").innerHTML = message;
    modal.style.display = "flex";

    const okBtn = document.getElementById("confirmOk");
    const cancelBtn = document.getElementById("confirmCancel");

    const cleanup = () => { modal.style.display = "none"; okBtn.onclick = null; cancelBtn.onclick = null; };
    okBtn.onclick = () => { cleanup(); onConfirm(); };
    cancelBtn.onclick = cleanup;
}

// ── Auth ───────────────────────────────────────────────────────────────────

function logout() {
    sessionStorage.removeItem("currentUser");
    window.location.href = "index.html";
}
