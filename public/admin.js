// Use localStorage to persist products for demo purposes
let products = JSON.parse(localStorage.getItem('products')) || [
  { name: "Hotstar", img: "https://upload.wikimedia.org/wikipedia/commons/1/1e/Disney%2B_Hotstar_logo.svg", plans: [
    { label: "1 Month", price: 149 }, { label: "3 Months", price: 399 }, { label: "12 Months", price: 1499 }
  ]},
  { name: "Netflix", img: "https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg", plans: [
    { label: "1 Month", price: 199 }, { label: "3 Months", price: 549 }, { label: "12 Months", price: 2199 }
  ]}
];

function saveProducts() {
  localStorage.setItem('products', JSON.stringify(products));
}

function renderAdminGrid() {
  const grid = document.getElementById('adminGrid');
  grid.innerHTML = '';
  products.forEach((prod, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img src="${prod.img}" alt="${prod.name}">
      <h2>${prod.name}</h2>
      <div class="plans">
        ${prod.plans.map((plan, pidx) => `
          <span>
            ${plan.label} - ₹${plan.price}
            <button onclick="deletePlan(${idx},${pidx})" style="color:red;">x</button>
          </span>
        `).join('')}
      </div>
      <button onclick="deleteProduct(${idx})" style="margin-top:10px;color:#fff;background:#dc3545;">Delete Product</button>
    `;
    grid.appendChild(card);
  });
}

window.deleteProduct = function(idx) {
  if (confirm("Delete this product?")) {
    products.splice(idx, 1);
    saveProducts();
    renderAdminGrid();
  }
};

window.deletePlan = function(prodIdx, planIdx) {
  if (confirm("Delete this plan?")) {
    products[prodIdx].plans.splice(planIdx, 1);
    saveProducts();
    renderAdminGrid();
  }
};

document.getElementById('addProductForm').onsubmit = function(e) {
  e.preventDefault();
  const f = e.target;
  const plans = [];
  [f.plan1.value, f.plan2.value, f.plan3.value].forEach(planStr => {
    if (planStr) {
      const [label, price] = planStr.split('-').map(s => s.trim());
      if (label && price && !isNaN(Number(price))) {
        plans.push({ label, price: Number(price) });
      }
    }
  });
  if (!f.name.value.trim() || !f.img.value.trim() || plans.length === 0) {
    alert("Please fill all fields and at least one plan (format: Label - Price)");
    return;
  }
  products.push({ name: f.name.value.trim(), img: f.img.value.trim(), plans });
  saveProducts();
  renderAdminGrid();
  f.reset();
};

// --- Lifetime login logic ---

function showAdminPanel() {
  document.getElementById('adminPanel').style.display = 'block';
  document.getElementById('loginPanel').style.display = 'none';
  renderAdminGrid();
}

function showLoginPanel() {
  document.getElementById('adminPanel').style.display = 'none';
  document.getElementById('loginPanel').style.display = 'block';
}

// On page load, check if admin is already logged in on this device
if (localStorage.getItem('adminLoggedIn') === '1') {
  showAdminPanel();
} else {
  showLoginPanel();
}

// Login form logic
document.getElementById('adminLoginForm').onsubmit = function(e) {
  e.preventDefault();
  // You can add real authentication here if needed
  // For demo, just log in with any credentials
  localStorage.setItem('adminLoggedIn', '1');
  showAdminPanel();
};

// Logout logic
document.getElementById('logoutBtn').onclick = function() {
  localStorage.removeItem('adminLoggedIn');
  showLoginPanel();
};
