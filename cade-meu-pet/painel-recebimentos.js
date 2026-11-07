
/*
========================================
CADÊ MEU PET
PAINEL DE RECEBIMENTOS PUSH
========================================

- Exclusivo da administradora
- Consulta confirmações no Firebase
- Mostra contas e inscrições
- Preserva as notificações existentes
- Não modifica nem exclui registros
========================================
*/

import {
  auth,
  db
} from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  collection,
  getDocs,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const ADMIN_UID = "dkquzbj6D2ZXIH7t9j61Z36er3t2";

const $ = id => document.getElementById(id);

let autorizado = false;
let secaoCriada = false;
let carregando = false;

function criarElemento(tag, texto, classe) {
  const elemento = document.createElement(tag);

  if (texto !== undefined) {
    elemento.textContent = texto;
  }

  if (classe) {
    elemento.className = classe;
  }

  return elemento;
}

function abreviar(valor) {
  const texto = String(valor || "");

  if (!texto) {
    return "Não informado";
  }

  if (texto.length <= 15) {
    return texto;
  }

  return texto.slice(0, 8) +
    "..." +
    texto.slice(-5);
}

function formatarData(valor) {
  try {
    if (valor?.toDate) {
      return valor.toDate().toLocaleString("pt-BR");
    }

    if (valor instanceof Date) {
      return valor.toLocaleString("pt-BR");
    }

    return "Sem data";
  } catch {
    return "Sem data";
  }
}

// ========================================
// CRIAR SEÇÃO DO PAINEL
// ========================================

function montarPainel() {
  if (secaoCriada) {
    return true;
  }

  const corpo = document.querySelector(
    "#cade-admin-painel .cade-admin-corpo"
  );

  if (!corpo) {
    console.warn(
      "O Painel Admin principal ainda não foi encontrado."
    );

    return false;
  }

  const secao = criarElemento(
    "section",
    undefined,
    "cade-admin-bloco"
  );

  secao.id = "cade-recebimentos-secao";

  const titulo = criarElemento(
    "h3",
    "📲 Recebimentos confirmados pelo aplicativo"
  );

  const explicacao = criarElemento(
    "p",
    "Os registros são enviados ao Firebase quando a pessoa abre novamente o Cadê Meu Pet. Eles confirmam o processamento do aviso pelo aplicativo, mas não que a pessoa leu a notificação.",
    "cade-admin-sub"
  );

  secao.append(titulo, explicacao);

  // BOTÃO ATUALIZAR

  const acoes = criarElemento(
    "div",
    undefined,
    "cade-admin-acoes"
  );

  const atualizar = criarElemento(
    "button",
    "🔄 Atualizar recebimentos",
    "cade-admin-acao"
  );

  atualizar.type = "button";
  atualizar.id = "cade-recebimentos-atualizar";

  atualizar.addEventListener(
    "click",
    carregarRecebimentos
  );

  acoes.append(atualizar);
  secao.append(acoes);

  // INDICADORES

  const grade = criarElemento(
    "div",
    undefined,
    "cade-admin-grid"
  );

  const indicadores = [
    {
      titulo: "📲 Recebimentos registrados",
      id: "cade-recebidos-total"
    },
    {
      titulo: "👥 Contas diferentes",
      id: "cade-recebidos-contas"
    },
    {
      titulo: "📱 Inscrições identificadas",
      id: "cade-recebidos-inscricoes"
    },
    {
      titulo: "🐾 Anúncios confirmados",
      id: "cade-recebidos-anuncios"
    }
  ];

  for (const indicador of indicadores) {
    const card = criarElemento(
      "div",
      undefined,
      "cade-admin-card"
    );

    const legenda = criarElemento(
      "small",
      indicador.titulo
    );

    const valor = criarElemento(
      "strong",
      "—"
    );

    valor.id = indicador.id;

    card.append(legenda, valor);
    grade.append(card);
  }

  secao.append(grade);

  // MENSAGENS

  const status = criarElemento(
    "p",
    "Aguardando atualização...",
    "cade-admin-status"
  );

  status.id = "cade-recebidos-status";
  status.setAttribute("role", "status");

  secao.append(status);

  // LISTA DOS RECEBIMENTOS

  const lista = criarElemento(
    "div",
    undefined,
    "cade-admin-lista"
  );

  lista.id = "cade-recebidos-lista";

  secao.append(lista);

  corpo.append(secao);

  secaoCriada = true;

  return true;
}

// ========================================
// MENSAGEM DA LISTA VAZIA
// ========================================

function mostrarListaVazia(texto) {
  const lista = $("cade-recebidos-lista");

  if (!lista) return;

  lista.replaceChildren(
    criarElemento(
      "p",
      texto,
      "cade-admin-vazio"
    )
  );
}

// ========================================
// CONSULTAR FIREBASE
// ========================================

async function carregarRecebimentos() {
  if (!autorizado || carregando) {
    return;
  }

  if (!montarPainel()) {
    return;
  }

  carregando = true;

  const botao = $("cade-recebimentos-atualizar");
  const status = $("cade-recebidos-status");

  if (botao) {
    botao.disabled = true;
  }

  status.textContent =
    "Consultando os recebimentos no Firebase...";

  try {
    const consulta = query(
      collection(db, "pushReceipts"),
      orderBy("sincronizadoEm", "desc"),
      limit(100)
    );

    const resposta = await getDocs(consulta);

    // A conta pode ter sido desconectada
    // enquanto o Firebase respondia.

    if (
      !autorizado ||
      auth.currentUser?.uid !== ADMIN_UID
    ) {
      return;
    }

    const contas = new Set();
    const inscricoes = new Set();
    const anuncios = new Set();

    const lista = $("cade-recebidos-lista");

    lista.replaceChildren();

    for (const documento of resposta.docs) {
      const dados = documento.data();

      if (dados.uid) {
        contas.add(dados.uid);
      }

      if (dados.inscricaoHash) {
        inscricoes.add(dados.inscricaoHash);
      }

      if (dados.animalId) {
        anuncios.add(dados.animalId);
      }

      const linha = criarElemento(
        "div",
        undefined,
        "cade-admin-linha"
      );

      const informacao = criarElemento("div");

      const titulo = criarElemento(
        "strong",
        "🐾 Anúncio " +
        abreviar(dados.animalId)
      );

      const conta = criarElemento(
        "small",
        "Conta: " + abreviar(dados.uid)
      );

      const inscricao = criarElemento(
        "small",
        "Inscrição: " +
        abreviar(dados.inscricaoHash)
      );

      const horario = criarElemento(
        "small",
        "Recebido: " +
        formatarData(dados.recebidoEm) +
        " • Sincronizado: " +
        formatarData(dados.sincronizadoEm)
      );

      informacao.append(
        titulo,
        conta,
        inscricao,
        horario
      );

      const etiqueta = criarElemento(
        "span",
        "RECEBIDO PELO APP",
        "cade-admin-etiqueta"
      );

      linha.append(informacao, etiqueta);

      lista.append(linha);
    }

    // ATUALIZAR NÚMEROS

    $("cade-recebidos-total").textContent =
      resposta.size;

    $("cade-recebidos-contas").textContent =
      contas.size;

    $("cade-recebidos-inscricoes").textContent =
      inscricoes.size;

    $("cade-recebidos-anuncios").textContent =
      anuncios.size;

    if (resposta.empty) {
      mostrarListaVazia(
        "Ainda não há recebimentos sincronizados. Os dados aparecerão depois que um celular com a versão atualizada receber uma nova notificação e abrir novamente o Cadê Meu Pet."
      );
    }

    status.textContent =
      "✅ Relatório atualizado às " +
      new Date().toLocaleTimeString("pt-BR") +
      ". Exibindo até 100 registros recentes.";

  } catch (erro) {
    console.error(
      "Erro ao consultar recebimentos:",
      erro
    );

    if (erro.code === "permission-denied") {
      status.textContent =
        "❌ O Firebase negou acesso à coleção pushReceipts. Confira se as regras de segurança foram publicadas.";
    } else {
      status.textContent =
        "❌ Erro ao consultar recebimentos: " +
        (erro.message || "Erro desconhecido.");
    }

  } finally {
    carregando = false;

    if (botao) {
      botao.disabled = false;
    }
  }
}

// ========================================
// VERIFICAR ADMINISTRADORA
// ========================================

onAuthStateChanged(auth, usuario => {
  autorizado = usuario?.uid === ADMIN_UID;

  if (!autorizado) {
    const secao = $("cade-recebimentos-secao");

    if (secao) {
      secao.hidden = true;
    }

    return;
  }

  // Os scripts do aplicativo são executados
  // após o HTML estar disponível.
  // Criar o painel e carregar os dados.

  if (montarPainel()) {
    $("cade-recebimentos-secao").hidden = false;
    carregarRecebimentos();
  }
});

console.log(
  "Cadê Meu Pet: painel de recebimentos carregado."
);
