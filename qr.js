// qr.js (safe-mode diagnostics)

// IMPORTANT: we don't assume IDs exist. We probe for them and report status.
// We also won't try to build QR unless we definitely have what we need.

// -------- QR drawing core (unchanged) --------
(function(){
  function QR8bitByte(data){this.data=data;}
  QR8bitByte.prototype={
    getLength:function(){return this.data.length;},
    write:function(buf){
      for(let i=0;i<this.data.length;i++){
        buf.put(this.data.charCodeAt(i),8);
      }
    }
  };

  const QRUtil={
    PATTERN_POSITION_TABLE:[[],[6,18],[6,22],[6,26],[6,30],[6,34]],
    getPatternPosition(t){return QRUtil.PATTERN_POSITION_TABLE[t-1];},
    getBCHDigit(data){let digit=0;while(data!==0){digit++;data>>>=1;}return digit;},
    getBCHTypeInfo(data){
      let d=data<<10;
      while(QRUtil.getBCHDigit(d)-QRUtil.getBCHDigit(0x537)!==0){
        d^=(0x537<<(QRUtil.getBCHDigit(d)-QRUtil.getBCHDigit(0x537)-0));
      }
      return((data<<10)|d)^0x5412;
    },
    getMask(maskPattern,i,j){
      switch(maskPattern){
        case 0:return (i+j)%2===0;
        case 1:return i%2===0;
        case 2:return j%3===0;
        case 3:return (i+j)%3===0;
        case 4:return (Math.floor(i/2)+Math.floor(j/3))%2===0;
        default:return (i+j)%2===0;
      }
    }
  };

  function QRBitBuffer(){this.buffer=[];this.length=0;}
  QRBitBuffer.prototype={
    get(i){
      const bufIndex=Math.floor(i/8);
      return((this.buffer[bufIndex]>>>(7-i%8))&1)===1;
    },
    put(num,length){
      for(let i=0;i<length;i++){
        this.putBit(((num>>>(length-i-1))&1)===1);
      }
    },
    getLengthInBits(){return this.length;},
    putBit(bit){
      const bufIndex=Math.floor(this.length/8);
      if(this.buffer.length<=bufIndex){this.buffer.push(0);}
      if(bit){
        this.buffer[bufIndex]|=(0x80>>>(this.length%8));
      }
      this.length++;
    }
  };

  const QRMath = {};
  QRMath.gexp=function(n){
    while(n<0){n+=255;}
    while(n>=256){n-=255;}
    return QRMath.EXP_TABLE[n];
  };
  QRMath.glog=function(n){
    if(n<1) throw new Error("glog("+n+")");
    return QRMath.LOG_TABLE[n];
  };
  QRMath.EXP_TABLE=new Array(256);
  QRMath.LOG_TABLE=new Array(256);
  for(let i=0;i<8;i++){QRMath.EXP_TABLE[i]=1<<i;}
  for(let i=8;i<256;i++){
    QRMath.EXP_TABLE[i]=QRMath.EXP_TABLE[i-4]^QRMath.EXP_TABLE[i-5]^QRMath.EXP_TABLE[i-6]^QRMath.EXP_TABLE[i-8];
  }
  for(let i=0;i<256;i++){
    QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]]=i;
  }

  function QRPolynomial(num,shift){
    let offset=0;
    while(offset<num.length&&num[offset]===0){offset++;}
    this.num=new Array(num.length-offset+shift);
    for(let i=0;i<num.length-offset;i++){
      this.num[i]=num[i+offset];
    }
  }
  QRPolynomial.prototype={
    get(i){return this.num[i];},
    getLength(){return this.num.length;},
    multiply(e){
      const num=new Array(this.getLength()+e.getLength()-1);
      for(let i=0;i<this.getLength();i++){
        for(let j=0;j<e.getLength();j++){
          num[i+j]^=QRMath.gexp(QRMath.glog(this.get(i))+QRMath.glog(e.get(j)));
        }
      }
      return new QRPolynomial(num,0);
    },
    mod(e){
      if(this.getLength()-e.getLength()<0){return this;}
      const ratio=QRMath.glog(this.get(0))-QRMath.glog(e.get(0));
      const num=new Array(this.getLength());
      for(let i=0;i<this.getLength();i++){
        num[i]=this.get(i);
      }
      for(let i=0;i<e.getLength();i++){
        num[i]^=QRMath.gexp(QRMath.glog(e.get(i))+ratio);
      }
      return new QRPolynomial(num,0).mod(e);
    }
  };

  function makeRSBlocks(){
    // version 2-L assumption is fine for short URLs
    return [{dataCount:34,totalCount:44}];
  }

  function QRCode(typeNumber,maskPattern){
    this.typeNumber=typeNumber;
    this.maskPattern=maskPattern;
    this.modules=null;
    this.moduleCount=0;
    this.dataList=[];
  }
  QRCode.prototype={
    addData(data){this.dataList.push(new QR8bitByte(data));},
    make(){
      this.moduleCount=this.typeNumber*4+17;
      this.modules=new Array(this.moduleCount);
      for(let row=0;row<this.moduleCount;row++){
        this.modules[row]=new Array(this.moduleCount);
        for(let col=0;col<this.moduleCount;col++){
          this.modules[row][col]=null;
        }
      }
      setupPositionProbePattern(this,0,0);
      setupPositionProbePattern(this,this.moduleCount-7,0);
      setupPositionProbePattern(this,0,this.moduleCount-7);
      setupPositionAdjustPattern(this);
      setupTimingPattern(this);
      setupTypeInfo(this,true);
      setupTypeInfo(this,false);

      const data=createData(this.typeNumber,this.dataList);
      mapData(this,data);
    },
    isDark(row,col){return this.modules[row][col];}
  };

  function setupPositionProbePattern(qr,row,col){
    for(let r=-1;r<=7;r++){
      if(row+r<=-1||qr.moduleCount<=row+r)continue;
      for(let c=-1;c<=7;c++){
        if(col+c<=-1||qr.moduleCount<=col+c)continue;
        qr.modules[row+r][col+c]=(
          (r>=0&&r<=6&&(c===0||c===6)) ||
          (c>=0&&c<=6&&(r===0||r===6)) ||
          (r>=2&&r<=4&&c>=2&&c<=4)
        );
      }
    }
  }
  function setupTimingPattern(qr){
    for(let r=8;r<qr.moduleCount-8;r++){
      if(qr.modules[r][6]==null){
        qr.modules[r][6]=(r%2===0);
      }
    }
    for(let c=8;c<qr.moduleCount-8;c++){
      if(qr.modules[6][c]==null){
        qr.modules[6][c]=(c%2===0);
      }
    }
  }
  function setupPositionAdjustPattern(qr){
    const pos=QRUtil.getPatternPosition(qr.typeNumber);
    for(let i=0;i<pos.length;i++){
      for(let j=0;j<pos.length;j++){
        const row=pos[i],col=pos[j];
        if(qr.modules[row][col]!=null)continue;
        for(let r=-2;r<=2;r++){
          for(let c=-2;c<=2;c++){
            qr.modules[row+r][col+c]=(
              r===-2||r===2||c===-2||c===2||(r===0&&c===0)
            );
          }
        }
      }
    }
  }
  function setupTypeInfo(qr){
    const data=QRUtil.getBCHTypeInfo((0<<3)|qr.maskPattern);
    for(let i=0;i<15;i++){
      const mod=((data>>i)&1)===1;
      if(i<6){
        qr.modules[i][8]=mod;
      }else if(i<8){
        qr.modules[i+1][8]=mod;
      }else{
        qr.modules[qr.moduleCount-15+i][8]=mod;
      }
    }
    for(let i=0;i<15;i++){
      const mod2=((data>>i)&1)===1;
      if(i<8){
        qr.modules[8][qr.moduleCount-i-1]=mod2;
      }else if(i<9){
        qr.modules[8][15-i-1+1]=mod2;
      }else{
        qr.modules[8][15-i-1]=mod2;
      }
    }
    qr.modules[qr.moduleCount-8][8]=true;
  }

  function QRBitBufferWrapper(dataList){
    const rsBlocks=makeRSBlocks();
    const buffer=new QRBitBuffer();
    for(let i=0;i<dataList.length;i++){
      const data=dataList[i];
      buffer.put(4,4); // mode 8bit byte
      buffer.put(data.getLength(),8);
      data.write(buffer);
    }
    const totalDataCount=rsBlocks[0].dataCount;
    if(buffer.getLengthInBits()>totalDataCount*8){
      throw new Error("Data too big");
    }
    for(let i=0;i<4 && buffer.getLengthInBits()<totalDataCount*8;i++){
      buffer.put(0,1);
    }
    while(buffer.getLengthInBits()%8!==0){
      buffer.putBit(false);
    }
    const padBytes=[0xec,0x11];
    let idx=0;
    while(buffer.getLengthInBits()<totalDataCount*8){
      buffer.put(padBytes[idx%2],8);
      idx++;
    }

    const dataWords=[];
    for(let i=0;i<totalDataCount;i++){
      dataWords.push(0xff & buffer.buffer[i]);
    }

    const ecCount=rsBlocks[0].totalCount-rsBlocks[0].dataCount;
    const rsPoly=getErrorCorrectPolynomial(ecCount);
    const modPoly=new QRPolynomial(dataWords,0).mod(rsPoly);
    const ecWords=new Array(ecCount);
    for(let i=0;i<ecWords.length;i++){
      ecWords[i]=modPoly.get(i);
    }

    const codewords=[];
    for(let i=0;i<rsBlocks[0].dataCount;i++){
      codewords.push(dataWords[i]);
    }
    for(let i=0;i<ecWords.length;i++){
      codewords.push(ecWords[i]);
    }

    return codewords;
  }
  function getErrorCorrectPolynomial(ecCount){
    let a=new QRPolynomial([1],0);
    for(let i=0;i<ecCount;i++){
      a=a.multiply(new QRPolynomial([1,QRMath.gexp(i)],0));
    }
    return a;
  }
  function mapData(qr,codewords){
    let inc=-1;
    let row=qr.moduleCount-1;
    let bitIndex=7;
    let byteIndex=0;

    for(let col=qr.moduleCount-1;col>0;col-=2){
      if(col===6) col--;
      for(;;){
        for(let c=0;c<2;c++){
          if(qr.modules[row][col-c]==null){
            let dark=false;
            if(byteIndex<codewords.length){
              dark = ((codewords[byteIndex]>>>bitIndex)&1)===1;
            }
            dark = dark ^ QRUtil.getMask(0,row,col-c);
            qr.modules[row][col-c]=dark;
            bitIndex--;
            if(bitIndex===-1){
              byteIndex++;
              bitIndex=7;
            }
          }
        }
        row+=inc;
        if(row<0||qr.moduleCount<=row){
          row-=inc;
          inc=-inc;
          break;
        }
      }
    }
  }
  function createData(typeNumber,dataList){
    return QRBitBufferWrapper(dataList);
  }

  function makeQRToCanvas(text, canvas, scale){
    const qr = new QRCode(2,0);
    qr.addData(text);
    qr.make();

    const ctx = canvas.getContext("2d");
    const count = qr.moduleCount;
    const sizePerModule = scale || 6;
    const size = count * sizePerModule;

    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0,0,size,size);

    ctx.fillStyle = "#000";
    for (let r=0;r<count;r++){
      for (let c=0;c<count;c++){
        if (qr.isDark(r,c)){
          ctx.fillRect(
            c*sizePerModule,
            r*sizePerModule,
            sizePerModule,
            sizePerModule
          );
        }
      }
    }
  }

  window.__ENT_makeQRToCanvas = makeQRToCanvas;
})();

// -------- Safe initialiser --------
document.addEventListener('DOMContentLoaded', () => {
  // Try to bind elements
  const els = {
    packSelect:        document.getElementById('packSelect'),
    packUrlPreview:    document.getElementById('packUrlPreview'),
    packContents:      document.getElementById('packContents'),
    leafletListEl:     document.getElementById('leafletList'),
    customUrlPreview:  document.getElementById('customUrlPreview'),
    contentsPreview:   document.getElementById('contentsPreview'),
    qrCanvas:          document.getElementById('qrCanvas'),
    downloadBtn:       document.getElementById('downloadBtn'),
    customMakeBtn:     document.getElementById('customMakeBtn'),
    diag:              document.getElementById('diag')
  };

  // If we can't even show diag, bail without crashing
  if (!els.diag) {
    console.warn("qr.js: no #diag element found at all. Stopping.");
    return;
  }

  // Report what we found
  els.diag.textContent = "Binding elements..." +
    "\npackSelect: "      + !!els.packSelect +
    "\nleafletListEl: "   + !!els.leafletListEl +
    "\nqrCanvas: "        + !!els.qrCanvas +
    "\ncustomMakeBtn: "   + !!els.customMakeBtn;

  // If we don't have core elements, don't continue past this point
  if (!els.packSelect || !els.leafletListEl || !els.qrCanvas || !els.customMakeBtn) {
    els.diag.textContent += "\nMissing required elements. Check that qr.html still has the original IDs.";
    return;
  }

  // If we get here, proceed to fetch data
  const LANDING_BASE = window.location.origin + window.location.pathname.replace(/qr\.html$/, 'landing.html');

  let packs = {};
  let leaflets = [];
  let currentQrUrl = '';

  Promise.all([
    fetch('packs.json?v=' + Date.now(), {cache:'no-store'}).then(r=>r.json()),
    fetch('leaflets.json?v=' + Date.now(), {cache:'no-store'}).then(r=>r.json())
  ])
  .then(([packsData, leafletsData])=>{
    packs = packsData || {};
    leaflets = leafletsData || [];

    els.diag.textContent +=
      "\nLoaded packs: " + Object.keys(packs).length +
      "\nLoaded leaflets: " + leaflets.length;

    setupPackMode();
    setupCustomMode();
  })
  .catch(err=>{
    els.diag.textContent += "\nError loading data: " + err.message;
  });

  function setupPackMode(){
    const keys = Object.keys(packs);
    if (!keys.length){
      els.packSelect.innerHTML = '<option value="">(no packs)</option>';
      return;
    }

    els.packSelect.innerHTML = keys.sort().map(id =>
      `<option value="${id}">${id}</option>`
    ).join('');

    els.packSelect.addEventListener('change', ()=>{
      updatePackPreview(els.packSelect.value);
    });

    updatePackPreview(keys.sort()[0]);
  }

  function updatePackPreview(packId){
    if (!packId){
      if (els.packUrlPreview) els.packUrlPreview.textContent = '';
      if (els.packContents)   els.packContents.textContent   = '';
      return;
    }

    const ids = packs[packId] || [];
    const url = LANDING_BASE + '?pack=' + encodeURIComponent(packId);

    if (els.packUrlPreview) els.packUrlPreview.textContent = url;

    const lines = ids
      .map(id => leaflets.find(l => String(l.id) === String(id)))
      .filter(Boolean)
      .map(l => `• ${l.Title}`);

    if (els.packContents) els.packContents.textContent = lines.join('\n');

    currentQrUrl = url;
    if (els.qrCanvas && window.__ENT_makeQRToCanvas){
      window.__ENT_makeQRToCanvas(url, els.qrCanvas, 6);
    }

    if (els.downloadBtn){
      els.downloadBtn.onclick = ()=>{
        downloadQR('pack-' + packId);
      };
    }
  }

  function setupCustomMode(){
    const byCat = {};
    leaflets.forEach(l =>{
      const cat = l.Category || 'Other';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(l);
    });

    els.leafletListEl.innerHTML = Object.keys(byCat).sort().map(cat=>{
      const rows = byCat[cat]
        .sort((a,b)=>String(a.Title).localeCompare(String(b.Title)))
        .map(l => `
          <div class="leaflet-item">
            <input type="checkbox"
                   class="leaflet-check"
                   value="${l.id}"
                   style="margin-top:2px;flex-shrink:0;">
            <div>
              <div class="leaflet-title">${escapeHTML(l.Title)}</div>
              <div class="leaflet-cat">${escapeHTML(cat)}</div>
            </div>
          </div>
        `).join('');

      return `
        <div>
          <div class="cat-head">${escapeHTML(cat)}</div>
          ${rows}
        </div>
      `;
    }).join('');

    els.customMakeBtn.addEventListener('click', ()=>{
      const chosenIds = Array
        .from(els.leafletListEl.querySelectorAll('.leaflet-check'))
        .filter(b => b.checked)
        .map(b => b.value);

      if (!chosenIds.length){
        if (els.customUrlPreview) els.customUrlPreview.textContent = '(Choose at least one leaflet)';
        if (els.contentsPreview)  els.contentsPreview.textContent  = '';
        return;
      }

      const url = LANDING_BASE + '?ids=' + chosenIds.join(',');
      if (els.customUrlPreview) els.customUrlPreview.textContent = url;

      const lines = chosenIds
        .map(id => leaflets.find(l => String(l.id) === String(id)))
        .filter(Boolean)
        .map(l => `• ${l.Title}`);
      if (els.contentsPreview) els.contentsPreview.textContent = lines.join('\n');

      currentQrUrl = url;
      if (els.qrCanvas && window.__ENT_makeQRToCanvas){
        window.__ENT_makeQRToCanvas(url, els.qrCanvas, 6);
      }

      if (els.downloadBtn){
        els.downloadBtn.onclick = ()=>{
          downloadQR('custom-' + chosenIds.join('-'));
        };
      }
    });
  }

  function downloadQR(name){
    const link = document.createElement('a');
    link.download = name + '.png';
    link.href = els.qrCanvas.toDataURL('image/png');
    link.click();
  }

  function escapeHTML(s){
    return (s||'').replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
    }[m]));
  }
});