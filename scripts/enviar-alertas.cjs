
"use strict";

/*
==========================================
CADÊ MEU PET
NOTIFICAÇÕES AUTOMÁTICAS - VERSÃO 4
==========================================

- Notifica todos os inscritos, incluindo
  o próprio anunciante.
- Respeita o município selecionado.
- Registra envios aceitos e recusados.
- Não repete envios já aceitos.
- Remove inscrições expiradas (404/410).
- Suspende inscrições após 2 erros
  consecutivos de autorização (401/403).
- Permite reativação pelo aplicativo.
- Preserva o histórico administrativo.
- Mantém a integração GitHub/Cloudflare.
==========================================
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

const SITE =
  "https://localizador-pet2.netlify.app";

const LIMITE_ANIMAIS = 100;
const LIMITE_INSCRITOS = 2000;

const LIMITE_ERROS_AUTORIZACAO = 2;

// SEGREDOS DO GITHUB

function obrigatorio(nome) {
  const valor = process.env[nome];

  if (!valor) {
    throw new Error(
      `Segredo ${nome} não configurado no GitHub.`
    );
  }

  return valor;
}

// CONEXÃO COM FIREBASE

const credenciais = JSON.parse(
  obrigatorio("FIREBASE_SERVICE_ACCOUNT")
);

if (credenciais.project_id !== PROJETO) {
  throw new Error(
    "As credenciais pertencem a outro projeto Firebase."
  );
}

initializeApp({
  credential: cert(credenciais)
});

const db = getFirestore();

// WEB PUSH

const VAPID_PUBLIC_KEY =
  obrigatorio("VAPID_PUBLIC_KEY");

const VAPID_PRIVATE_KEY =
  obrigatorio("VAPID_PRIVATE_KEY");

const VAPID_CONTACT =
  obrigatorio("VAPID_CONTACT");

webpush.setVapidDetails(
  VAPID_CONTACT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// NORMALIZAÇÃO

function normalizar(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

// TIPO DE ANIMAL

function tipoAnimal(tipo) {
  const valor = normalizar(tipo);

  if (
    valor === "cachorro" ||
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

// PREPARAR NOTIFICAÇÃO

function montarMensagem(animal, id) {
  const tipo = tipoAnimal(animal.tipo);

  let titulo = "";

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

// FILTRO DE MUNICÍPIO

function recebeMunicipio(inscricao, animal) {
  const escolhido = normalizar(
    inscricao.municipio
  );

  const municipio = normalizar(
    animal.municipio
  );

  return (
    escolhido === "todos" ||
    escolhido === "todos os municipios" ||
    escolhido === municipio
  );
}

// REFERÊNCIA DO ENVIO INDIVIDUAL

function referenciaEntrega(animalId, inscricaoId) {
  return db
    .collection("pushDispatches")
    .doc(animalId)
    .collection("recipients")
    .doc(inscricaoId);
}

// SAÚDE DA INSCRIÇÃO

function referenciaSaude(inscricaoId) {
  return db
    .collection("pushSubscriptionHealth")
    .doc(inscricaoId);
}

// IDENTIFICAR NOVA ATIVAÇÃO

function ativacaoMaisRecente(
  inscricao,
  saude
) {
  const atualizacao =
    inscricao.updatedAt?.toMillis?.() || 0;

  const ultimaFalha =
    saude.ultimaFalhaEm?.toMillis?.() || 0;

  return atualizacao > ultimaFalha;
}

// LIMPAR CONTADOR APÓS ENVIO ACEITO

async function registrarSucesso(inscricaoId) {
  await referenciaSaude(inscricaoId).set(
    {
      errosConsecutivos: 0,
      ultimoStatus: "aceito",
      ultimoCodigo: null,
      ultimoSucessoEm:
        FieldValue.serverTimestamp()
    },
    {
      merge: true
    }
  );
}

// REGISTRAR ERRO DE AUTORIZAÇÃO

async function registrarErroAutorizacao(
  documento,
  codigo
) {
  const referencia =
    referenciaSaude(documento.id);

  const anterior = await referencia.get();

  const saude = anterior.exists
    ? anterior.data()
    : {};

  const inscricao = documento.data();

  // Se houve nova ativação no aplicativo,
  // reiniciar o contador.

  const reiniciar =
    ativacaoMaisRecente(inscricao, saude);

  const errosAnteriores = reiniciar
    ? 0
    : Number(
        saude.errosConsecutivos || 0
      );

  const errosConsecutivos =
    errosAnteriores + 1;

  const suspender =
    errosConsecutivos >=
    LIMITE_ERROS_AUTORIZACAO;

  await referencia.set(
    {
      uid: inscricao.uid || null,

      errosConsecutivos,

      ultimoCodigo: codigo,

      ultimoStatus: suspender
        ? "suspenso"
        : "recusado",

      ultimaFalhaEm:
        FieldValue.serverTimestamp(),

      precisaRenovar: suspender
    },
    {
      merge: true
    }
  );

  if (suspender) {
    // Não excluir a inscrição nem afetar
    // outros aparelhos da mesma conta.

    // Atualização condicional: não suspender
    // se a inscrição foi reativada durante
    // o processamento.

    try {
      const atual = await documento.ref.get();

      const dadosAtuais = atual.data();

      const versaoOriginal =
        inscricao.updatedAt?.toMillis?.() || 0;

      const versaoAtual =
        dadosAtuais?.updatedAt?.toMillis?.() || 0;

      if (
        dadosAtuais?.enabled === true &&
        versaoOriginal === versaoAtual
      ) {
        await documento.ref.update({
          enabled: false
        });

        console.warn(
          `Inscrição ${documento.id}: ` +
          `suspensa após ${errosConsecutivos} ` +
          `erros de autenticação.`
        );

      } else {
        console.log(
          `Inscrição ${documento.id}: ` +
          "alterada recentemente; suspensão ignorada."
        );
      }

    } catch (erro) {
      console.error(
        `Erro ao suspender inscrição ${documento.id}:`,
        erro.message
      );

      throw erro;
    }
  }

  return {
    errosConsecutivos,
    suspenso: suspender
  };
}

// REMOVER INSCRIÇÃO EXPIRADA

async function removerExpirada(
  documento,
  codigo
) {
  try {
    await referenciaSaude(documento.id).set(
      {
        uid: documento.data().uid || null,
        ultimoCodigo: codigo,
        ultimoStatus: "expirado",
        precisaRenovar: true,
        ultimaFalhaEm:
          FieldValue.serverTimestamp()
      },
      {
        merge: true
      }
    );

    await documento.ref.delete();

    console.log(
      `Inscrição ${documento.id}: ` +
      `removida após HTTP ${codigo}.`
    );

  } catch (erro) {
    console.error(
      `Não foi possível remover ${documento.id}:`,
      erro.message
    );

    throw erro;
  }
}

// REGISTRAR RESULTADO DO ENVIO

async function registrarEntrega(
  referencia,
  dados
) {
  await referencia.set(
    {
      ...dados,
      registradoEm:
        FieldValue.serverTimestamp()
    },
    {
      merge: true
    }
  );
}

// ESTATÍSTICAS VAZIAS

function estatisticasVazias() {
  return {
    tentados: 0,
    enviados: 0,
    expirados: 0,
    recusados: 0,
    temporarios: 0,
    suspensos: 0,
    repetidos: 0
  };
}

// ENVIAR ALERTAS DE UM ANIMAL

async function enviarNotificacao(animal, id) {
  const mensagem = montarMensagem(animal, id);

  const stats = estatisticasVazias();

  if (!mensagem) {
    return stats;
  }

  const resultado = await db
    .collection("pushSubscriptions")
    .where("enabled", "==", true)
    .limit(LIMITE_INSCRITOS)
    .get();

  for (const documento of resultado.docs) {
    const inscricao = documento.data();

    // Todos podem receber, incluindo
    // o responsável pelo anúncio.

    if (!recebeMunicipio(inscricao, animal)) {
      continue;
    }

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

    const anterior = await entrega.get();

    // Não duplicar envios aceitos.

    if (
      anterior.exists &&
      anterior.data().status === "aceito"
    ) {
      stats.repetidos++;
      continue;
    }

    stats.tentados++;

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

      stats.enviados++;

      await registrarEntrega(
        entrega,
        {
          status: "aceito",
          inscricaoId: documento.id,
          uid: inscricao.uid || null,
          aceitoEm:
            FieldValue.serverTimestamp()
        }
      );

      // O aviso foi aceito.
      // Zerar erros anteriores.

      try {
        await registrarSucesso(
          documento.id
        );
      } catch (erroSaude) {
        console.warn(
          "Não foi possível atualizar o histórico " +
          `da inscrição ${documento.id}: ` +
          erroSaude.message
        );
      }

      console.log(
        `Inscrição ${documento.id}: ` +
        "envio aceito."
      );

    } catch (erro) {
      const codigo = Number(
        erro.statusCode || 0
      );

      // 404 / 410: inscrição expirada.

      if (
        codigo === 404 ||
        codigo === 410
      ) {
        stats.expirados++;

        await registrarEntrega(
          entrega,
          {
            status: "expirado",
            codigo,
            inscricaoId: documento.id,
            uid: inscricao.uid || null
          }
        );

        await removerExpirada(
          documento,
          codigo
        );

        continue;
      }

      // 401 / 403: autorização recusada.

      if (
        codigo === 401 ||
        codigo === 403
      ) {
        stats.recusados++;

        const estado =
          await registrarErroAutorizacao(
            documento,
            codigo
          );

        if (estado.suspenso) {
          stats.suspensos++;
        }

        await registrarEntrega(
          entrega,
          {
            status: "recusado",
            codigo,
            inscricaoId: documento.id,
            uid: inscricao.uid || null,
            errosConsecutivos:
              estado.errosConsecutivos,
            inscricaoSuspensa:
              estado.suspenso
          }
        );

        console.warn(
          `Inscrição ${documento.id}: ` +
          `HTTP ${codigo}, ` +
          `${estado.errosConsecutivos} ` +
          "erro(s) consecutivo(s)."
        );

        continue;
      }

      // Outros erros: manter a inscrição
      // para uma tentativa posterior.

      stats.temporarios++;

      await registrarEntrega(
        entrega,
        {
          status: "temporario",
          codigo: codigo || null,
          inscricaoId: documento.id,
          uid: inscricao.uid || null
        }
      );

      console.error(
        `Inscrição ${documento.id}: ` +
        `erro temporário ${codigo || "desconhecido"}.`
      );
    }
  }

  console.log(
    `Animal ${id}: ` +
    `${stats.tentados} tentativas, ` +
    `${stats.enviados} aceitos, ` +
    `${stats.recusados} recusados, ` +
    `${stats.suspensos} suspensos, ` +
    `${stats.expirados} expirados, ` +
    `${stats.temporarios} temporários, ` +
    `${stats.repetidos} já aceitos.`
  );

  return stats;
}

// PROCESSAR ANÚNCIO

async function processarAnimal(documento) {
  const animal = documento.data();

  const controle = db
    .collection("pushDispatches")
    .doc(documento.id);

  const anterior = await controle.get();

  if (
    anterior.exists &&
    anterior.data().processadoEm
  ) {
    return;
  }

  if (
    !animal ||
    ![
      "Perdido",
      "Encontrado",
      "Reencontrado"
    ].includes(animal.status)
  ) {
    return;
  }

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

  // Manter o comportamento de não finalizar
  // o anúncio se ocorrer erro temporário.

  if (resultado.temporarios > 0) {
    console.warn(
      `Anúncio ${documento.id}: ` +
      "existem envios temporários pendentes."
    );

    throw new Error(
      "Existem envios temporariamente pendentes."
    );
  }

  await controle.set(
    {
      animalId: documento.id,

      municipio: animal.municipio,

      situacao: animal.status,

      tentativas: resultado.tentados,

      enviosAceitos: resultado.enviados,

      inscricoesExpiradas:
        resultado.expirados,

      inscricoesRecusadas:
        resultado.recusados,

      inscricoesSuspensas:
        resultado.suspensos,

      processadoEm:
        FieldValue.serverTimestamp()
    },
    {
      merge: true
    }
  );

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

  if (!estado.exists) {
    await controle.create(
      {
        iniciadoEm:
          FieldValue.serverTimestamp(),

        ultimaVerificacao:
          Timestamp.now(),

        versao: 4
      }
    );

    console.log(
      "Monitoramento inicializado. " +
      "Próximos cadastros serão verificados."
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
    await controle.update(
      {
        ultimaVerificacao: inicio,

        ultimaExecucaoEm:
          FieldValue.serverTimestamp(),

        versao: 4
      }
    );

    console.log(
      "Nenhum novo animal."
    );

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

  await controle.update(
    {
      ultimaVerificacao: proximoMarco,

      ultimaExecucaoEm:
        FieldValue.serverTimestamp(),

      versao: 4
    }
  );

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
