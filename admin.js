(function(){
  const packSelect    = document.getElementById('packSelect');
  const packIdInput   = document.getElementById('packIdInput');
  const leafletListEl = document.getElementById('leafletList');
  const packsPreview  = document.getElementById('packsPreview');
  const saveBtn       = document.getElementById('saveBtn');
  const diag          = document.getElementById('diag');

  let leaflets = [];
  let packs    = {};
  let currentPackId = "";

  Promise.all([
    fetch('leaflets.json?v=' + Date.now(), {cache:'no-store'}).then(r=>r.json()),
    fetch('packs.json?v=' + Date.now(), {cache:'no-store'}).then(r=>r.json())
  ])
  .then(([leafletArr, packsObj])=>{
    leaflets = leafletArr;
    packs    = packsObj;
    initUI();
    diag.textContent = "Loaded " + leaflets.length + " leaflets and " + Object.keys(packs).length + " packs.";
  })
  .catch(err=>{
    diag.textContent = "Error loading data: " + err.message;
  });

  function initUI(){
    // Build pack dropdown
    const opts = [`<option value="">— New pack —</option>`]
      .concat(Object.keys(packs).sort().map(id=>`<option value="${id}">${id}</option>`));
    packSelect.innerHTML = opts.join('');

    packSelect.addEventListener('change', e=>{
      const sel = e.target.value;
      if (!sel){
        currentPackId = "";
        packIdInput.value = "";
        renderLeafletChooser([]);
      } else {
        currentPackId = sel;
        packIdInput.value = sel;
        renderLeafletChooser(packs[sel] || []);
      }
    });

    packIdInput.addEventListener('input', ()=>{
      currentPackId = packIdInput.value.trim();
    });

    // initial state = new pack
    renderLeafletChooser([]);

    saveBtn.addEventListener('click', ()=>{
      const chosenIds = readChosenIds();
      const pid = packIdInput.value.trim();
      if (!pid){
        alert("Please enter a Pack ID (e.g. tonsils)");
        return;
      }
      packs[pid] = chosenIds;
      packsPreview.textContent = JSON.stringify(packs, null, 2);
      diag.textContent = "Preview updated. Copy ↑ into packs.json";
    });

    packsPreview.textContent = JSON.stringify(packs, null, 2);
  }

  function renderLeafletChooser(selectedIds){
    // group by Category
    const groups = {};
    leaflets.forEach(l => {
      const cat = l.Category || "Other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(l);
    });

    leafletListEl.innerHTML = Object.keys(groups).sort().map(cat=>{
      const rows = groups[cat]
        .sort((a,b)=>String(a.Title).localeCompare(String(b.Title)))
        .map(l => {
          const checked = selectedIds.includes(l.id) ? 'checked' : '';
          return `
            <div class="leaf-item">
              <input type="checkbox"
                     class="leaf-check"
                     value="${l.id}"
                     ${checked}
                     style="margin-top:2px;flex-shrink:0;">
              <div>
                <div class="leaf-title">${escapeHTML(l.Title)}</div>
                <div class="leaf-cat">${escapeHTML(cat)}</div>
              </div>
            </div>
          `;
        }).join('');
      return `
        <div>
          <div class="cat-head">${escapeHTML(cat)}</div>
          ${rows}
        </div>
      `;
    }).join('');
  }

  function readChosenIds(){
    return Array.from(leafletListEl.querySelectorAll('.leaf-check'))
      .filter(b => b.checked)
      .map(b => Number(b.value));
  }

  function escapeHTML(s){
    return (s||'').replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
    }[m]));
  }
})();