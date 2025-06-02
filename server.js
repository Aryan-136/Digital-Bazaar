require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, sameSite: 'lax' }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/Screenshort', express.static(path.join(__dirname, 'Screenshort')));

// Assets folder for subscription icons/images
const assetsDir = path.join(__dirname, 'Assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);
app.use('/Assets', express.static(assetsDir));

// Ensure Screenshort folder exists (for order screenshots)
const uploadDir = path.join(__dirname, 'Screenshort');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer config for order screenshots
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${ts}${ext}`);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed!'));
    cb(null, true);
  }
});

// Multer config for subscription icons/images
const subIconStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, assetsDir),
  filename: (req, file, cb) => {
    let name = req.body.name || 'subscription';
    name = name.replace(/[^a-z0-9_\-]/gi, '_');
    const ext = path.extname(file.originalname);
    cb(null, `${name}${ext}`);
  }
});
const uploadSubIcon = multer({ 
  storage: subIconStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed!'));
    cb(null, true);
  }
});

// Helpers
const productsFile = path.join(__dirname, 'products.json');
function loadProducts() {
  if (fs.existsSync(productsFile)) {
    try {
      return JSON.parse(fs.readFileSync(productsFile));
    } catch { return []; }
  }
  return [];
}
function saveProducts(products) {
  fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
}

// Coupon helpers
const couponsFile = path.join(__dirname, 'coupons.json');
function loadCoupons() {
  if (fs.existsSync(couponsFile)) {
    try { return JSON.parse(fs.readFileSync(couponsFile)); } catch { return []; }
  }
  return [];
}
function saveCoupons(coupons) {
  fs.writeFileSync(couponsFile, JSON.stringify(coupons, null, 2));
}

// Middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  if (req.accepts('html')) return res.redirect('/admin.html');
  res.status(401).send('Unauthorized');
}

// API: Get products
app.get('/api/products', (req, res) => {
  res.json(loadProducts());
});

// API: Get UPI
app.get('/api/upi', (req, res) => {
  res.json({ upiId: process.env.UPI_ID || '' });
});

// Coupon APIs
app.get('/api/coupons', (req, res) => {
  res.json(loadCoupons());
});
app.post('/api/coupons', requireAdmin, (req, res) => {
  const { code, discount } = req.body;
  if (!code || !discount) return res.json({ success: false });
  let coupons = loadCoupons();
  if (coupons.find(c => c.code === code.trim().toUpperCase())) return res.json({ success: false, message: "Code exists" });
  coupons.push({ code: code.trim().toUpperCase(), discount: Number(discount) });
  saveCoupons(coupons);
  res.json({ success: true });
});
app.post('/api/coupons/delete', requireAdmin, (req, res) => {
  const { code } = req.body;
  let coupons = loadCoupons();
  coupons = coupons.filter(c => c.code !== code);
  saveCoupons(coupons);
  res.json({ success: true });
});

// Coupon management page
app.get('/manage-coupons', requireAdmin, (req, res) => {
  const coupons = loadCoupons();
  let html = `
    <html>
    <head><title>Manage Coupons</title></head>
    <body>
      <h1>Coupon Codes</h1>
      <form id="addCouponForm">
        <input name="code" placeholder="Code" required>
        <input name="discount" type="number" min="1" max="100" placeholder="Discount (%)" required>
        <button type="submit">Add Coupon</button>
      </form>
      <ul>
        ${coupons.map(c => `<li>${c.code} - ${c.discount}% <button onclick="deleteCoupon('${c.code}')">Delete</button></li>`).join('')}
      </ul>
      <a href="/admin">&larr; Back to Admin Panel</a>
      <script>
        document.getElementById('addCouponForm').onsubmit = function(e) {
          e.preventDefault();
          fetch('/api/coupons', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              code: this.code.value,
              discount: this.discount.value
            })
          }).then(()=>location.reload());
        };
        function deleteCoupon(code) {
          fetch('/api/coupons/delete', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ code })
          }).then(()=>location.reload());
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// ...existing code...
app.post('/submit', upload.single('screenshot'), (req, res) => {
  const dbFile = path.join(__dirname, 'submissions.json');
  let db = [];
  if (fs.existsSync(dbFile)) db = JSON.parse(fs.readFileSync(dbFile));

  // Find the next token number
  let nextTokenNum = 1;
  if (db.length > 0) {
    // Find the highest token number in the file
    const lastToken = db[db.length - 1].token;
    if (lastToken && /^DM\d{5}$/.test(lastToken)) {
      nextTokenNum = parseInt(lastToken.slice(2), 10) + 1;
    } else {
      nextTokenNum = db.length + 1;
    }
  }
  const token = 'DM' + String(nextTokenNum).padStart(5, '0');

  // Build new entry
  const entry = {
    token,
    name: req.body.name,
    number: req.body.number,
    email: req.body.email,
    upiRef: req.body.upiRef,
    screenshot: req.file ? req.file.filename : null,
    product: req.body.product,
    plan: req.body.plan,
    coupon: req.body.coupon,
    discount: req.body.discount ? Number(req.body.discount) : undefined,
    time: new Date().toISOString()
  };
  // Remove undefined fields
  Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k]);

  db.push(entry);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
  res.json({ success: true, ref: token });
});
// ...existing code...

// Admin login
app.post('/login', (req, res) => {
  const { user, pass } = req.body;
  if (
    user === (process.env.ADMIN_USER || 'admin') &&
    pass === (process.env.ADMIN_PASS || 'adminpass')
  ) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ success: false });
});

// Admin: Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin.html'));
});

// Admin: Submissions JSON
app.get('/submissions', requireAdmin, (req, res) => {
  const dbFile = path.join(__dirname, 'submissions.json');
  if (!fs.existsSync(dbFile)) return res.json([]);
  const db = JSON.parse(fs.readFileSync(dbFile));
  res.json(db);
});

// Admin: Update status
app.post('/update-status', requireAdmin, (req, res) => {
  const { index, status } = req.body;
  const dbFile = path.join(__dirname, 'submissions.json');
  let db = [];
  if (fs.existsSync(dbFile)) db = JSON.parse(fs.readFileSync(dbFile));
  if (db[index]) {
    db[index].status = status;
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
    return res.json({ success: true });
  }
  res.status(400).json({ success: false });
});

// Admin: Delete submission
app.post('/delete-submission', requireAdmin, (req, res) => {
  const { index } = req.body;
  const dbFile = path.join(__dirname, 'submissions.json');
  let db = [];
  if (fs.existsSync(dbFile)) db = JSON.parse(fs.readFileSync(dbFile));
  if (db[index]) {
    // Remove screenshot file if exists
    if (db[index].screenshot) {
      const screenshotPath = path.join(__dirname, 'Screenshort', db[index].screenshot);
      if (fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath);
    }
    db.splice(index, 1);
    try {
      fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to save file.' });
    }
  }
  res.status(400).json({ success: false });
});

// Admin: Add subscription (dynamic plans and note)
app.post('/add-subscription', requireAdmin, uploadSubIcon.single('img'), (req, res) => {
  let products = loadProducts();
  const { name, note } = req.body;
  if (!name || !req.file) return res.json({ success: false });

  // Collect plans dynamically
  const plans = [];
  Object.keys(req.body).forEach(key => {
    if (key.startsWith('plan_month_')) {
      const idx = key.split('_')[2];
      const month = req.body[`plan_month_${idx}`];
      const price = req.body[`plan_price_${idx}`];
      if (month && price) {
        plans.push({ label: `${month} Month${month > 1 ? 's' : ''}`, price: parseInt(price) });
      }
    }
  });

  products.push({
    name: name.trim(),
    img: '/Assets/' + req.file.filename,
    plans,
    note: note ? note.trim() : ""
  });
  saveProducts(products);
  res.json({ success: true });
});

// Admin: Delete subscription
app.post('/delete-product', requireAdmin, (req, res) => {
  const { idx } = req.body;
  let products = loadProducts();
  if (products[idx]) {
    products.splice(idx, 1);
    saveProducts(products);
    return res.json({ success: true });
  }
  res.json({ success: false });
});

// ...existing code...

app.get('/manage-products', requireAdmin, (req, res) => {
  const products = loadProducts();
  let html = `
    <html>
    <head>
      <title>Manage Subscriptions</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'Inter', Arial, sans-serif;
          background: #f4f6fb;
          margin: 0;
          padding: 0;
        }
        .admin-bar {
          background: linear-gradient(90deg, #3b3b8f 60%, #222266 100%);
          color: #fff;
          padding: 24px 0 18px 0;
          text-align: center;
          font-size: 2em;
          font-weight: 700;
          letter-spacing: 1px;
          box-shadow: 0 2px 12px #0002;
          margin-bottom: 30px;
        }
        .container {
          max-width: 900px;
          margin: 0 auto;
          padding: 0 16px 40px 16px;
        }
        .section-title {
          font-size: 1.3em;
          font-weight: 600;
          color: #2d2d4d;
          margin-bottom: 18px;
          margin-top: 0;
        }
        .form-card {
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 2px 12px #0001;
          padding: 28px 24px 18px 24px;
          margin-bottom: 32px;
        }
        .form-card label {
          font-weight: 500;
          color: #333;
        }
        .form-card input[type="text"],
        .form-card input[type="file"],
        .form-card input[type="number"],
        .form-card textarea,
        .form-card select {
          width: 100%;
          padding: 9px 12px;
          margin: 7px 0 16px 0;
          border-radius: 6px;
          border: 1px solid #bbb;
          font-size: 1em;
          background: #fafbfc;
          transition: border 0.2s;
          box-sizing: border-box;
        }
        .form-card input[type="file"] {
          padding: 7px 0;
        }
        .form-card textarea {
          resize: vertical;
        }
        .form-card button {
          background: #3b3b8f;
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 10px 22px;
          font-size: 1em;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.18s;
          margin-top: 6px;
        }
        .form-card button:hover {
          background: #222266;
        }
        .add-plan-btn {
          background: #e0e0e0;
          color: #222;
          border: none;
          border-radius: 6px;
          padding: 7px 16px;
          font-size: 0.98em;
          font-weight: 500;
          margin-bottom: 10px;
          margin-top: 0;
          cursor: pointer;
          transition: background 0.18s;
        }
        .add-plan-btn:hover {
          background: #d0d0d0;
        }
        .prod-list-title {
          font-size: 1.15em;
          font-weight: 600;
          color: #2d2d4d;
          margin-bottom: 12px;
        }
        .prod-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 28px;
        }
        .prod-card {
          background: #fff;
          border-radius: 14px;
          box-shadow: 0 2px 12px #0001;
          padding: 22px 18px 18px 18px;
          position: relative;
          transition: box-shadow 0.18s, transform 0.18s;
          display: flex;
          flex-direction: column;
          min-height: 220px;
        }
        .prod-card:hover {
          box-shadow: 0 6px 24px #0002;
          transform: translateY(-2px) scale(1.01);
        }
        .prod-card img {
          max-width: 120px;
          max-height: 40px;
          display: block;
          margin-bottom: 10px;
          border-radius: 6px;
          background: #f7f7fa;
        }
        .prod-name {
          font-size: 1.08em;
          font-weight: 600;
          color: #2d2d4d;
          margin-bottom: 6px;
        }
        .prod-plans {
          margin: 0 0 10px 0;
          padding: 0;
          list-style: none;
        }
        .prod-plans li {
          font-size: 0.98em;
          color: #444;
          margin-bottom: 2px;
        }
        .prod-note {
          color: #666;
          font-size: 0.97em;
          margin: 10px 0 0 0;
          background: #f7f7fa;
          border-radius: 6px;
          padding: 7px 10px;
        }
        .move-btns {
          position: absolute;
          top: 16px;
          right: 16px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .move-btns button {
          background: #e0e0e0;
          color: #3b3b8f;
          border: none;
          border-radius: 4px;
          padding: 3px 10px;
          font-size: 1.1em;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.18s, color 0.18s;
        }
        .move-btns button:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .move-btns button:hover:not(:disabled) {
          background: #3b3b8f;
          color: #fff;
        }
        .delete-btn {
          background: #ffeaea;
          color: #c00;
          border: none;
          border-radius: 6px;
          padding: 7px 16px;
          font-size: 1em;
          font-weight: 600;
          margin-top: 10px;
          cursor: pointer;
          transition: background 0.18s, color 0.18s;
        }
        .delete-btn:hover {
          background: #ffcccc;
        }
        .back-link {
          display: inline-block;
          margin-bottom: 18px;
          color: #3b3b8f;
          text-decoration: none;
          font-weight: 500;
          font-size: 1em;
          transition: color 0.18s;
        }
        .back-link:hover {
          color: #222266;
          text-decoration: underline;
        }
        #addMsg {
          color: #1a7f37;
          font-weight: 600;
          margin-bottom: 20px;
          display: none;
        }
        @media (max-width: 600px) {
          .container { padding: 0 4vw 40px 4vw; }
          .prod-grid { grid-template-columns: 1fr; }
        }
      </style>
      <script>
        function deleteProduct(idx, btn) {
          if(!confirm('Delete this subscription?')) return;
          fetch('/delete-product', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ idx })
          }).then(r=>r.json()).then(data=>{
            if(data.success) btn.closest('.prod-card').remove();
            else alert('Delete failed!');
          });
        }
        function addPlanField() {
          const container = document.getElementById('plansContainer');
          const idx = container.querySelectorAll('.plan-row').length;
          const row = document.createElement('div');
          row.className = 'plan-row';
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '10px';
          row.style.marginBottom = '8px';
          row.innerHTML = \`
            <select name="plan_month_\${idx}" required style="width:110px;">
              \${Array.from({length:12},(_,i)=>\`<option value="\${i+1}">\${i+1} Month\${i>0?'s':''}</option>\`).join('')}
            </select>
            <input name="plan_price_\${idx}" type="number" placeholder="Price" required style="width:90px;">
            <button type="button" onclick="this.parentNode.remove()" style="background:#ffeaea;color:#c00;padding:4px 10px;border-radius:4px;border:none;font-size:0.97em;">Remove</button>
          \`;
          container.appendChild(row);
        }
        function moveProduct(idx, dir) {
          fetch(dir === 'up' ? '/move-product-up' : '/move-product-down', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ idx })
          }).then(r=>r.json()).then(data=>{
            if(data.success) location.reload();
          });
        }
        document.addEventListener('DOMContentLoaded', function() {
          addPlanField();
          const form = document.getElementById('addProductForm');
          if(form){
            form.onsubmit = function(e){
              e.preventDefault();
              const formData = new FormData(form);
              fetch('/add-subscription', {
                method: 'POST',
                body: formData
              }).then(r => r.json()).then(resp => {
                if(resp.success){
                  document.getElementById('addMsg').innerText = "Subscription added!";
                  document.getElementById('addMsg').style.display = "block";
                  setTimeout(()=>{ location.reload(); }, 1000);
                } else {
                  document.getElementById('addMsg').innerText = "Failed to add!";
                  document.getElementById('addMsg').style.display = "block";
                }
              });
            };
          }
        });
      </script>
    </head>
    <body>
      <div class="admin-bar">Manage Subscriptions</div>
      <div class="container">
        <a href="/admin" class="back-link">&larr; Back to Admin Panel</a>
        <div class="form-card">
          <div class="section-title">Add New Subscription</div>
          <form id="addProductForm" enctype="multipart/form-data" style="margin-bottom:10px;">
            <label>Name:<br><input name="name" required></label><br>
            <label>Image:<br><input type="file" name="img" accept="image/*" required></label><br>
            <div id="plansContainer">
              <label>Plans:</label><br>
            </div>
            <button type="button" class="add-plan-btn" onclick="addPlanField()">Add Plan</button><br>
            <label>Note (optional):<br>
              <textarea name="note" rows="2" style="width:95%;"></textarea>
            </label><br>
            <button type="submit">Add</button>
          </form>
          <div id="addMsg"></div>
        </div>
        <div class="prod-list-title">Available Subscriptions</div>
        <div class="prod-grid">
        ${products.map((prod, idx) => `
          <div class="prod-card">
            <div class="move-btns">
              <button onclick="moveProduct(${idx},'up')" ${idx === 0 ? 'disabled' : ''} title="Move Up">&#8593;</button>
              <button onclick="moveProduct(${idx},'down')" ${idx === products.length-1 ? 'disabled' : ''} title="Move Down">&#8595;</button>
            </div>
            <div class="prod-name">${prod.name}</div>
            ${prod.img ? `<img src="${prod.img}" alt="${prod.name}">` : ''}
            <ul class="prod-plans">
              ${prod.plans.map(plan => `<li>${plan.label} - ₹${plan.price}</li>`).join('')}
            </ul>
            ${prod.note ? `<div class="prod-note"><b>Note:</b> ${prod.note}</div>` : ''}
            <button onclick="deleteProduct(${idx}, this)" class="delete-btn">Delete</button>
          </div>
        `).join('')}
        </div>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});
// ...existing code...
// Admin: Export CSV
app.get('/export-csv', requireAdmin, (req, res) => {
  const dbFile = path.join(__dirname, 'submissions.json');
  if (!fs.existsSync(dbFile)) return res.status(404).send('No data');
  const db = JSON.parse(fs.readFileSync(dbFile));
  const products = loadProducts();

  // CSV header
  let csv = [
    "Token,Name,Number,Email,UPI Ref,OTT,Plan,Amount,Coupon,Discount (%),Status,Time"
  ];

  db.forEach((entry, i) => {
    let ott = '', planLabel = '', planAmount = '';
    if (entry.product !== undefined && entry.plan !== undefined) {
      const prod = products[entry.product];
      if (prod) {
        ott = prod.name;
        const planObj = prod.plans[entry.plan];
        if (planObj) {
          planLabel = planObj.label;
          planAmount = planObj.price;
        }
      }
    }
    const status = entry.status || "Order Pending";
    const token = 'DM' + String(i + 1).padStart(5, '0');
    // Escape commas and quotes
    function esc(val) {
      if (typeof val !== "string") val = String(val ?? "");
      return `"${val.replace(/"/g, '""')}"`;
    }
    csv.push([
      esc(token),
      esc(entry.name),
      esc(entry.number),
      esc(entry.email),
      esc(entry.upiRef),
      esc(ott),
      esc(planLabel),
      esc(planAmount ? '₹' + planAmount : ''),
      esc(entry.coupon || ''),
      esc(entry.discount || ''),
      esc(status),
      esc(entry.time)
    ].join(','));
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="submissions.csv"');
  res.send(csv.join('\r\n'));
});
app.post('/update-renewal-date', requireAdmin, (req, res) => {
  const { index, renewalDate } = req.body;
  const dbFile = path.join(__dirname, 'submissions.json');
  if (!fs.existsSync(dbFile)) return res.json({ success: false });
  let db = JSON.parse(fs.readFileSync(dbFile));
  if (db[index]) {
    db[index].renewalDate = renewalDate;
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
    return res.json({ success: true });
  }
  res.json({ success: false });
});
app.get('/admin', requireAdmin, (req, res) => {
  const products = loadProducts();
  const dbFile = path.join(__dirname, 'submissions.json');
  let db = [];
  if (fs.existsSync(dbFile)) db = JSON.parse(fs.readFileSync(dbFile));
  let html = `
    <html>
    <head>
      <title>Admin Panel</title>
      <link rel="stylesheet" href="/style.css">
      <style>
        html, body {
          height: 100%;
          margin: 0;
          padding: 0;
        }
        body {
          min-height: 100vh;
          font-family: Arial, sans-serif;
          background: #fafbfc;
          margin: 0;
          padding: 0 0 30px 0;
        }
        .admin-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 32px 10px 32px;
          background: #fff;
          border-bottom: 1px solid #e0e0e0;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .admin-header h1 {
          margin: 0;
          font-size: 2em;
        }
        .admin-actions {
          display: flex;
          gap: 12px;
        }
        .admin-actions a, .admin-actions button {
          text-decoration: none;
          padding: 7px 16px;
          border-radius: 5px;
          border: none;
          background: #f0f0f0;
          color: #333;
          font-size: 1em;
          cursor: pointer;
          transition: background 0.2s;
        }
        .admin-actions a[style*="color:red"], .admin-actions button[style*="color:red"] {
          background: #ffeaea;
          color: #c00;
        }
        .admin-actions a:hover, .admin-actions button:hover {
          background: #e0e0e0;
        }
        .logout-btn {
          margin-left: 18px;
          background: transparent;
          font-weight: bold;
          border: none;
          padding: 7px 18px;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .logout-btn:hover {
          background: #ffd6d6;
        }
        .admin-container {
          max-width: 98vw;
          margin: 0 auto;
          padding: 18px 2vw 0 2vw;
        }
        #searchBox {
          margin: 15px 0 15px 0;
          width: 350px;
          padding: 7px 10px;
          font-size: 1em;
          border-radius: 4px;
          border: 1px solid #ccc;
        }
        .filter-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 10px;
        }
        .filter-row label {
          font-size: 1em;
          color: #333;
        }
        .table-container {
          width: 100%;
          height: calc(100vh - 210px);
          overflow: auto;
          background: #fff;
          border-radius: 8px;
          box-shadow: 0 2px 8px #0001;
        }
        table {
          border-collapse: collapse;
          width: 100%;
          min-width: 1200px;
          font-size: 1em;
        }
        thead th {
          position: sticky;
          top: 0;
          background: #f5f6fa;
          z-index: 2;
          cursor: pointer;
          padding: 12px 8px;
          border-bottom: 2px solid #e0e0e0;
        }
        tbody td {
          padding: 10px 8px;
          border-bottom: 1px solid #eee;
          text-align: left;
          vertical-align: middle;
        }
        tbody tr:nth-child(even) {
          background: #fafbfc;
        }
        select {
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid #ccc;
        }
        input[type="date"] {
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid #ccc;
        }
        button {
          padding: 5px 12px;
          border-radius: 4px;
          border: none;
          background: #f0f0f0;
          cursor: pointer;
        }
        button[style*="color:red"] {
          background: #ffeaea;
          color: #c00;
        }
        @media (max-width: 900px) {
          .admin-header, .admin-container {
            padding-left: 4vw;
            padding-right: 4vw;
          }
          table {
            font-size: 0.95em;
          }
        }
      </style>
      <script>
        function updateStatus(index, select) {
          fetch('/update-status', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ index, status: select.value })
          }).then(r => r.json()).then(data => {
            if(data.success) {
              select.style.background = select.value === 'Order Delivered' ? '#d4edda' : (select.value === 'Order Confirmed' ? '#fff3cd' : '#f8d7da');
            }
          });
        }
        function updateRenewalDate(index, input, btn) {
          btn.disabled = true;
          fetch('/update-renewal-date', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ index, renewalDate: input.value })
          }).then(r => r.json()).then(data => {
            btn.disabled = false;
            if(data.success) {
              input.style.background = '#d4edda';
              setTimeout(()=>{input.style.background='';}, 1000);
            } else {
              input.style.background = '#f8d7da';
            }
          });
        }
        function filterTable() {
          const q = document.getElementById('searchBox').value.toLowerCase();
          document.querySelectorAll('tbody tr').forEach(row => {
            row.style.display = [...row.children].some(td =>
              td.textContent.toLowerCase().includes(q)
            ) ? '' : 'none';
          });
        }
        function filterRenewalDate() {
          const from = document.getElementById('renewalFrom').value;
          const to = document.getElementById('renewalTo').value;
          document.querySelectorAll('tbody tr').forEach(row => {
            const dateCell = row.querySelector('td[data-renewal]');
            if (!dateCell) return;
            const val = dateCell.getAttribute('data-renewal');
            if ((!from && !to) || (!val && !from && !to)) {
              row.style.display = '';
              return;
            }
            if (!val) {
              row.style.display = 'none';
              return;
            }
            if (from && val < from) {
              row.style.display = 'none';
              return;
            }
            if (to && val > to) {
              row.style.display = 'none';
              return;
            }
            row.style.display = '';
          });
        }
        function clearRenewalFilter() {
          document.getElementById('renewalFrom').value = '';
          document.getElementById('renewalTo').value = '';
          filterRenewalDate();
        }
        function deleteSubmission(index, btn) {
          if (!confirm('Are you sure you want to delete this submission?')) return;
          fetch('/delete-submission', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ index })
          }).then(r => r.json()).then(data => {
            if(data.success) {
              btn.closest('tr').remove();
            } else {
              alert('Delete failed!');
            }
          });
        }
        // Sorting script
        let sortDir = {};
        function sortTable(n) {
          const table = document.querySelector("table");
          let switching = true, rows, i, x, y, shouldSwitch, dir, switchcount = 0;
          dir = sortDir[n] === "asc" ? "desc" : "asc";
          sortDir[n] = dir;
          while (switching) {
            switching = false;
            rows = table.rows;
            for (i = 1; i < (rows.length - 1); i++) {
              shouldSwitch = false;
              x = rows[i].getElementsByTagName("TD")[n];
              y = rows[i + 1].getElementsByTagName("TD")[n];
              let xVal = x ? x.textContent.trim() : "";
              let yVal = y ? y.textContent.trim() : "";
              // Numeric sort for Amount and Token
              if (n === 0 || n === 7) {
                xVal = parseFloat(xVal.replace(/[^\d.]/g, "")) || 0;
                yVal = parseFloat(yVal.replace(/[^\d.]/g, "")) || 0;
              }
              // Date sort for Time
              if (n === 13) {
                xVal = new Date(xVal);
                yVal = new Date(yVal);
              }
              // Date sort for Renewal Date
              if (n === 14) {
                xVal = x.getAttribute('data-renewal');
                yVal = y.getAttribute('data-renewal');
                xVal = xVal ? new Date(xVal) : new Date(0);
                yVal = yVal ? new Date(yVal) : new Date(0);
              }
              if (dir === "asc" ? xVal > yVal : xVal < yVal) {
                shouldSwitch = true;
                break;
              }
            }
            if (shouldSwitch) {
              rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
              switching = true;
              switchcount++;
            }
          }
        }
        // Logout button handler for iframe
        function iframeLogout() {
          fetch('/logout').then(() => {
            if(window.parent && window.parent !== window) {
              if(window.parent.localStorage) window.parent.localStorage.removeItem('adminLoggedIn');
              if(window.parent.showLoginPanel) window.parent.showLoginPanel();
              else window.parent.location.reload();
            } else {
              window.location.href = '/admin.html';
            }
          });
        }
      </script>
    </head>
    <body>
      <div class="admin-header">
        <h1>All Submissions</h1>
        <div class="admin-actions">
          <a href="/">← Back to Home</a>
          <a href="/manage-products" target="_blank"><button>Manage Subscriptions</button></a>
          <a href="/manage-coupons" target="_blank"><button>Manage Coupons</button></a>
          <a href="/export-csv" target="_blank"><button>Export CSV</button></a>
          <button class="logout-btn" onclick="iframeLogout()">logout</button>
        </div>
      </div>
      <div class="admin-container">
        <div class="filter-row">
          <label for="renewalFrom">Renewal Date:</label>
          <input type="date" id="renewalFrom" onchange="filterRenewalDate()">
          <span>to</span>
          <input type="date" id="renewalTo" onchange="filterRenewalDate()">
          <button onclick="clearRenewalFilter()">Clear</button>
        </div>
        <input id="searchBox" type="text" placeholder="Search by name, OTT, plan, UPI Ref, etc." oninput="filterTable()">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th onclick="sortTable(0)">Token &#x25B2;&#x25BC;</th>
                <th onclick="sortTable(1)">Name &#x25B2;&#x25BC;</th>
                <th onclick="sortTable(2)">Number &#x25B2;&#x25BC;</th>
                <th onclick="sortTable(3)">Email &#x25B2;&#x25BC;</th>
                <th onclick="sortTable(4)">UPI Ref &#x25B2;&#x25BC;</th>
                <th onclick="sortTable(5)">OTT &#x25B2;&#x25BC;</th>
                <th onclick="sortTable(6)">Plan &#x25B2;&#x25BC;</th>
                <th onclick="sortTable(7)">Amount &#x25B2;&#x25BC;</th>
                <th>Coupon</th>
                <th>Discount (%)</th>
                <th onclick="sortTable(10)">Status &#x25B2;&#x25BC;</th>
                <th>Screenshot</th>
                <th>Delete</th>
                <th onclick="sortTable(13)">Time &#x25B2;&#x25BC;</th>
                <th onclick="sortTable(14)">Renewal Date &#x25B2;&#x25BC;</th>
              </tr>
            </thead>
            <tbody>
              ${db.map((entry, i) => {
                let ott = '', planLabel = '', planAmount = '';
                if (entry.product !== undefined && entry.plan !== undefined && products[entry.product]) {
                  ott = products[entry.product].name;
                  const planObj = products[entry.product].plans[entry.plan];
                  if (planObj) {
                    planLabel = planObj.label;
                    planAmount = planObj.price;
                  }
                }
                const status = entry.status || "Order Pending";
                const renewalVal = entry.renewalDate ? entry.renewalDate : '';
                return `
                <tr>
                  <td>${entry.token || ''}</td>
                  <td>${entry.name || ''}</td>
                  <td>${entry.number || ''}</td>
                  <td>${entry.email || ''}</td>
                  <td>${entry.upiRef || ''}</td>
                  <td>${ott}</td>
                  <td>${planLabel}</td>
                  <td>${planAmount ? '₹' + planAmount : ''}</td>
                  <td>${entry.coupon || ''}</td>
                  <td>${entry.discount || ''}</td>
                  <td>
                    <select onchange="updateStatus(${i}, this)" style="background:${status === 'Order Delivered' ? '#d4edda' : (status === 'Order Confirmed' ? '#fff3cd' : '#f8d7da')}">
                      <option${status === 'Order Pending' ? ' selected' : ''}>Order Pending</option>
                      <option${status === 'Order Confirmed' ? ' selected' : ''}>Order Confirmed</option>
                      <option${status === 'Order Delivered' ? ' selected' : ''}>Order Delivered</option>
                    </select>
                  </td>
                  <td>
                    ${entry.screenshot 
                      ? `<a href="/Screenshort/${entry.screenshot}" target="_blank">View</a>` 
                      : ''}
                  </td>
                  <td>
                    <button onclick="deleteSubmission(${i}, this)" style="color:red;">Delete</button>
                  </td>
                  <td>${entry.time || ''}</td>
                  <td data-renewal="${renewalVal}">
                    <input type="date" value="${renewalVal}" 
                      onchange="this.nextElementSibling.disabled=false" />
                    <button class="renew-btn" disabled onclick="updateRenewalDate(${i}, this.previousElementSibling, this)">Save</button>
                  </td>
                </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});


// ...existing code...
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));