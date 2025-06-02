// Fetch products dynamically from the server
fetch('/api/products')
  .then(res => res.json())
  .then(products => {
    const grid = document.getElementById('subsGrid');
    grid.innerHTML = ""; // Clear any existing content
    products.forEach((prod, prodIdx) => {
      const card = document.createElement('div');
      card.className = 'sub-card';
      card.innerHTML = `
        <b>${prod.name}</b>
        <img src="${prod.img}" alt="${prod.name}">
        <ul class="plan-list"></ul>
      `;
      const planList = card.querySelector('.plan-list');
      prod.plans.forEach((plan, planIdx) => {
        const li = document.createElement('li');
        li.className = 'plan-item';
        li.innerHTML = `
          <span class="plan-label">${plan.label}</span>
          <span class="plan-price">₹${plan.price}</span>
          <a href="checkout.html?product=${prodIdx}&plan=${planIdx}" class="buy-btn">Buy Now</a>
        `;
        planList.appendChild(li);
      });
      // Add note at the end of the card if exists
      if (prod.note) {
        const noteDiv = document.createElement('div');
        noteDiv.className = 'sub-note';
        noteDiv.innerHTML = `<b>Note:</b> ${prod.note}`;
        card.appendChild(noteDiv);
      }
      grid.appendChild(card);
    });
  })
  .catch(() => {
    document.getElementById('subsGrid').innerHTML = "<p>Failed to load subscriptions.</p>";
  });