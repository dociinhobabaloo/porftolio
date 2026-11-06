
"use strict";

/*
=============================================
CADÊ MEU PET
NOTIFICAÇÕES GRATUITAS - GITHUB ACTIONS
=============================================

Projeto Firebase: cade-meu-pet-8966f

Funcionalidades:
- Consulta novos animais no Firestore.
- Envia notificações Web Push.
- Identifica cachorros, gatos e outros.
- Respeita o município escolhido.
- Evita notificações repetidas.
- Não notifica o próprio anunciante.
- Não reenvia anúncios antigos na ativação.

Necessita de segredos configurados no GitHub.
NUNCA coloque chaves privadas aqui.
=============================================
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

const PROJETO = "cade-meu-pet-8966f";

const LIMITE_ANIMAIS = 100;

const LIMITE_INSCRITOS = 2000;

const SITE =
  "https://localizador-pet2.netlify.app";

function obrigatorio(nome) {
  const valor = process.env[nome];

  if (!valor) {
    throw new Error(
      `Configure o segredo ${nome} no GitHub.`
    );
  }

  return valor;
}

// ===========================================
// CONFIGURAÇÃO SEGURA
// ===========================================

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

webpush.setVapidDetails(
  obrigatorio("VAPID_CONTACT"),
  obrigatorio("VAPID_PUBLIC_KEY"),
  obrigatorio("VAPID_PRIVATE_KEY")
);

// ===========================================
// NOMES DAS NOTIFICAÇÕES
// ===========================================

function tipoAnimal(tipo) {
  if (tipo === "Cachorro") {
    return {
      nome: "cachorro",
      emoji: "🐶"
    };
  }

  if (tipo === "Gato") {
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

function montarMensagem(animal, id) {
  const tipo = tipoAnimal(animal.tipo);

  let titulo;

  switch (animal.status) {
    case "Perdido":
      titulo = `${tipo.emoji} Novo ${tipo.nome} perdido!`;
      break;

    case "Encontrado":
      titulo = `${tipo.emoji} Novo ${tipo.nome} encontrado!`;
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

  const secao = animal.status === "Reencontrado"
    ? "finais-felizes"
    : "animais";

  return {
    title: titulo,

    body: `${nome} — ${bairro}, ${municipio}. Toque para ver o anúncio.`,

    url: `${SITE}/#${secao}`,

    icon: `${SITE}/icons/icon-192.png`,

    badge: `${SITE}/icons/icon-192.png`,

    tag: `cade-pet-${id}`,

    animalId: id
  };
}

// ===========================================
// ENVIAR PARA OS DISPOSITIVOS
// ===========================================

async function enviarNotificacao(animal, id) {
  const mensagem = montarMensagem(animal, id);

  if (!mensagem) {
    return;
  }

  const resultado = await db
    .collection("pushSubscriptions")
    .where("enabled", "==", true)
    .limit(LIMITE_INSCRITOS)
    .get();

  let enviados = 0;
  let expirados = 0;
  let tentados = 0;

  for (const documento of resultado.docs) {
    const inscricao = documento.data();

    const municipioCorreto =
      inscricao.municipio === "Todos" ||
      inscricao.municipio === animal.municipio;

    const outroUsuario =
      inscricao.uid !== animal.ownerId;

    if (!municipioCorreto || !outroUsuario) {
      continue;
    }

    if (
      !inscricao.endpoint ||
      !inscricao.keys?.p256dh ||
      !inscricao.keys?.auth
    ) {
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

      enviados++;

    } catch (erro) {
      if (
        erro.statusCode === 404 ||
        erro.statusCode === 410
      ) {
        // Dispositivo não está mais inscrito.
        await documento.ref.delete();
        expirados++;
      } else {
        // Não marcar o anúncio como concluído.
        // O GitHub tentará novamente.
        throw new Error(
          `Erro Web Push: ${erro.statusCode || erro.message}`
        );
      }
    }
  }

  console.log(
    `Animal ${id}: ${tentados} tentativas, ` +
    `${enviados} envios aceitos, ` +
    `${expirados} inscrições expiradas.`
  );
}

// ===========================================
// MARCAR ANÚNCIOS JÁ PROCESSADOS
// ===========================================

async function processarAnimal(documento) {
  const animal = documento.data();

  const controle = db
    .collection("pushDispatches")
    .doc(documento.id);

  const enviado = await controle.get();

  if (enviado.exists) {
    return;
  }

  if (
    !animal ||
    !["Perdido", "Encontrado", "Reencontrado"]
      .includes(animal.status)
  ) {
    return;
  }

  if (
    !["Vila Velha", "Vitória", "Serra", "Cariacica"]
      .includes(animal.municipio)
  ) {
    return;
  }

  await enviarNotificacao(
    animal,
    documento.id
  );

  await controle.set({
    animalId: documento.id,
    municipio: animal.municipio,
    situacao: animal.status,
    processadoEm: FieldValue.serverTimestamp()
  });

  console.log(
    `Anúncio ${documento.id} processado.`
  );
}

// ===========================================
// EXECUÇÃO PRINCIPAL
// ===========================================

async function executar() {
  const controle = db
    .collection("pushSystem")
    .doc("githubActions");

  const estado = await controle.get();

  // Primeira execução: inicia o monitoramento
  // sem enviar alertas de animais antigos.

  if (!estado.exists) {
    await controle.create({
      iniciadoEm: FieldValue.serverTimestamp(),
      ultimaVerificacao: Timestamp.now(),
      versao: 1
    });

    console.log(
      "Sistema inicializado. " +
      "Os próximos animais serão monitorados."
    );

    return;
  }

  const ultima =
    estado.data().ultimaVerificacao;

  if (!ultima || typeof ultima.toMillis !== "function") {
    throw new Error(
      "Data da última verificação inválida."
    );
  }

  // Marca o início da verificação.
  // Isso evita pular animais cadastrados
  // durante a execução do script.

  const inicio = Timestamp.now();

  const novos = await db
    .collection("pets")
    .where("criadoEm", ">", ultima)
    .orderBy("criadoEm", "asc")
    .limit(LIMITE_ANIMAIS)
    .get();

  if (novos.empty) {
    await controle.update({
      ultimaVerificacao: inicio
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

  // Se o lote atingiu o limite, avança
  // somente até o último documento lido.
  // Caso contrário, avança até o início
  // da verificação.

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
    ultimaExecucaoEm: FieldValue.serverTimestamp()
  });

  console.log(
    "Verificação concluída com sucesso!"
  );
}

executar().catch(erro => {
  console.error(
    "Falha ao executar alertas:",
    erro.message
  );

  process.exitCode = 1;
});
