// ====== CONFIG ======
// For GitHub Pages default, this auto-guesses landing.html next to qr.html.
// Later, when you move to your private domain, replace with:
// const LANDING_BASE = "https://aftercare.your-private-domain/landing.html";
const LANDING_BASE = window.location.origin + window.location.pathname.replace(/qr\.html$/, 'landing.html');

// ====== minimal QR generator ======
(function(){
  function QR8bitByte(data){this.data=data;}
  QR8bitByte.prototype={getLength:function(){return this.data.length;},write:function(buf){for(var i=0;i<this.data.length;i++){buf.put(this.data.charCodeAt(i),8);}}};

  var QRUtil={
    PATTERN_POSITION_TABLE:[[],[6,18],[6,22],[6,26],[6,30],[6,34]],
    getPatternPosition:function(t){return QRUtil.PATTERN_POSITION_TABLE[t-1];},
    getBCHDigit:function(data){var digit=0;while(data!==0){digit++;data>>>=1;}return digit;},
    getBCHTypeInfo:function(data){
      var d=data<<10;
      while(QRUtil.getBCHDigit(d)-QRUtil.getBCHDigit(0x537)!==0){
        d^=(0x537<<(QRUtil.getBCHDigit(d)-QRUtil.getBCHDigit(0x537)-0));
      }
      return((data<<10)|d)^0x5412;
    },
    getMask:function(maskPattern,i,j){
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
    get:function(i){var bufIndex=Math.floor(i/8);return((this.buffer[bufIndex]>>>(7-i%8))&1)===1;},
    put:function(num,length){for(var i=0;i<length;i++){this.putBit(((num>>>(length-i-1))&1)===1);}},
    getLengthInBits:function(){return this.length;},
    putBit:function(bit){
      var bufIndex=Math.floor(this.length/8);
      if(this.buffer.length<=bufIndex){this.buffer.push(0);}
      if(bit){this.buffer[bufIndex]|=(0x80>>>(this.length%8));}
      this.length++;
    }
  };

  var QRMath={};
  QRMath.gexp=function(n){while(n<0){n+=255;}while(n>=256){n-=255;}return QRMath.EXP_TABLE[n];};
  QRMath.glog=function(n){if(n<1)throw new Error("glog("+n+")");return QRMath.LOG_TABLE[n];};
  QRMath.EXP_TABLE=new Array(256);
  QRMath.LOG_TABLE=new Array(256);
  for(var i=0;i<8;i++){QRMath.EXP_TABLE[i]=1<<i;}
  for(i=8;i<256;i++){QRMath.EXP_TABLE[i]=QRMath.EXP_TABLE[i-4]^QRMath.EXP_TABLE[i-5]^QRMath.EXP_TABLE[i-6]^QRMath.EXP_TABLE[i-8];}
  for(i=0;i<256;i++){QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]]=i;}

  function QRPolynomial(num,shift){
    var offset=0;
    while(offset<num.length&&num[offset]===0){offset++;}
    this.num=new Array(num.length-offset+shift);
    for(var i2=0;i2<num.length-offset;i2++){this.num[i2]=num[i2+offset];}
  }
  QRPolynomial.prototype={
    get:function(index){return this.num[index];},
    getLength:function(){return this.num.length;},
    multiply:function(e){
      var num=new Array(this.getLength()+e.getLength()-1);
      for(var i=0;i<this.getLength();i++){
        for(var j=0;j<e.getLength();j++){
          num[i+j]^=QRMath.gexp(QRMath.glog(this.get(i))+QRMath.glog(e.get(j)));
        }
      }
      return new QRPolynomial(num,0);
    },
    mod:function(e){
      if(this.getLength()-e.getLength()<0){return this;}
      var ratio=QRMath.glog(this.get(0))-QRMath.glog(e.get(0));
      var num=new Array(this.getLength());
      for(var i=0;i<this.getLength();i++){num[i]=this.get(i);}
      for(i=0;i<e.getLength();i++){num[i]^=QRMath.gexp(QRMath.glog(e.get(i))+ratio);}
      return new QRPolynomial(num,0).mod(e);
    }
  };

  function makeRSBlocks(){
    // Version 2-L only; enough for these short URLs
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
    addData:function(data){this.dataList.push(new QR8bitByte(data));},
    make:function(){
      this.moduleCount=this.typeNumber*4+17;
      this.modules=new Array(this.moduleCount);
      for(var row=0;row<this.moduleCount;row++){
        this.modules[row]=new Array(this.moduleCount);
        for(var col=0;col<this.moduleCount;col++){
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

      var data=createData(this.typeNumber,this.dataList);
      mapData(this,data);
    },
    isDark:function(row,col){return this.modules[row][col];}
  };

  function setupPositionProbePattern(qr,row,col){
    for(var r=-1;r<=7;r++){
      if(row+r<=-1||qr.moduleCount<=row+r)continue;
      for(var c=-1;c<=7;c++){
        if(col+c<=-1||qr.moduleCount<=col+c)continue;
        qr.modules[row+r][col+c]=(r>=0&&r<=6&&(c===0||c===6)) ||
                                  (c>=0&&c<=6&&(r===0||r===6)) ||
                                  (r>=2&&r<=4&&c>=2&&c<=4);
      }
    }
  }
  function setupTimingPattern(qr){
    for(var r=8;r<qr.moduleCount-8;r++){
      if(qr.modules[r][6]==null){qr.modules[r][6]=(r%2===0);}
    }
    for(var c=8;c<qr.moduleCount-8;c++){
      if(qr.modules[6][c]==null){qr.modules[6][c]=(c%2===0);}
    }
  }
  function setupPositionAdjustPattern(qr){
    var pos=QRUtil.getPatternPosition(qr.typeNumber);
    for(var i=0;i<pos.length;i++){
      for(var j=0;j<pos.length;j++){
        var row=pos[i],col=pos[j];
        if(qr.modules[row][col]!=null)continue;
        for(var r=-2;r<=2;r++){
          for(var c=-2;c<=2;c++){
            qr.modules[row+r][col+c]=(r===-2||r===2||c===-2||c===2)||(r===0&&c===0);
          }
        }
      }
    }
  }
  function setupTypeInfo(qr){
    var data=QRUtil.getBCHTypeInfo((0<<3)|qr.maskPattern);
    for(var i=0;i<15;i++){
      var mod=((data>>i)&1)===1;
      if(i<6){
        qr.modules[i][8]=mod;
      }else if(i<8){
        qr.modules[i+1][8]=mod;
      }else{
        qr.modules[qr.moduleCount-15+i][8]=mod;
      }
    }
    for(i=0;i<15;i++){
      var mod2=((data>>i)&1)===1;
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
    var rsBlocks=makeRSBlocks();
    var buffer=new QRBitBuffer();
    for(var i=0;i<dataList.length;i++){
      var data=dataList[i];
      buffer.put(4,4); // mode 8bit byte
      buffer.put(data.getLength(),8);
      data.write(buffer);
    }
    var totalDataCount=rsBlocks[0].dataCount;
    if(buffer.getLengthInBits()>totalDataCount*8){
      throw new Error("Data too big");
    }
    for(i=0;i<4 && buffer.getLengthInBits()<totalDataCount*8;i++){
      buffer.put(0,1);
    }
    while(buffer.getLengthInBits()%8!==0){
      buffer.putBit(false);
    }
    var padBytes=[0xec,0x11];var idx=0;
    while(buffer.getLengthInBits()<totalDataCount*8){
      buffer.put(padBytes[idx%2],8);idx++;
    }
    var dataWords=[];
    for(i=0;i<totalDataCount;i++){
      dataWords.push(0xff & buffer.buffer[i]);
    }
    var ecCount=rsBlocks[0].totalCount-rsBlocks[0].dataCount;
    var rsPoly=getErrorCorrectPolynomial(ecCount);
    var modPoly=new QRPolynomial(dataWords,0).mod(rsPoly);
    var ecWords=new Array(ecCount);
    for(i=0;i<ecWords.length;i++){
      ecWords[i]=modPoly.get(i);
    }
    var codewords=[];
    for(i=0;i<rsBlocks[0].dataCount;i++){
      codewords.push(dataWords[i]);
    }
    for(i=0;i<ecWords.length;i++){
      codewords.push(ecWords[i]);
    }
    return codewords;
  }
  function getErrorCorrectPolynomial(ecCount){
    var a=new QRPolynomial([1],0);
    for(var i=0;i<ecCount;i++){
      a=a.multiply(new QRPolynomial([1,QRMath.gexp(i)],0));
    }
    return a;
  }
  function mapData(qr,codewords){
    var inc=-1;
    var row=qr.moduleCount-1;
    var bitIndex=7;
    var byteIndex=0;

    for(var col=qr.moduleCount-1;col>0;col-=2){
      if(col===6) col--;
      for(;;){
        for(var c=0;c<2;c++){
          if(qr.modules[row][col-c]==null){
            var dark=false;
            if(byteIndex<codewords.length){
              dark = ((codewords[byteIndex]>>>bitIndex)&1)===1;
            }
            dark = dark ^ QRUtil.getMask(qr.maskPattern,row,col-c);
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
    var qr = new QRCode(2,0);
    qr.addData(text);
    qr.make();

    var ctx = canvas.getContext("2d");
    const count = qr.moduleCount;
    const sizePerModule = scale || 6;
    const size = count * sizePerModule;

    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0,0,size,size);

    ctx.fillStyle = "#000";
    for (var r=0;r<count;r++){
      for (var c=0;c<count;c++){
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

  window.makeQRToCanvas = makeQRToCanvas;
})();

// ====== app logic ======
(function(){
  const packSelect       = document.getElementById('packSelect');
  const packUrlPreview   = document.getElementById('packUrlPreview');
  const packContents     = document.getElementById('packContents');

  const leafletListEl    = document.getElementById('leafletList');
  const customUrlPreview = document.getElementById('customUrlPreview');
  const contentsPreview  = document.getElementById('contentsPreview');

  const qrCanvas         = document.getElementById('qrCanvas');
  const downloadBtn      = document.getElementById('downloadBtn');
  const customMakeBtn    = document.getElementById('customMakeBtn');

  const diag             = document.getElementById('diag');

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
    setupPackMode();
    setupCustomMode();
    diag.textContent = 'Loaded ' + Object.keys(packs).length + ' packs and ' + leaflets.length + ' leaflets.';
  })
  .catch(err=>{
    diag.textContent = 'Error loading data: ' + err.message;
  });

  // Pack mode (Option A)
  function setupPackMode(){
    const packOptions = Object.keys(packs).sort()
      .map(id => `<option value="${id}">${id}</option>`)
      .join('');
    packSelect.innerHTML = packOptions;

    packSelect.addEventListener('change', ()=>{
      updatePackPreview(packSelect.value);
    });

    if (Object.keys(packs).length){
      updatePackPreview(Object.keys(packs).sort()[0]);
    }
  }

  function updatePackPreview(packId){
    const ids = packs[packId] || [];
    const url = LANDING_BASE + '?pack=' + encodeURIComponent(packId);
    packUrlPreview.textContent = url;

    const items = ids
      .map(id => leaflets.find(l => String(l.id) === String(id)))
      .filter(Boolean)
      .map(l => `• ${l.Title}`);

    packContents.textContent = items.join('\n');

    currentQrUrl = url;
    makeQRToCanvas(url, qrCanvas, 6);

    downloadBtn.onclick = ()=>{
      downloadQR('pack-' + packId);
    };
  }

  // Custom mode (Option B)
  function setupCustomMode(){
    const byCat = {};
    leaflets.forEach(l =>{
      const cat = l.Category || 'Other';
      (byCat[cat] ||= []).push(l);
    });

    leafletListEl.innerHTML = Object.keys(byCat).sort().map(cat=>{
      const rows = byCat[cat]
        .sort((a,b)=>String(a.Title).localeCompare(String(b.Title)))
        .map(l => {
          return `
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
          `;
        }).join('');
      return `
        <div>
          <div class="cat-head">${escapeHTML(cat)}</div>
          ${rows}
        </div>
      `;
    }).join('');

    customMakeBtn.addEventListener('click', ()=>{
      const chosenIds = Array.from(
        leafletListEl.querySelectorAll('.leaflet-check')
      )
      .filter(b => b.checked)
      .map(b => b.value);

      if (!chosenIds.length){
        customUrlPreview.textContent = '(Choose at least one leaflet)';
        contentsPreview.textContent = '';
        return;
      }

      const url = LANDING_BASE + '?ids=' + chosenIds.join(',');
      customUrlPreview.textContent = url;

      const items = chosenIds
        .map(id => leaflets.find(l => String(l.id) === String(id)))
        .filter(Boolean)
        .map(l => `• ${l.Title}`);
      contentsPreview.textContent = items.join('\n');

      currentQrUrl = url;
      makeQRToCanvas(url, qrCanvas, 6);

      downloadBtn.onclick = ()=>{
        downloadQR('custom-' + chosenIds.join('-'));
      };
    });
  }

  function downloadQR(name){
    const link = document.createElement('a');
    link.download = name + '.png';
    link.href = qrCanvas.toDataURL('image/png');
    link.click();
  }

  function escapeHTML(s){
    return (s||'').replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
    }[m]));
  }
})();