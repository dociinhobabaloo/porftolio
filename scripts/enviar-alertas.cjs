
"use strict";

/*
================================================
CADÊ MEU PET
NOTIFICAÇÕES AUTOMÁTICAS — GITHUB ACTIONS
================================================

Firebase: cade-meu-pet-8966f

- Cachorros e gatos perdidos ou encontrados
- Notificações para vários celulares
- Filtro por município
- Opção Todos os municípios
- Não notifica o anunciante
- Trata erros por dispositivo
- Evita reenviar para inscrições já atendidas
- Não interrompe todos os envios por erro 403

O Cloudflare inicia este script pelo GitHub Actions.

NUNCA coloque chaves privadas neste arquivo.
================================================
*/

const {
  initializeApp,
  cert
} = require("firebase-admin/app");

const {
  getFirestore,
  Timestamp,
  FieldValue
} = require("firebase-admin/firestore");

const webpush = require("web-push");

// CONFIGURAÇÕES

const PROJETO = "cade-meu-pet-8966f";

const SITE = "https://localizador-pet2.netlify.app";

const LIMITE_ANIMAIS = 100;
const LIMITE_INSCRITOS = 2000;

// SEGREDOS DO GITHUB

function obrigatorio(nome) {
  const valor = process.env[nome];

  if (!valor) {
    throw new Error(
      `Configure o segredo ${nome} no GitHub.`
    );
  }

  return valor;
}

// FIREBASE ADMIN

const credenciais = JSON.parse(
  obrigatorio("FIREBASE_SERVICE_ACCOUNT")
);

if (credenciais.project_id !== PROJETO) {
  throw new Error(
    "A credencial não corresponde ao Cadê Meu Pet."
  );
}

initializeApp({
  credential: cert(credenciais)
});

const db = getFirestore();

// WEB PUSH

webpush.setVapidDetails(
  obrigatorio("VAPID_CONTACT"),
  obrigatorio("VAPID_PUBLIC_KEY"),
  obrigatorio("VAPID_PRIVATE_KEY")
);

// IDENTIFICAR ANIMAL

function tipoAnimal(tipo) {
  const valor = String(tipo || "")
    .trim()
    .toLowerCase();

  if (
    valor === "cachorro" ||
    valor === "cão" ||
    valor === "cao"
  ) {
    return {
      nome: "cachorro",
      emoji: "🐶"
    };
  }

  if (
    valor === "gato" ||
    valor === "gata"
  ) {
    return {
      nome: "gato",
      emoji: "🐱"
    };
  }

  return {
    nome: "animal",
    emoji: "🐾"
  };
}

// MONTAR NOTIFICAÇÃO

function montarMensagem(animal, id) {
  const tipo = tipoAnimal(animal.tipo);

  let titulo;

  switch (animal.status) {
    case "Perdido":
      titulo =
        `${tipo.emoji} Novo ${tipo.nome} perdido!`;
      break;

    case "Encontrado":
      titulo =
        `${tipo.emoji} Novo ${tipo.nome} encontrado!`;
      break;

    case "Reencontrado":
      titulo = "💚 Animal reencontrado!";
      break;

    default:
      return null;
  }

  const nome = String(
    animal.nome || "Animal"
  ).slice(0, 60);

  const bairro = String(
    animal.bairro || "Bairro não informado"
  ).slice(0, 80);

  const municipio = String(
    animal.municipio || ""
  ).slice(0, 60);

  const secao =
    animal.status === "Reencontrado"
      ? "finais-felizes"
      : "animais";

  return {
    title: titulo,

    body:
      `${nome} — ${bairro}, ${municipio}. ` +
      "Toque para ver o anúncio.",

    url: `${SITE}/#${secao}`,

    icon: `${SITE}/icons/icon-192.png`,

    badge: `${SITE}/icons/icon-192.png`,

    tag: `cade-pet-${id}`,

    animalId: id
  };
}

// NORMALIZAR MUNICÍPIOS

function normalizar(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function recebeMunicipio(inscricao, animal) {
  const escolhido = normalizar(
    inscricao.municipio
  );

  const cidadeAnimal = normalizar(
    animal.municipio
  );

  return (
    escolhido === "todos" ||
    escolhido === "todos os municipios" ||
    escolhido === cidadeAnimal
  );
}

// REGISTRO INDIVIDUAL DE ENTREGA
// Guarda uma confirmação por anúncio/dispositivo.

function referenciaEntrega(animalId, inscricaoId) {
  return db
    .collection("pushDispatches")
    .doc(animalId)
    .collection("recipients")
    .doc(inscricaoId);
}

// ENVIAR PARA TODOS OS DISPOSITIVOS

async function enviarNotificacao(animal, id) {
  const mensagem = montarMensagem(animal, id);

  if (!mensagem) {
    return {
      tentados: 0,
      enviados: 0,
      expirados: 0,
      recusados: 0,
      temporarios: 0
    };
  }

  const resultado = await db
    .collection("pushSubscriptions")
    .where("enabled", "==", true)
    .limit(LIMITE_INSCRITOS)
    .get();

  let tentados = 0;
  let enviados = 0;
  let expirados = 0;
  let recusados = 0;
  let temporarios = 0;
  let repetidos = 0;

  for (const documento of resultado.docs) {
    const inscricao = documento.data();

    // Respeitar o município selecionado.
    if (!recebeMunicipio(inscricao, animal)) {
      continue;
    }

    // Não avisar o próprio anunciante.
    if (
      inscricao.uid &&
      animal.ownerId &&
      inscricao.uid === animal.ownerId
    ) {
      continue;
    }

    // Ignorar inscrições incompletas.
    if (
      !inscricao.endpoint ||
      !inscricao.keys?.p256dh ||
      !inscricao.keys?.auth
    ) {
      console.warn(
        `Inscrição ${documento.id} incompleta.`
      );

      continue;
    }

    const entrega = referenciaEntrega(
      id,
      documento.id
    );

    // Não repetir aviso já aceito pelo Push.
    const anterior = await entrega.get();

    if (
      anterior.exists &&
      anterior.data().status === "aceito"
    ) {
      repetidos++;
      continue;
    }

    tentados++;

    try {
      await webpush.sendNotification(
        {
          endpoint: inscricao.endpoint,

          keys: {
            p256dh: inscricao.keys.p256dh,
            auth: inscricao.keys.auth
          }
        },

        JSON.stringify(mensagem),

        {
          TTL: 3600,
          urgency: "normal"
        }
      );

      // O servidor Push aceitou o envio.
      // Isso não garante exibição pelo celular.

      enviados++;

      await entrega.set({
        status: "aceito",
        inscricaoId: documento.id,
        uid: inscricao.uid || null,
        aceitoEm: FieldValue.serverTimestamp()
      });

      console.log(
        `Inscrição ${documento.id}: envio aceito.`
      );

    } catch (erro) {
      const codigo = Number(
        erro.statusCode || 0
      );

      // Inscrição removida ou expirada.
      if (codigo === 404 || codigo === 410) {
        expirados++;

        console.warn(
          `Inscrição ${documento.id}: ` +
          `expirada (HTTP ${codigo}).`
        );

        try {
          await documento.ref.delete();
        } catch (erroExclusao) {
          console.warn(
            `Não foi possível limpar ${documento.id}.`
          );
        }

        continue;
      }

      // Inscrição recusada, frequentemente por
      // incompatibilidade de VAPID/permissão.
      // Não bloquear os outros dispositivos.
      if (codigo === 403 || codigo === 401) {
        recusados++;

        console.warn(
          `Inscrição ${documento.id}: ` +
          `Web Push recusado (HTTP ${codigo}). ` +
          "Verifique a chave VAPID e a inscrição."
        );

        // Registramos a falha, mas não apagamos
        // o dispositivo automaticamente.
        await entrega.set({
          status: "recusado",
          codigo,
          inscricaoId: documento.id,
          registradoEm:
            FieldValue.serverTimestamp()
        });

        continue;
      }

      // Erros temporários podem ser tentados
      // novamente na próxima execução.
      temporarios++;

      console.error(
        `Inscrição ${documento.id}: ` +
        `erro temporário ${codigo || "desconhecido"}.`
      );
    }
  }

  console.log(
    `Animal ${id}: ` +
    `${tentados} tentativas, ` +
    `${enviados} envios aceitos, ` +
    `${expirados} expiradas, ` +
    `${recusados} recusadas, ` +
    `${temporarios} erros temporários, ` +
    `${repetidos} já atendidos.`
  );

  return {
    tentados,
    enviados,
    expirados,
    recusados,
    temporarios
  };
}

// PROCESSAR CADA ANÚNCIO

async function processarAnimal(documento) {
  const animal = documento.data();

  const controle = db
    .collection("pushDispatches")
    .doc(documento.id);

  const anterior = await controle.get();

  if (anterior.exists) {
    const dados = anterior.data();

    if (dados.processadoEm) {
      return;
    }
  }

  if (
    !animal ||
    !["Perdido", "Encontrado", "Reencontrado"]
      .includes(animal.status)
  ) {
    return;
  }

  // Aceitar municípios cadastrados no ES.
  // Não limitar apenas às quatro cidades
  // usadas no primeiro protótipo.
  if (
    !animal.municipio ||
    !String(animal.municipio).trim()
  ) {
    console.warn(
      `Anúncio ${documento.id} sem município.`
    );
    return;
  }

  const resultado = await enviarNotificacao(
    animal,
    documento.id
  );

  // Se houver erro temporário, não concluir
  // o anúncio. Na próxima execução, o
  // sistema tenta somente os destinatários
  // que ainda não tiveram envio aceito.

  if (resultado.temporarios > 0) {
    console.warn(
      `Anúncio ${documento.id} pendente: ` +
      `${resultado.temporarios} falha(s) temporária(s).`
    );

    throw new Error(
      "Há envios temporariamente pendentes."
    );
  }

  await controle.set({
    animalId: documento.id,
    municipio: animal.municipio,
    situacao: animal.status,
    tentativas: resultado.tentados,
    enviosAceitos: resultado.enviados,
    inscricoesExpiradas: resultado.expirados,
    inscricoesRecusadas: resultado.recusados,
    processadoEm: FieldValue.serverTimestamp()
  }, {
    merge: true
  });

  console.log(
    `Anúncio ${documento.id} processado.`
  );
}

// EXECUÇÃO PRINCIPAL

async function executar() {
  const controle = db
    .collection("pushSystem")
    .doc("githubActions");

  const estado = await controle.get();

  // Primeira execução inicializa o sistema
  // sem avisar sobre anúncios antigos.
  if (!estado.exists) {
    await controle.create({
      iniciadoEm: FieldValue.serverTimestamp(),
      ultimaVerificacao: Timestamp.now(),
      versao: 2
    });

    console.log(
      "Sistema inicializado. " +
      "Os próximos animais serão monitorados."
    );

    return;
  }

  const ultima =
    estado.data().ultimaVerificacao;

  if (
    !ultima ||
    typeof ultima.toMillis !== "function"
  ) {
    throw new Error(
      "Data da última verificação inválida."
    );
  }

  const inicio = Timestamp.now();

  const novos = await db
    .collection("pets")
    .where("criadoEm", ">", ultima)
    .orderBy("criadoEm", "asc")
    .limit(LIMITE_ANIMAIS)
    .get();

  if (novos.empty) {
    await controle.update({
      ultimaVerificacao: inicio,
      ultimaExecucaoEm:
        FieldValue.serverTimestamp()
    });

    console.log("Nenhum novo animal.");
    return;
  }

  console.log(
    `${novos.size} novo(s) anúncio(s) encontrado(s).`
  );

  for (const documento of novos.docs) {
    await processarAnimal(documento);
  }

  const ultimoDocumento =
    novos.docs[novos.docs.length - 1];

  const ultimoCriadoEm =
    ultimoDocumento.data().criadoEm;

  const proximoMarco =
    novos.size === LIMITE_ANIMAIS
      ? ultimoCriadoEm
      : Timestamp.fromMillis(
          Math.max(
            inicio.toMillis(),
            ultimoCriadoEm.toMillis()
          )
        );

  await controle.update({
    ultimaVerificacao: proximoMarco,
    ultimaExecucaoEm:
      FieldValue.serverTimestamp()
  });

  console.log(
    "Verificação concluída com sucesso!"
  );
}

// INICIAR

executar().catch(erro => {
  console.error(
    "Falha ao executar alertas:",
    erro.message
  );

  process.exitCode = 1;
});
