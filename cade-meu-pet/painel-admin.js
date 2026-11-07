/* Cadê Meu Pet: Painel Administrativo principal - leitura, sem alterar os envios. */
import {auth, db} from './firebase-config.js';
import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import {collection, getDocs, query, orderBy, limit} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';

const ADMIN_UID = 'dkquzbj6D2ZXIH7t9j61Z36er3t2';
const $ = id => document.getElementById(id);
let logadoAdmin = false;
let inscricoes = new Map();
let carregando = false;
let detalheNumero = 0;
const style = document.createElement('style');
style.textContent = `
#cade-admin-botao{display:none;background:#083e54;color:white;border:0;border-radius:13px;padding:11px 15px;font:800 13px Nunito,Arial,sans-serif;cursor:pointer}
#cade-admin-painel{display:none;position:fixed;inset:0;z-index:99999;background:#071c2dcc;padding:10px;overflow-y:auto;font-family:Nunito,Arial,sans-serif}
#cade-admin-painel.aberto{display:block}
#cade-admin-painel *{box-sizing:border-box}
.cade-admin-janela{max-width:1050px;margin:15px auto;background:#f4f9fa;color:#153846;border-radius:22px;overflow:hidden}
.cade-admin-topo{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:21px;background:#006b75;color:white}
.cade-admin-topo h2{margin:3px 0;color:white;font-size:24px}
.cade-admin-corpo{padding:18px}
.cade-admin-aviso{padding:13px;background:#fff5df;border-radius:13px;font-size:13px;line-height:1.55}
.cade-admin-acoes{margin:15px 0;display:flex;gap:10px;flex-wrap:wrap}
.cade-admin-acao,.cade-admin-fechar{border:0;border-radius:12px;padding:11px 15px;background:#e74769;color:white;font-weight:800;cursor:pointer}
.cade-admin-fechar{background:#ffffff33;border:1px solid #ffffff77}
.cade-admin-acao:disabled{opacity:.5}
.cade-admin-status{font-weight:800;color:#006b75;font-size:13px}
.cade-admin-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin:14px 0 20px}
.cade-admin-card{border:1px solid #d4e5e8;background:white;border-radius:16px;padding:15px;min-width:0}
.cade-admin-card small{display:block;color:#617b83;font-size:12px}
.cade-admin-card strong{display:block;font-size:31px;color:#006b75;margin:7px 0}
.cade-admin-bloco{background:white;border:1px solid #d4e5e8;border-radius:17px;padding:17px;margin-top:17px}
.cade-admin-bloco h3{margin:0;font-size:19px}
.cade-admin-sub{font-size:12px;color:#637e85;line-height:1.5}
.cade-admin-lista{display:grid;gap:9px;margin-top:12px}
.cade-admin-linha{border:1px solid #d9e6e9;border-radius:12px;padding:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0}
.cade-admin-linha strong,.cade-admin-linha small{display:block;overflow-wrap:anywhere}
.cade-admin-linha strong{font-size:13px}.cade-admin-linha small{font-size:11px;color:#68818a;margin-top:4px}
.cade-admin-etiqueta{padding:7px 10px;border-radius:18px;background:#dcf6eb;color:#126849;font-size:11px;font-weight:900}
.cade-admin-etiqueta.erro{background:#ffe5e9;color:#aa2c44}
.cade-admin-etiqueta.neutro{background:#ecf1f4;color:#63717b}
.cade-admin-ver{border:0;border-radius:10px;padding:9px 12px;cursor:pointer;background:#def2f3;color:#006b75;font-weight:800}
.cade-admin-vazio{padding:14px;background:#f2f8f9;border-radius:12px;color:#557078;font-size:13px}
.cade-admin-detalhes{margin-top:17px;border-top:1px solid #d4e5e8;padding-top:15px}
@media(max-width:700px){.cade-admin-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cade-admin-corpo{padding:12px}.cade-admin-card{padding:11px}.cade-admin-card strong{font-size:25px}}
`;
document.head.append(style);
const criar=(tag,txt,cls)=>{const x=document.createElement(tag);if(txt!==undefined)x.textContent=txt;if(cls)x.className=cls;return x;};
const numero=x=>Number(x||0);
const curto=s=>{s=String(s||'');return s.length>17?s.slice(0,9)+'...'+s.slice(-5):(s||'—');};
const data=x=>x?.toDate?.().toLocaleString('pt-BR')||'Data indisponível';
const botao=criar('button','👑 Painel Admin');botao.id='cade-admin-botao';botao.type='button';
(document.querySelector('.actions')||document.querySelector('.header-inner')||document.body).append(botao);
const painel=criar('div');painel.id='cade-admin-painel';
painel.innerHTML=`<div class="cade-admin-janela"><header class="cade-admin-topo"><div><small>🐾 CADÊ MEU PET</small><h2>👑 Painel Administrativo</h2><small>Inscrições e resultados do serviço push</small></div><button type="button" id="cade-admin-fechar" class="cade-admin-fechar">✕ Fechar</button></header><div class="cade-admin-corpo"><div class="cade-admin-aviso">Uma inscrição não significa um telefone único. Envio aceito pelo serviço push não confirma que a notificação apareceu na tela.</div><div class="cade-admin-acoes"><button type="button" id="cade-admin-atualizar" class="cade-admin-acao">🔄 Atualizar relatório</button></div><p id="cade-admin-mensagem" class="cade-admin-status" role="status"></p><div class="cade-admin-grid"><div class="cade-admin-card"><small>📱 Inscrições</small><strong id="cade-total">—</strong></div><div class="cade-admin-card"><small>🔔 Ativas</small><strong id="cade-ativas">—</strong></div><div class="cade-admin-card"><small>👥 Contas</small><strong id="cade-contas">—</strong></div><div class="cade-admin-card"><small>⚠️ Inativas</small><strong id="cade-inativas">—</strong></div></div><section class="cade-admin-bloco"><h3>📱 Dispositivos inscritos</h3><p class="cade-admin-sub">Identificadores abreviados. Sem expor tokens e chaves.</p><div class="cade-admin-lista" id="cade-lista-inscricoes"></div></section><section class="cade-admin-bloco"><h3>📢 Histórico de envios</h3><p class="cade-admin-sub">Até 30 anúncios processados recentemente.</p><div class="cade-admin-grid"><div class="cade-admin-card"><small>✅ Aceitos</small><strong id="cade-aceitos">—</strong></div><div class="cade-admin-card"><small>❌ Recusados</small><strong id="cade-recusados">—</strong></div><div class="cade-admin-card"><small>⌛ Expirados</small><strong id="cade-expirados">—</strong></div><div class="cade-admin-card"><small>📤 Tentativas</small><strong id="cade-tentativas">—</strong></div></div><div class="cade-admin-lista" id="cade-lista-anuncios"></div><div id="cade-admin-detalhes" class="cade-admin-detalhes" hidden><h3>🔎 Envios por inscrição</h3><p id="cade-detalhes-titulo" class="cade-admin-sub"></p><div class="cade-admin-lista" id="cade-lista-destinatarios"></div></div></section></div></div>`;
document.body.append(painel);
const vazio=(id,msg)=>$(id).replaceChildren(criar('p',msg,'cade-admin-vazio'));
function linha(titulo,descricao,estado,tipo){const e=criar('div',undefined,'cade-admin-linha');const d=criar('div');d.append(criar('strong',titulo),criar('small',descricao));e.append(d);if(estado)e.append(criar('span',estado,'cade-admin-etiqueta'+(tipo?' '+tipo:'')));return e;}
async function carregarInscricoes(){
  const res=await getDocs(collection(db,'pushSubscriptions'));
  const contas=new Set();let ativas=0;inscricoes.clear();
  for(const d of res.docs){const v=d.data();inscricoes.set(d.id,v);if(v.uid)contas.add(v.uid);if(v.enabled===true)ativas++;}
  $('cade-total').textContent=res.size;$('cade-ativas').textContent=ativas;$('cade-contas').textContent=contas.size;$('cade-inativas').textContent=res.size-ativas;
  const lista=$('cade-lista-inscricoes');lista.replaceChildren();
  const docs=[...res.docs].sort((a,b)=>(b.data().updatedAt?.toMillis?.()||0)-(a.data().updatedAt?.toMillis?.()||0));
  for(const d of docs){const v=d.data();lista.append(linha('Inscrição '+curto(d.id),`Conta: ${curto(v.uid)} • Município: ${v.municipio||'—'} • Atualizada: ${data(v.updatedAt)}`,v.enabled===true?'ATIVA':'INATIVA',v.enabled===true?'':'erro'));}
  if(!docs.length)vazio('cade-lista-inscricoes','Nenhuma inscrição cadastrada.');
}
async function carregarHistorico(){
  const r=await getDocs(query(collection(db,'pushDispatches'),orderBy('processadoEm','desc'),limit(30)));
  let aceitos=0,recusados=0,expirados=0,tentativas=0;const lista=$('cade-lista-anuncios');lista.replaceChildren();$('cade-admin-detalhes').hidden=true;
  for(const d of r.docs){const v=d.data();aceitos+=numero(v.enviosAceitos);recusados+=numero(v.inscricoesRecusadas);expirados+=numero(v.inscricoesExpiradas);tentativas+=numero(v.tentativas);
    const item=linha(`${v.situacao||'Animal'} — ${v.municipio||'Local não informado'}`,`Anúncio: ${curto(d.id)} • ${data(v.processadoEm)} • ✅ ${numero(v.enviosAceitos)} aceitos • ❌ ${numero(v.inscricoesRecusadas)} recusados • 📤 ${numero(v.tentativas)} tentativas`);
    const btn=criar('button','Ver envios','cade-admin-ver');btn.type='button';btn.onclick=()=>carregarDestinatarios(d.id);item.append(btn);lista.append(item);
  }
  $('cade-aceitos').textContent=aceitos;$('cade-recusados').textContent=recusados;$('cade-expirados').textContent=expirados;$('cade-tentativas').textContent=tentativas;
  if(r.empty)vazio('cade-lista-anuncios','Ainda não existem envios processados com data.');
}
async function carregarDestinatarios(id){
  const n=++detalheNumero;$('cade-admin-detalhes').hidden=false;$('cade-detalhes-titulo').textContent='Anúncio: '+curto(id);vazio('cade-lista-destinatarios','Carregando destinatários...');
  try{const r=await getDocs(collection(db,'pushDispatches',id,'recipients'));if(n!==detalheNumero)return;const lista=$('cade-lista-destinatarios');lista.replaceChildren();
    for(const d of r.docs){const v=d.data(),inscricaoId=v.inscricaoId||d.id,ins=inscricoes.get(inscricaoId),estado=v.status||'desconhecido',tipo=estado==='recusado'||estado==='expirado'?'erro':estado==='aceito'?'':'neutro';lista.append(linha('Inscrição '+curto(inscricaoId),`Conta: ${curto(v.uid||ins?.uid)} • Região: ${ins?.municipio||'—'} • ${data(v.registradoEm||v.aceitoEm)}`,estado.toUpperCase()+(v.codigo?' ('+v.codigo+')':''),tipo));}
    if(r.empty)vazio('cade-lista-destinatarios','Nenhuma entrega individual registrada.');
  }catch(e){vazio('cade-lista-destinatarios','Erro: '+e.message);}
}
async function atualizar(){if(!logadoAdmin||carregando)return;carregando=true;$('cade-admin-atualizar').disabled=true;$('cade-admin-mensagem').textContent='Consultando Firebase...';
  try{await carregarInscricoes();await carregarHistorico();$('cade-admin-mensagem').textContent='✅ Atualizado às '+new Date().toLocaleTimeString('pt-BR');}
  catch(e){console.error(e);$('cade-admin-mensagem').textContent='❌ Falha: '+(e.code==='permission-denied'?'Verifique as regras de leitura administrativa do Firestore.':e.message);}
  finally{carregando=false;$('cade-admin-atualizar').disabled=false;}
}
function fechar(){painel.classList.remove('aberto');document.body.style.overflow='';}
botao.onclick=()=>{if(!logadoAdmin)return;painel.classList.add('aberto');document.body.style.overflow='hidden';atualizar();};
$('cade-admin-fechar').onclick=fechar;
painel.addEventListener('click',e=>{if(e.target===painel)fechar();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')fechar();});
$('cade-admin-atualizar').onclick=atualizar;
onAuthStateChanged(auth,user=>{logadoAdmin=!!user&&user.uid===ADMIN_UID;botao.style.display=logadoAdmin?'inline-flex':'none';if(!logadoAdmin)fechar();});
