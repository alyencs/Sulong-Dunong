import express from "express";
import cors from "cors";
import { createClient } from "@libsql/client";
import { readFileSync } from "fs";

try {
  readFileSync(".env", "utf8").split("\n").forEach(line => {
    const [k, ...rest] = line.split("=");
    if (k && rest.length) process.env[k.trim()] = rest.join("=").trim();
  });
} catch {}

const SCHOOL_DOMAIN = process.env.SCHOOL_EMAIL_DOMAIN || "school.edu.ph";
const PORT = process.env.PORT || 3000;
const FEE_PER_DAY = 20;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ── DB helpers (libsql compat) ────────────────────────────────────────────

async function dbRun(sql, args = []) {
  return db.execute({ sql, args });
}

async function dbGet(sql, args = []) {
  const res = await db.execute({ sql, args });
  return res.rows[0] ?? null;
}

async function dbAll(sql, args = []) {
  const res = await db.execute({ sql, args });
  return res.rows;
}

// ── Schema ─────────────────────────────────────────────────────────────────

await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_type TEXT NOT NULL,
    name TEXT NOT NULL,
    student_number TEXT UNIQUE,
    employee_number TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE,
    banned INTEGER DEFAULT 0
)`);

await dbRun(`CREATE TABLE IF NOT EXISTS books (
    book_code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    year INTEGER,
    category TEXT,
    stock INTEGER DEFAULT 1,
    available INTEGER DEFAULT 1,
    dewey_decimal TEXT
)`);

await dbRun(`CREATE TABLE IF NOT EXISTS borrow_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_code TEXT,
    user_id INTEGER,
    borrow_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    due_date DATE,
    return_date DATETIME,
    fee_paid INTEGER DEFAULT 0,
    FOREIGN KEY (book_code) REFERENCES books(book_code),
    FOREIGN KEY (user_id) REFERENCES users(id)
)`);

await dbRun(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    actor_name TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Migrations
try { await dbRun(`ALTER TABLE books ADD COLUMN stock INTEGER DEFAULT 1`); } catch {}
try { await dbRun(`ALTER TABLE borrow_records ADD COLUMN fee_paid INTEGER DEFAULT 0`); } catch {}
try { await dbRun(`ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0`); } catch {}

// Seed books only if table is empty
const bookCount = await dbGet("SELECT COUNT(*) as c FROM books");
if (bookCount.c === 0) {
  await dbRun(`
  INSERT INTO books (book_code, title, author, year, category, stock, available, dewey_decimal) VALUES
  ('SB-001', 'Noli Me Tángere', 'José Rizal', 1887, 'Storybooks', 7, 7, '899.211'),
  ('SB-002', 'Ilustrado', 'Miguel Syjuco', 2008, 'Storybooks', 12, 12, '823.92'),
  ('SB-003', 'Alamat ng Ampalaya', 'Augie Rivera', 1997, 'Storybooks', 5, 5, '899.211'),
  ('SB-004', 'Florante at Laura', 'Francisco Balagtas', 1838, 'Storybooks', 9, 9, '899.211'),
  ('SB-005', 'Dekada ''70', 'Lualhati Bautista', 1983, 'Storybooks', 6, 6, '899.211'),
  ('SB-006', 'The Little Prince', 'Antoine de Saint-Exupéry', 1943, 'Storybooks', 14, 14, '843'),
  ('SB-007', 'Harry Potter and the Sorcerer''s Stone', 'J.K. Rowling', 1997, 'Storybooks', 11, 11, '823.914'),
  ('SB-008', 'To Kill a Mockingbird', 'Harper Lee', 1960, 'Storybooks', 4, 4, '813.54'),
  ('SB-009', '1984', 'George Orwell', 1949, 'Storybooks', 8, 8, '823.912'),
  ('SB-010', 'Animal Farm', 'George Orwell', 1945, 'Storybooks', 10, 10, '823.912'),

  ('RM-001', 'Merriam-Webster''s Dictionary', 'Merriam-Webster', 1843, 'Reference Materials', 3, 3, '423'),
  ('RM-002', 'Encyclopædia Britannica', 'Encyclopaedia Britannica', 1910, 'Reference Materials', 13, 13, '030'),
  ('RM-003', 'The World Almanac', 'Sarah Janssen', 2024, 'Reference Materials', 6, 6, '030'),
  ('RM-004', 'Oxford English Dictionary', 'Oxford University Press', 1884, 'Reference Materials', 9, 9, '423'),
  ('RM-005', 'Gray''s Anatomy', 'Henry Gray', 1858, 'Reference Materials', 5, 5, '611'),
  ('RM-006', 'Roget''s Thesaurus', 'Peter Mark Roget', 1852, 'Reference Materials', 7, 7, '423.1'),
  ('RM-007', 'CIA World Factbook', 'CIA', 2023, 'Reference Materials', 12, 12, '910'),

  ('BE-001', 'Closing the Vocabulary Gap', 'Alex Quigley', 2018, 'Basic Education', 8, 8, '372.44'),
  ('BE-002', 'Liberating Learning', 'Santiago Rincón-Gallardo', 2019, 'Basic Education', 6, 6, '371.2'),
  ('BE-003', 'Teaching Computing', 'William Lau', 2017, 'Basic Education', 10, 10, '371.33'),
  ('BE-004', 'How Children Learn', 'John Holt', 1967, 'Basic Education', 4, 4, '370.15'),
  ('BE-005', 'The First Days of School', 'Harry K. Wong', 1998, 'Basic Education', 11, 11, '371.102'),
  ('BE-006', 'Visible Learning', 'John Hattie', 2008, 'Basic Education', 7, 7, '370.72'),
  ('BE-007', 'Teach Like a Champion', 'Doug Lemov', 2010, 'Basic Education', 9, 9, '371.102'),

  ('BT-001', 'Learn to Code with Scratch', 'Raspberry Pi Foundation', 2016, 'Basic Technology', 13, 13, '005.13'),
  ('BT-002', 'Discrete Mathematics', 'Oscar Levin', 2018, 'Basic Technology', 5, 5, '511'),
  ('BT-003', 'Data Science at the Command Line', 'Jeroen Janssens', 2021, 'Basic Technology', 6, 6, '005.7'),
  ('BT-004', 'Clean Code', 'Robert C. Martin', 2008, 'Basic Technology', 14, 14, '005.1'),
  ('BT-005', 'Introduction to Algorithms', 'Thomas H. Cormen', 2009, 'Basic Technology', 12, 12, '005.1'),
  ('BT-006', 'The Pragmatic Programmer', 'Andrew Hunt', 1999, 'Basic Technology', 8, 8, '005.1'),
  ('BT-007', 'Computer Networking Basics', 'Kurose & Ross', 2017, 'Basic Technology', 7, 7, '004.6'),
  ('BT-008', 'Python Crash Course', 'Eric Matthes', 2019, 'Basic Technology', 9, 9, '005.13'),

  ('CM-001', 'The Mythology Class', 'Arnold Arre', 1999, 'Cultural Materials', 4, 4, '741.5959'),
  ('CM-002', 'Filipino Children''s Favorite Stories', 'Liana Romulo', 2020, 'Cultural Materials', 6, 6, '398.2'),
  ('CM-003', 'Philippine Folk Literature', 'Damiana L. Eugenio', 2002, 'Cultural Materials', 5, 5, '398.2'),
  ('CM-004', 'Culture and History of the Philippines', 'Nick Joaquin', 1988, 'Cultural Materials', 11, 11, '959.9'),
  ('CM-005', 'Barangay', 'William Henry Scott', 1994, 'Cultural Materials', 8, 8, '959.9'),
  ('CM-006', 'Philippine Mythology', 'Maximo Ramos', 1990, 'Cultural Materials', 10, 10, '398.2'),

  ('SC-001', 'A Brief History of Time', 'Stephen Hawking', 1988, 'Science', 9, 9, '523.1'),
  ('SC-002', 'The Selfish Gene', 'Richard Dawkins', 1976, 'Science', 6, 6, '576.5'),
  ('SC-003', 'Cosmos', 'Carl Sagan', 1980, 'Science', 12, 12, '520'),
  ('SC-004', 'The Origin of Species', 'Charles Darwin', 1859, 'Science', 7, 7, '575'),
  ('SC-005', 'Silent Spring', 'Rachel Carson', 1962, 'Science', 5, 5, '363.7'),
  ('SC-006', 'Astrophysics for People in a Hurry', 'Neil deGrasse Tyson', 2017, 'Science', 8, 8, '523'),

  ('HI-001', 'Sapiens', 'Yuval Noah Harari', 2011, 'History', 13, 13, '909'),
  ('HI-002', 'Guns, Germs, and Steel', 'Jared Diamond', 1997, 'History', 10, 10, '303.4'),
  ('HI-003', 'The Philippines: A Past Revisited', 'Renato Constantino', 1975, 'History', 6, 6, '959.9'),
  ('HI-004', 'A People''s History of the United States', 'Howard Zinn', 1980, 'History', 4, 4, '973'),
  ('HI-005', 'The Second World War', 'Antony Beevor', 2012, 'History', 9, 9, '940.53'),

  ('PH-001', 'Meditations', 'Marcus Aurelius', 180, 'Philosophy', 7, 7, '188'),
  ('PH-002', 'The Republic', 'Plato', 380, 'Philosophy', 5, 5, '321'),
  ('PH-003', 'Beyond Good and Evil', 'Friedrich Nietzsche', 1886, 'Philosophy', 8, 8, '193'),
  ('PH-004', 'Critique of Pure Reason', 'Immanuel Kant', 1781, 'Philosophy', 6, 6, '121'),
  ('PH-005', 'The Art of War', 'Sun Tzu', 500, 'Philosophy', 11, 11, '355.02');
  `);
}

// Seed users only if table is empty
const userCount = await dbGet("SELECT COUNT(*) as c FROM users");
if (userCount.c === 0) {
  await dbRun(`
  INSERT INTO users (user_type, name, student_number, employee_number, email) VALUES
  ('student', 'Juan Dela Cruz', 'S10101', NULL, 'juan.dela.cruz@school.edu.ph'),
  ('student', 'Maria Santos', 'S10102', NULL, 'maria.santos@school.edu.ph'),
  ('student', 'Jose Reyes', 'S10103', NULL, 'jose.reyes@school.edu.ph'),
  ('student', 'Ana Garcia', 'S10104', NULL, 'ana.garcia@school.edu.ph'),
  ('student', 'Carlo Mendoza', 'S10105', NULL, 'carlo.mendoza@school.edu.ph'),
  ('teacher', 'Ricardo Villanueva', NULL, 'T10101', 'ricardo.villanueva@school.edu.ph'),
  ('teacher', 'Linda Aquino', NULL, 'T10102', 'linda.aquino@school.edu.ph'),
  ('teacher', 'Ernesto Bautista', NULL, 'T10103', 'ernesto.bautista@school.edu.ph'),
  ('teacher', 'Susana Castillo', NULL, 'T10104', 'susana.castillo@school.edu.ph'),
  ('teacher', 'Danilo Flores', NULL, 'T10105', 'danilo.flores@school.edu.ph'),
  ('admin', 'Rosario Lim', NULL, 'E10201', 'rosario.lim@school.edu.ph'),
  ('admin', 'Fernando Cruz', NULL, 'E10202', 'fernando.cruz@school.edu.ph'),
  ('admin', 'Gloria Ramos', NULL, 'E10203', 'gloria.ramos@school.edu.ph'),
  ('admin', 'Benito Torres', NULL, 'E10204', 'benito.torres@school.edu.ph'),
  ('admin', 'Carmen Navarro', NULL, 'E10205', 'carmen.navarro@school.edu.ph');
  `);
}

// ── Helpers ────────────────────────────────────────────────────────────────

const KNOWN_PREFIXES = {
  "Storybooks": "SB",
  "Reference Materials": "RM",
  "Basic Education": "BE",
  "Basic Technology": "BT",
  "Cultural Materials": "CM",
};

// Build base prefix from category name (first letters of each word, up to 2)
function basePrefixFromName(category) {
  const words = category.trim().split(/\s+/);
  return words.map(w => w[0].toUpperCase()).join("").substring(0, 2);
}

// Resolve prefix: if base is taken by a different category, append digit suffix
async function resolvePrefix(category) {
  if (KNOWN_PREFIXES[category]) return KNOWN_PREFIXES[category];

  const base = basePrefixFromName(category);

  const rows = await dbAll("SELECT DISTINCT book_code FROM books");
  const usedPrefixes = new Map();

  for (const [cat, pfx] of Object.entries(KNOWN_PREFIXES)) {
    usedPrefixes.set(pfx, cat);
  }
  for (const row of rows) {
    const pfx = row.book_code.split("-")[0];
    const catRow = await dbGet("SELECT category FROM books WHERE book_code=?", [row.book_code]);
    if (catRow) usedPrefixes.set(pfx, catRow.category);
  }

  if (!usedPrefixes.has(base) || usedPrefixes.get(base) === category) return base;

  let n = 2;
  while (usedPrefixes.has(`${base}${n}`) && usedPrefixes.get(`${base}${n}`) !== category) n++;
  return `${base}${n}`;
}

async function nextBookCode(prefix) {
  const rows = await dbAll("SELECT book_code FROM books WHERE book_code LIKE ?", [`${prefix}-%`]);
  const nums = rows.map(r => {
    const part = r.book_code.split("-")[1];
    return parseInt(part, 10);
  }).filter(n => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  const digits = Math.max(3, String(next).length);
  return `${prefix}-${String(next).padStart(digits, "0")}`;
}

async function logAction(actorId, actorName, action, detail) {
  await dbRun(
    "INSERT INTO audit_log(actor_id, actor_name, action, detail) VALUES(?,?,?,?)",
    [actorId, actorName, action, detail]
  );
}

// ── Config ─────────────────────────────────────────────────────────────────

app.get("/config", (req, res) => res.json({ emailDomain: SCHOOL_DOMAIN }));

// ── Auth ───────────────────────────────────────────────────────────────────

app.post("/login", async (req, res) => {
  const { user_type, student_number, employee_number, email } = req.body;
  if (!user_type || !email) return res.status(400).json({ error: "Missing fields" });

  let user;
  if (user_type === "student") {
    if (!student_number) return res.status(400).json({ error: "Student Number required" });
    user = await dbGet("SELECT * FROM users WHERE user_type='student' AND student_number=? AND email=?", [student_number, email]);
    if (!user) return res.status(401).json({ error: "Invalid student number or email." });
  } else if (user_type === "teacher") {
    if (!employee_number) return res.status(400).json({ error: "Employee Number required" });
    user = await dbGet("SELECT * FROM users WHERE user_type='teacher' AND employee_number=? AND email=?", [employee_number, email]);
    if (!user) return res.status(401).json({ error: "Invalid employee number or email." });
  } else if (user_type === "admin") {
    if (!employee_number) return res.status(400).json({ error: "Employee Number required" });
    user = await dbGet("SELECT * FROM users WHERE user_type='admin' AND employee_number=? AND email=?", [employee_number, email]);
    if (!user) return res.status(401).json({ error: "Invalid employee number or email." });
  } else return res.status(400).json({ error: "Invalid user type" });

  if (user.banned) return res.status(403).json({ error: "You have been banned from accessing Sulong Dunong." });

  res.json({ id: user.id, role: user.user_type, name: user.name, student_number: user.student_number, employee_number: user.employee_number, email: user.email });
});

// ── Books ──────────────────────────────────────────────────────────────────

app.get("/books", async (req, res) => {
  res.json(await dbAll("SELECT * FROM books ORDER BY book_code ASC"));
});

app.get("/books/:book_code", async (req, res) => {
  const book = await dbGet("SELECT * FROM books WHERE book_code=?", [req.params.book_code]);
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.json(book);
});

app.get("/books/preview-prefix", async (req, res) => {
  const { category } = req.query;
  if (!category) return res.status(400).json({ error: "category required" });
  const isNew = !KNOWN_PREFIXES[category] && !(await dbGet("SELECT 1 FROM books WHERE category=?", [category]));
  const prefix = await resolvePrefix(category);
  res.json({ prefix, isNew });
});

app.post("/books", async (req, res) => {
  const { title, author, year, category, dewey_decimal, stock, actor_id, actor_name } = req.body;
  if (!title || !author || !year || !category) return res.status(400).json({ error: "Fill all fields" });

  const exists = await dbGet("SELECT * FROM books WHERE title=? AND author=?", [title, author]);
  if (exists) return res.status(400).json({ error: "Book already exists" });

  const prefix = await resolvePrefix(category);
  const book_code = await nextBookCode(prefix);
  const stockVal = Math.min(9999, parseInt(stock) || 1);

  await dbRun(
    "INSERT INTO books(book_code, title, author, year, category, stock, available, dewey_decimal) VALUES(?,?,?,?,?,?,?,?)",
    [book_code, title, author, year, category, stockVal, stockVal, dewey_decimal || null]
  );

  await logAction(actor_id, actor_name, "ADD_BOOK", `Added book "${title}" (${book_code}), category: ${category}`);
  res.json(await dbGet("SELECT * FROM books WHERE book_code=?", [book_code]));
});

app.put("/books/:book_code", async (req, res) => {
  const { book_code } = req.params;
  const { title, author, year, category, dewey_decimal, stock, actor_id, actor_name } = req.body;
  const book = await dbGet("SELECT * FROM books WHERE book_code=?", [book_code]);
  if (!book) return res.status(404).json({ error: "Book not found" });

  const stockVal = Math.min(9999, parseInt(stock) || book.stock);
  const borrowed = book.stock - book.available;
  const newAvailable = Math.max(0, stockVal - borrowed);

  await dbRun(
    "UPDATE books SET title=?, author=?, year=?, category=?, dewey_decimal=?, stock=?, available=? WHERE book_code=?",
    [title, author, year, category, dewey_decimal || null, stockVal, newAvailable, book_code]
  );

  await logAction(actor_id, actor_name, "EDIT_BOOK", `Edited book ${book_code}: "${title}"`);
  res.json(await dbGet("SELECT * FROM books WHERE book_code=?", [book_code]));
});

app.delete("/books/:book_code", async (req, res) => {
  const { actor_id, actor_name } = req.body;
  const book = await dbGet("SELECT * FROM books WHERE book_code=?", [req.params.book_code]);
  if (!book) return res.status(404).json({ error: "Book not found" });
  await dbRun("DELETE FROM books WHERE book_code=?", [req.params.book_code]);
  await logAction(actor_id, actor_name, "DELETE_BOOK", `Deleted book ${req.params.book_code}: "${book.title}"`);
  res.json({ success: true });
});

// ── Borrow / Return ────────────────────────────────────────────────────────

app.post("/borrow", async (req, res) => {
  const { book_code, user_id, due_date } = req.body;
  const book = await dbGet("SELECT * FROM books WHERE book_code=?", [book_code]);
  if (!book) return res.status(404).json({ error: "Book not found" });
  if (book.available <= 0) return res.status(400).json({ error: "No available copies" });

  const existing = await dbGet(
    "SELECT * FROM borrow_records WHERE book_code=? AND user_id=? AND return_date IS NULL",
    [book_code, user_id]
  );
  if (existing) return res.status(400).json({ error: "You already have this book borrowed" });

  await dbRun("UPDATE books SET available=available-1 WHERE book_code=?", [book_code]);
  await dbRun("INSERT INTO borrow_records(book_code, user_id, due_date) VALUES(?,?,?)", [book_code, user_id, due_date]);

  const user = await dbGet("SELECT name FROM users WHERE id=?", [user_id]);
  await logAction(user_id, user?.name, "BORROW_BOOK", `Borrowed "${book.title}" (${book_code}), due: ${due_date}`);
  res.json({ success: true });
});

app.post("/return", async (req, res) => {
  const { book_code, user_id, return_date } = req.body;
  const record = await dbGet(
    "SELECT * FROM borrow_records WHERE book_code=? AND user_id=? AND return_date IS NULL ORDER BY borrow_date DESC LIMIT 1",
    [book_code, user_id]
  );
  if (!record) return res.status(400).json({ error: "No active borrow record found" });

  const finalDate = return_date || new Date().toISOString().split("T")[0];
  await dbRun("UPDATE borrow_records SET return_date=? WHERE id=?", [finalDate, record.id]);
  await dbRun("UPDATE books SET available=available+1 WHERE book_code=?", [book_code]);

  const book = await dbGet("SELECT title FROM books WHERE book_code=?", [book_code]);
  const user = await dbGet("SELECT name FROM users WHERE id=?", [user_id]);
  await logAction(user_id, user?.name, "RETURN_BOOK", `Returned "${book?.title}" (${book_code}) on ${finalDate}`);
  res.json({ success: true });
});

app.get("/borrow_records", async (req, res) => {
  const { book_code, user_id } = req.query;
  res.json(await dbAll(
    "SELECT * FROM borrow_records WHERE book_code=? AND user_id=? AND return_date IS NULL ORDER BY borrow_date DESC",
    [book_code, user_id]
  ));
});

app.get("/borrows/active/user/:id", async (req, res) => {
  res.json(await dbAll(
    "SELECT book_code FROM borrow_records WHERE user_id=? AND return_date IS NULL",
    [req.params.id]
  ));
});

app.get("/borrows/active", async (req, res) => {
  res.json(await dbAll(`
    SELECT br.*, b.title, u.name, u.user_type, u.student_number, u.employee_number, u.email
    FROM borrow_records br
    JOIN books b ON br.book_code = b.book_code
    JOIN users u ON br.user_id = u.id
    WHERE br.return_date IS NULL
    ORDER BY br.borrow_date DESC
  `));
});

// ── Users ──────────────────────────────────────────────────────────────────

app.get("/users/search", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const like = `%${q}%`;
  res.json(await dbAll(
    "SELECT * FROM users WHERE (email LIKE ? OR student_number LIKE ? OR employee_number LIKE ?) ORDER BY name ASC",
    [like, like, like]
  ));
});

app.get("/users/:id", async (req, res) => {
  const user = await dbGet("SELECT * FROM users WHERE id=?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

app.get("/users/:id/borrows", async (req, res) => {
  res.json(await dbAll(`
    SELECT br.*, b.title, b.category
    FROM borrow_records br
    JOIN books b ON br.book_code = b.book_code
    WHERE br.user_id = ?
    ORDER BY br.borrow_date DESC
  `, [req.params.id]));
});

app.post("/users/:id/borrows/:borrow_id/pay", async (req, res) => {
  await dbRun("UPDATE borrow_records SET fee_paid=1 WHERE id=? AND user_id=?", [req.params.borrow_id, req.params.id]);
  res.json({ success: true });
});

app.post("/users/:id/ban", async (req, res) => {
  const { actor_id, actor_name } = req.body;
  const user = await dbGet("SELECT * FROM users WHERE id=?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "User not found" });
  await dbRun("UPDATE users SET banned=1 WHERE id=?", [req.params.id]);
  await logAction(actor_id, actor_name, "BAN_USER", `Banned user "${user.name}" (${user.email})`);
  res.json({ success: true });
});

app.post("/users/:id/unban", async (req, res) => {
  const { actor_id, actor_name } = req.body;
  const user = await dbGet("SELECT * FROM users WHERE id=?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "User not found" });
  await dbRun("UPDATE users SET banned=0 WHERE id=?", [req.params.id]);
  await logAction(actor_id, actor_name, "UNBAN_USER", `Unbanned user "${user.name}" (${user.email})`);
  res.json({ success: true });
});

app.post("/users", async (req, res) => {
  const { user_type, name, student_number, employee_number, email, actor_id, actor_name } = req.body;
  if (!user_type || !email || !name) return res.status(400).json({ error: "Missing fields" });
  if (!email.endsWith(`@${SCHOOL_DOMAIN}`)) return res.status(400).json({ error: `Email must end with @${SCHOOL_DOMAIN}` });
  if (user_type === "student" && !student_number) return res.status(400).json({ error: "Student number required" });
  if (user_type !== "student" && !employee_number) return res.status(400).json({ error: "Employee number required" });

  const existingEmail = await dbGet("SELECT id FROM users WHERE email=?", [email]);
  if (existingEmail) return res.status(400).json({ error: "Email already registered" });

  if (student_number) {
    const existingNum = await dbGet("SELECT id FROM users WHERE student_number=?", [student_number]);
    if (existingNum) return res.status(400).json({ error: "Student number already registered" });
  }
  if (employee_number) {
    const existingNum = await dbGet("SELECT id FROM users WHERE employee_number=?", [employee_number]);
    if (existingNum) return res.status(400).json({ error: "Employee number already registered" });
  }

  await dbRun(
    "INSERT INTO users(user_type, name, student_number, employee_number, email) VALUES(?,?,?,?,?)",
    [user_type, name.trim(), student_number || null, employee_number || null, email]
  );

  const newUser = await dbGet("SELECT * FROM users WHERE email=?", [email]);
  await logAction(actor_id, actor_name, "ADD_USER", `Added user "${name}" (${user_type}, ${email})`);
  res.json(newUser);
});

// ── Audit Log ────────────────────────────────────────────────────────────

app.get("/audit-log", async (req, res) => {
  res.json(await dbAll("SELECT * FROM audit_log ORDER BY timestamp DESC"));
});

app.get("/audit-log/download", async (req, res) => {
  const rows = await dbAll("SELECT * FROM audit_log ORDER BY timestamp ASC");
  const lines = [
    "ID,Timestamp,Actor,Action,Detail",
    ...rows.map(r =>
      [r.id, r.timestamp, `"${r.actor_name || ""}"`, r.action, `"${(r.detail || "").replace(/"/g, '""')}"`].join(",")
    )
  ];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=audit_log.csv");
  res.send(lines.join("\n"));
});

app.use(express.static("public"));
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
