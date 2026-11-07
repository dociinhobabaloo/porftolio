/* Cadê Meu Pet — Mapa GPS v2, com diagnóstico e fallback de biblioteca. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const centros = {
    'Vila Velha': [-20.33,-40.29],
    'Vitória': [-20.30,-40.30],
    'Serra': [-20.12,-40.31],
    'Cariacica': [-20.27,-40.42]
  };
  let mapa = null, camada = null, pontoEscolhido = null, gpsMarker = null;
  let anuncios = [];
  const status = texto => { const area=$('mapa-status'); if(area) area.textContent=texto; };
  const valida=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&lat>-21&&lat<-19&&lng>-41.5&&lng<-39;
  const safe=v=>String(v??'');

  function carregarScript(url) {
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src=url;s.async=true;
      s.onload=resolve;s.onerror=()=>reject(Error('Não foi possível carregar a biblioteca do mapa.'));
      document.head.appendChild(s);
    });
  }
  async function garantirLeaflet() {
    if(window.L) return;
    status('Carregando biblioteca do mapa...');
    const alternativas=[
      'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js'
    ];
    for(const url of alternativas){
      try {await carregarScript(url); if(window.L) return;} catch(err){console.warn('Falha no Leaflet:',url,err);}
    }
    throw Error('O mapa não conseguiu carregar. Verifique a conexão e tente atualizar o aplicativo.');
  }
  function marcarPonto() {
    if(!mapa) return;
    if(pontoEscolhido){mapa.removeLayer(pontoEscolhido);pontoEscolhido=null;}
    const latitude=Number($('pet-lat')?.value),longitude=Number($('pet-lng')?.value);
    const preenchido=$('pet-lat')?.value!==''&&$('pet-lng')?.value!=='';
    if(preenchido&&valida(latitude,longitude)){
      pontoEscolhido=L.circleMarker([latitude,longitude],{radius:12,color:'#b22a52',fillColor:'#e74769',fillOpacity:.6,weight:3}).addTo(mapa);
      pontoEscolhido.bindPopup('Região aproximada selecionada para o anúncio.');
      if($('ponto-preview'))$('ponto-preview').textContent='📍 Região aproximada marcada.';
    } else if($('ponto-preview')) {
      $('ponto-preview').textContent='Nenhum ponto selecionado. O município será usado como referência.';
    }
  }
  function atualizar() {
    if(!mapa||!camada) return;
    camada.clearLayers();
    const municipio=$('mapa-municipio')?.value||'';
    const visiveis=anuncios.filter(a=>a.status!=='Reencontrado'&&(!municipio||a.municipio===municipio));
    const agrupados=new Map();
    let comPonto=0;
    for(const animal of visiveis){
      const lat=Number(animal.latitude),lng=Number(animal.longitude);
      if(animal.latitude!=null&&animal.longitude!=null&&valida(lat,lng)){
        const perdido=animal.status==='Perdido';
        const mark=L.circleMarker([lat,lng],{radius:9,color:perdido?'#b72549':'#047a81',fillColor:perdido?'#e74769':'#08a0a0',fillOpacity:.85,weight:2});
        const popup=document.createElement('div');popup.className='mapa-popup';
        const b=document.createElement('b');b.textContent=`${safe(animal.nome||'Animal')} — ${safe(animal.status)}`;
        const p=document.createElement('p');p.textContent=`${safe(animal.bairro)}, ${safe(animal.municipio)} (região aproximada)`;
        const link=document.createElement('a');link.href='#animais';link.textContent='Ver anúncios';link.style.color='#006b75';
        popup.append(b,p,link);mark.bindPopup(popup).addTo(camada);comPonto++;
      } else if(centros[animal.municipio]){
        const lista=agrupados.get(animal.municipio)||[];lista.push(animal);agrupados.set(animal.municipio,lista);
      }
    }
    for(const [cidade,lista] of agrupados){
      const marker=L.marker(centros[cidade]).addTo(camada);
      const popup=document.createElement('div');popup.className='mapa-popup';
      const title=document.createElement('b');title.textContent=`${cidade}: ${lista.length} anúncio(s)`;
      const detail=document.createElement('p');detail.textContent='Ponto central do município, não o local do animal.';
      const ul=document.createElement('ul');ul.style.paddingLeft='18px';
      lista.slice(0,6).forEach(a=>{const li=document.createElement('li');li.textContent=`${safe(a.nome||'Animal')} (${safe(a.status)})`;ul.append(li)});
      popup.append(title,detail,ul);marker.bindPopup(popup);
    }
    status(`${visiveis.length} anúncio(s) no mapa. ${comPonto} com região aproximada.`);
  }
  async function iniciar(){
    try{
      const elemento=$('mapa-animais');
      if(!elemento) return;
      status('Inicializando o mapa...');
      await garantirLeaflet();
      mapa=L.map(elemento,{scrollWheelZoom:false}).setView([-20.26,-40.34],10);
      window.cadeMapaPronto=true;
      const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
        maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      });
      let loaded=false;
      tiles.on('tileload',()=>{loaded=true;});
      tiles.on('tileerror',()=>{
        if(!loaded) status('O mapa iniciou, mas as imagens do mapa não carregaram. Confira sua conexão.');
      });
      tiles.addTo(mapa);
      camada=L.layerGroup().addTo(mapa);
      mapa.on('click',event=>{
        const lat=Math.round(event.latlng.lat*100)/100,lng=Math.round(event.latlng.lng*100)/100;
        if(!valida(lat,lng)){status('Escolha uma região dentro dos municípios atendidos.');return;}
        if($('pet-lat'))$('pet-lat').value=lat;
        if($('pet-lng'))$('pet-lng').value=lng;
        marcarPonto();status('Região aproximada escolhida. Ela será arredondada ao salvar o anúncio.');
      });
      $('mapa-municipio')?.addEventListener('change',()=>{
        const cidade=$('mapa-municipio').value;
        mapa.setView(centros[cidade]||[-20.26,-40.34],cidade?12:10);atualizar();
      });
      $('pet-cidade')?.addEventListener('change',()=>{
        const cidade=$('pet-cidade').value;
        if(centros[cidade])mapa.setView(centros[cidade],12);
      });
      $('ponto-limpar')?.addEventListener('click',()=>{
        $('pet-lat').value='';$('pet-lng').value='';marcarPonto();
      });
      $('gps-localizar')?.addEventListener('click',()=>{
        if(!navigator.geolocation){status('Seu navegador não disponibiliza GPS.');return;}
        status('Solicitando permissão de localização...');
        navigator.geolocation.getCurrentPosition(pos=>{
          const {latitude,longitude,accuracy}=pos.coords;
          if(gpsMarker)mapa.removeLayer(gpsMarker);
          gpsMarker=L.circle([latitude,longitude],{radius:Math.max(accuracy,25),color:'#006b75',fillColor:'#42c7d0',fillOpacity:.17}).addTo(mapa);
          mapa.setView([latitude,longitude],14);
          status('Sua localização foi mostrada no mapa. Não foi salva nem publicada.');
        },err=>status(err.code===1?'A permissão de GPS foi negada.':'Não foi possível localizar. Verifique GPS e conexão.'),{enableHighAccuracy:false,timeout:13000,maximumAge:60000});
      });
      window.addEventListener('cade:location-edit',marcarPonto);
      window.addEventListener('cade:pets',e=>{anuncios=Array.isArray(e.detail)?e.detail:[];atualizar()});
      if(Array.isArray(window.CadeMeuPet?.animais))anuncios=window.CadeMeuPet.animais;
      marcarPonto();atualizar();
      // Corrige o tamanho se o painel foi renderizado antes de estar visível.
      setTimeout(()=>mapa.invalidateSize(),350);
      window.addEventListener('resize',()=>mapa.invalidateSize());
    }catch(erro){
      console.error('Cadê Meu Pet - Falha no mapa:',erro);
      status(`Não foi possível abrir o mapa: ${erro.message||'erro desconhecido'}`);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar,{once:true});else iniciar();
})();
