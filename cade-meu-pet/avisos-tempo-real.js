/* Cadê Meu Pet — avisos novos em tempo real dentro do site. */
import {db} from './firebase-config.js';
import {collection, onSnapshot, query, limit, orderBy} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';

const $ = id => document.getElementById(id);
const container = $('avisos-lista');
const badge = $('notif-badge');
const toast = $('aviso-toast');
const vistos = new Set();
let inicializado = false;
let pendentes = 0;

function classificacao(animal) {
  const tipo = String(animal.tipo || '').toLowerCase();
  const status = String(animal.status || '').toLowerCase();
  const nome = tipo === 'cachorro' ? 'cachorro' : tipo === 'gato' ? 'gato' : 'animal';
  const simbolo = tipo === 'cachorro' ? '🐶' : tipo === 'gato' ? '🐱' : '🐾';
  const acao = status === 'perdido' ? 'perdido' : status === 'encontrado' ? 'encontrado' : status === 'reencontrado' ? 'reencontrado' : 'cadastrado';
  return {titulo: `${simbolo} Novo ${nome} ${acao}!`, nome};
}

function mensagem(animal) {
  const {titulo} = classificacao(animal);
  return `${titulo} ${animal.nome || 'Sem nome'} — ${animal.bairro || 'Bairro não informado'}, ${animal.municipio || 'Município não informado'}.`;
}

function mostrar(lista) {
  if (!container) return;
  container.replaceChildren();
  if (!lista.length) {
    const p = document.createElement('p');
    p.className = 'message';
    p.textContent = 'Ainda não há avisos recentes.';
    container.appendChild(p);
    return;
  }
  for (const a of lista) {
    const card = document.createElement('article');
    card.className = 'aviso-item';
    if (typeof a.fotoUrl === 'string' && a.fotoUrl.startsWith('https://')) {
      const img = document.createElement('img');
      img.src = a.fotoUrl;
      img.alt = `Foto de ${a.nome || 'animal'}`;
      img.loading = 'lazy';
      card.appendChild(img);
    }
    const bloco = document.createElement('div');
    const titulo = document.createElement('strong');
    titulo.textContent = classificacao(a).titulo;
    const desc = document.createElement('p');
    desc.textContent = `${a.nome || 'Sem nome'} — ${a.bairro || 'Local não informado'}, ${a.municipio || ''}`;
    const link = document.createElement('a');
    link.href = '#animais';
    link.textContent = 'Ver animais cadastrados';
    bloco.append(titulo, desc, link);
    card.appendChild(bloco);
    container.appendChild(card);
  }
}

function notificar(a) {
  pendentes++;
  if (badge) {badge.hidden = false; badge.textContent = pendentes > 99 ? '99+' : String(pendentes);}
  if (toast) {
    toast.textContent = mensagem(a) + ' Toque para ver.';
    toast.hidden = false;
    toast.onclick = () => {toast.hidden = true; location.hash = '#animais';};
  }
}

$('avisos-limpar')?.addEventListener('click', () => {
  pendentes = 0;
  if (badge) badge.hidden = true;
  if (toast) toast.hidden = true;
});
$('btn-alertas')?.addEventListener('click', () => {
  pendentes = 0;
  if (badge) badge.hidden = true;
  if (toast) toast.hidden = true;
  location.hash = '#avisos-recentes';
});

// Não mostrar anúncios antigos como novidades quando a página é aberta.
const q = query(collection(db, 'pets'), orderBy('criadoEm', 'desc'), limit(30));
onSnapshot(q, snapshot => {
  const lista = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
  if (inicializado) {
    for (const change of snapshot.docChanges()) {
      if (change.type !== 'added') continue;
      const d = change.doc;
      if (vistos.has(d.id)) continue;
      const a = {id: d.id, ...d.data()};
      const segundos = a.criadoEm?.seconds || 0;
      if (segundos && Date.now() / 1000 - segundos < 120) notificar(a);
    }
  }
  lista.forEach(a => vistos.add(a.id));
  inicializado = true;
  mostrar(lista);
}, erro => {
  console.error('Avisos em tempo real:', erro);
  if (container) container.textContent = 'Não foi possível carregar os avisos.';
});
