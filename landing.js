(function(){
  const params = new URLSearchParams(window.location.search);

  const packParam = params.get('pack');      // e.g. tonsils
  const idsParam  = params.get('ids');       // e.g. "5,9,15"
  const idParams  = params.getAll('id');     // e.g. ["5","9","15"]

  const multiSection    = document.getElementById('multiSection');
  const notFoundSection = document.getElementById('notFoundSection');
  const infoList        = document.getElementById('infoList');

  function escapeHTML(s){
    return (s||'').replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
    }[m]));
  }

  function resolveRequestedIds(packs){
    // If pack=... matches packs.json, use that
    if (packParam && packs && packs[packParam]) {
        return packs[packParam].map(String);
    }
    // If ids=1,2,3
    if (idsParam) {
      return idsParam.split(',')
        .map(x => x.trim())
        .filter(Boolean);
    }
    // If id=1&id=2&id=3
    if (idParams.length) {
      return idParams
        .map(x => x.trim())
        .filter(Boolean);
    }
    return [];
  }

  function renderList(leaflets){
    if (!leaflets.length){
      notFoundSection.hidden = false;
      return;
    }

    // If exactly one leaflet with exactly one URL => auto redirect
    if (
      leaflets.length === 1 &&
      leaflets[0].URL &&
      Array.isArray(leaflets[0].URL) &&
      leaflets[0].URL.length === 1
    ){
      const firstUrl = leaflets[0].URL[0];
      if (firstUrl){
        window.location.href = firstUrl;
        return;
      }
    }

    // Otherwise render list of cards
    multiSection.hidden = false;
    infoList.innerHTML = leaflets.map(item => {
      // pick first URL to display as main action
      const firstUrl = (item.URL && item.URL[0]) ? item.URL[0] : '#';
      return `
        <li class="leaflet-card">
          <p class="leaflet-title">${escapeHTML(item.Title || 'Information')}</p>
          <a class="leaflet-action"
             href="${firstUrl}"
             target="_blank"
             rel="noopener"
             aria-label="Open leaflet: ${escapeHTML(item.Title || '')}">
            Open
          </a>
          <p class="leaflet-url">${escapeHTML(firstUrl)}</p>
        </li>
      `;
    }).join('');
  }

  Promise.all([
    fetch('packs.json?v=' + Date.now(), {cache:'no-store'}).then(r=>r.json()),
    fetch('leaflets.json?v=' + Date.now(), {cache:'no-store'}).then(r=>r.json())
  ])
  .then(([packs, leaflets])=>{
    const requestedIds = resolveRequestedIds(packs); // ["5","9","15", ...]
    const chosen = requestedIds
      .map(idStr => leaflets.find(l => String(l.id) === String(idStr)))
      .filter(Boolean);

    renderList(chosen);
  })
  .catch(()=>{
    notFoundSection.hidden = false;
  });
})();
