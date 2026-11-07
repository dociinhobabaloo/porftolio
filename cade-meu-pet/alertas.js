
/*
========================================
CADÊ MEU PET
SISTEMA DE ALERTAS WEB PUSH
========================================

Funções:
- Ativar notificações
- Desativar notificações
- Escolher município
- Conferir a chave pública VAPID
- Renovar inscrições incompatíveis
- Atualizar a inscrição no Firebase
- Limpar registro antigo do próprio aparelho

Não altera:
- GitHub Actions
- Cloudflare
- Service Worker
- Outros aparelhos
========================================
*/

import {
  auth,
  db
} from "./firebase-config.js";

import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

import {
  VAPID_PUBLIC_KEY
} from "./alertas-config.js";

const $ = id => document.getElementById(id);

const MUNICIPIOS = [
  "Todos",
  "Vila Velha",
  "Vitória",
  "Serra",
  "Cariacica"
];

const STORAGE_DOC = "cade_push_doc";
const STORAGE_MUNICIPIO = "cade_push_municipio";

let subscription = null;
let currentDocId = null;
let ocupada = false;

// ========================================
// MENSAGENS PARA O USUÁRIO
// ========================================

function feedback(texto) {
  const campo = $("alertas-info");

  if (campo) {
    campo.textContent = texto;
  }
}

// ========================================
// CONVERTER CHAVE VAPID
// ========================================

function base64ToUint8Array(base64) {
  const texto = String(base64 || "").trim();

  const padding =
    "=".repeat((4 - texto.length % 4) % 4);

  const valor = atob(
    (texto + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/")
  );

  return Uint8Array.from(
    valor,
    caractere => caractere.charCodeAt(0)
  );
}

// ========================================
// COMPARAR CHAVES VAPID
// ========================================

function chavesIguais(chaveAtual, chaveNova) {
  if (!chaveAtual) {
    return false;
  }

  const atual = new Uint8Array(chaveAtual);
  const nova = new Uint8Array(chaveNova);

  if (atual.length !== nova.length) {
    return false;
  }

  for (let i = 0; i < atual.length; i++) {
    if (atual[i] !== nova[i]) {
      return false;
    }
  }

  return true;
}

// ========================================
// IDENTIFICADOR DA INSCRIÇÃO
// ========================================

async function hashEndpoint(endpoint) {
  const dados = new TextEncoder()
    .encode(endpoint);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    dados
  );

  return Array.from(
    new Uint8Array(hash)
  )
    .map(
      byte => byte
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}

// ========================================
// SERVICE WORKER
// ========================================

async function obterRegistro() {
  if (!("serviceWorker" in navigator)) {
    throw new Error(
      "Este dispositivo não suporta Service Worker."
    );
  }

  return navigator.serviceWorker.ready;
}

// ========================================
// VERIFICAR COMPATIBILIDADE
// ========================================

function validarCompatibilidade() {
  if (!window.isSecureContext) {
    throw new Error(
      "Abra o Cadê Meu Pet pelo endereço HTTPS."
    );
  }

  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    throw new Error(
      "Este navegador ou aplicativo não oferece notificações push compatíveis."
    );
  }

  if (
    !VAPID_PUBLIC_KEY ||
    typeof VAPID_PUBLIC_KEY !== "string"
  ) {
    throw new Error(
      "A chave VAPID não está configurada em alertas-config.js."
    );
  }
}

// ========================================
// VALIDAR CONTA
// ========================================

function obterUsuario() {
  const usuario = auth.currentUser;

  if (!usuario) {
    throw new Error(
      "Entre com Google ou e-mail antes de ativar os alertas."
    );
  }

  return usuario;
}

// ========================================
// SALVAR INSCRIÇÃO NO FIREBASE
// ========================================

async function salvarSubscription(
  sub,
  municipio,
  usuario
) {
  if (!usuario || auth.currentUser?.uid !== usuario.uid) {
    throw new Error(
      "Sua conta mudou durante a operação. Entre novamente."
    );
  }

  const dados = sub.toJSON();

  if (
    !dados?.endpoint ||
    !dados.keys?.p256dh ||
    !dados.keys?.auth
  ) {
    throw new Error(
      "O navegador retornou uma inscrição inválida."
    );
  }

  const id =
    `${usuario.uid}_${await hashEndpoint(dados.endpoint)}`;

  await setDoc(
    doc(db, "pushSubscriptions", id),
    {
      uid: usuario.uid,
      municipio: municipio,
      endpoint: dados.endpoint,

      keys: {
        p256dh: dados.keys.p256dh,
        auth: dados.keys.auth
      },

      enabled: true,
      updatedAt: serverTimestamp()
    }
  );

  return id;
}

// ========================================
// REMOVER REGISTRO ANTIGO
// ========================================

async function limparRegistroAntigo(
  idAntigo,
  idNovo,
  usuario
) {
  if (!idAntigo) {
    return;
  }

  if (idAntigo === idNovo) {
    return;
  }

  if (!idAntigo.startsWith(usuario.uid + "_")) {
    return;
  }

  try {
    await deleteDoc(
      doc(db, "pushSubscriptions", idAntigo)
    );

    console.log(
      "Inscrição antiga deste dispositivo removida."
    );

  } catch (erro) {
    // O novo registro já está salvo.
    // Uma falha na limpeza não deve
    // desativar a nova inscrição.

    console.warn(
      "Não foi possível limpar o registro anterior:",
      erro
    );
  }
}

// ========================================
// CRIAR INSCRIÇÃO
// ========================================

async function criarSubscription(
  registro,
  chave
) {
  return registro.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: chave
  });
}

// ========================================
// ATIVAR ALERTAS
// ========================================

async function ativar() {
  if (ocupada) {
    return;
  }

  ocupada = true;

  const botao = $("alertas-ativar");

  if (botao) {
    botao.disabled = true;
  }

  try {
    const usuario = obterUsuario();

    const municipio =
      $("alertas-cidade")?.value || "Todos";

    if (!MUNICIPIOS.includes(municipio)) {
      throw new Error(
        "Selecione um município válido."
      );
    }

    validarCompatibilidade();

    if (Notification.permission === "denied") {
      throw new Error(
        "As notificações estão bloqueadas. Libere a permissão nas configurações do celular."
      );
    }

    const permissao =
      await Notification.requestPermission();

    if (permissao !== "granted") {
      throw new Error(
        "Permissão não concedida. Nenhum alerta foi ativado."
      );
    }

    feedback(
      "🔔 Verificando sua inscrição de notificações..."
    );

    const registro = await obterRegistro();

    const chaveAtual =
      base64ToUint8Array(VAPID_PUBLIC_KEY);

    const idAntigo =
      localStorage.getItem(STORAGE_DOC);

    let sub =
      await registro.pushManager.getSubscription();

    let renovada = false;

    // ====================================
    // VERIFICAR CHAVE DA INSCRIÇÃO EXISTENTE
    // ====================================

    if (sub) {
      const chaveAnterior =
        sub.options?.applicationServerKey;

      if (
        !chavesIguais(
          chaveAnterior,
          chaveAtual
        )
      ) {
        feedback(
          "🔄 Sua inscrição usa uma chave antiga. Renovando..."
        );

        const removida =
          await sub.unsubscribe();

        if (!removida) {
          throw new Error(
            "Não foi possível renovar a inscrição antiga. Tente novamente."
          );
        }

        sub = null;
        renovada = true;
      }
    }

    // ====================================
    // CRIAR UMA NOVA INSCRIÇÃO
    // ====================================

    if (!sub) {
      feedback(
        "📱 Criando uma inscrição atualizada..."
      );

      sub = await criarSubscription(
        registro,
        chaveAtual
      );
    }

    // ====================================
    // SALVAR NO FIREBASE
    // ====================================

    feedback(
      "💾 Registrando o dispositivo no Firebase..."
    );

    const novoId =
      await salvarSubscription(
        sub,
        municipio,
        usuario
      );

    // Só limpar o registro antigo
    // depois de salvar o novo.

    await limparRegistroAntigo(
      idAntigo,
      novoId,
      usuario
    );

    subscription = sub;
    currentDocId = novoId;

    localStorage.setItem(
      STORAGE_DOC,
      novoId
    );

    localStorage.setItem(
      STORAGE_MUNICIPIO,
      municipio
    );

    if (renovada) {
      feedback(
        `✅ Inscrição renovada! Alertas ativados para ${municipio}.`
      );
    } else {
      feedback(
        `✅ Alertas ativados para ${municipio}.`
      );
    }

    console.log(
      "Inscrição web push registrada com sucesso."
    );

  } catch (erro) {
    console.error(
      "Erro ao ativar os alertas:",
      erro
    );

    feedback(
      "❌ " +
      (
        erro.message ||
        "Não foi possível ativar os alertas."
      )
    );

  } finally {
    ocupada = false;

    if (botao) {
      botao.disabled = false;
    }
  }
}

// ========================================
// DESATIVAR ALERTAS
// ========================================

async function desativar() {
  if (ocupada) {
    return;
  }

  ocupada = true;

  const botao = $("alertas-desativar");

  if (botao) {
    botao.disabled = true;
  }

  try {
    const usuario = obterUsuario();

    const id =
      currentDocId ||
      localStorage.getItem(STORAGE_DOC);

    if (
      !id ||
      !id.startsWith(usuario.uid + "_")
    ) {
      throw new Error(
        "Nenhuma inscrição desta conta foi encontrada neste dispositivo."
      );
    }

    const registro =
      await obterRegistro();

    const sub =
      await registro.pushManager.getSubscription();

    // Primeiro remover a inscrição
    // no serviço push.

    if (sub) {
      const removida = await sub.unsubscribe();

      if (!removida) {
        throw new Error(
          "Não foi possível desativar a inscrição no navegador."
        );
      }
    }

    // Depois remover do Firebase.

    await deleteDoc(
      doc(db, "pushSubscriptions", id)
    );

    subscription = null;
    currentDocId = null;

    localStorage.removeItem(
      STORAGE_DOC
    );

    localStorage.removeItem(
      STORAGE_MUNICIPIO
    );

    feedback(
      "🔕 Alertas desativados neste dispositivo."
    );

  } catch (erro) {
    console.error(
      "Erro ao desativar alertas:",
      erro
    );

    feedback(
      "❌ " +
      (
        erro.message ||
        "Não foi possível desativar os alertas."
      )
    );

  } finally {
    ocupada = false;

    if (botao) {
      botao.disabled = false;
    }
  }
}

// ========================================
// CONFIGURAR BOTÕES
// ========================================

const botaoAtivar =
  $("alertas-ativar");

const botaoDesativar =
  $("alertas-desativar");

const seletorMunicipio =
  $("alertas-cidade");

if (botaoAtivar) {
  botaoAtivar.addEventListener(
    "click",
    ativar
  );
}

if (botaoDesativar) {
  botaoDesativar.addEventListener(
    "click",
    desativar
  );
}

if (seletorMunicipio) {
  const municipioSalvo =
    localStorage.getItem(
      STORAGE_MUNICIPIO
    );

  seletorMunicipio.value =
    MUNICIPIOS.includes(municipioSalvo)
      ? municipioSalvo
      : "Todos";
}

// ========================================
// ACOMPANHAR LOGIN
// ========================================

window.addEventListener(
  "cade:user",
  evento => {
    const usuario = evento.detail;

    subscription = null;
    currentDocId = null;

    if (usuario) {
      feedback(
        "Conta conectada. Você pode ativar ou atualizar os alertas deste dispositivo."
      );
    } else {
      feedback(
        "Entre na sua conta para ativar os alertas."
      );
    }
  }
);

// ========================================
// FINAL
// ========================================

console.log(
  "Cadê Meu Pet: sistema de alertas carregado."
);
