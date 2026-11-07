
/*
  CADÊ MEU PET
  SINCRONIZAÇÃO DE RECEBIMENTOS PUSH

  Guarda a confirmação no Firebase
  quando o aplicativo é aberto com
  o usuário autenticado.

  Não altera inscrições nem envia push.
*/

import {
  auth,
  db
} from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const DB_NAME = "cade-push-receipts-v1";
const STORE_NAME = "receipts";

let sincronizando = false;

function abrirBanco() {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(DB_NAME, 1);

    pedido.onupgradeneeded = () => {
      const banco = pedido.result;

      if (!banco.objectStoreNames.contains(STORE_NAME)) {
        banco.createObjectStore(
          STORE_NAME,
          { keyPath: "id" }
        );
      }
    };

    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

async function listarRegistros(banco) {
  return new Promise((resolve, reject) => {
    const transacao = banco.transaction(
      STORE_NAME,
      "readonly"
    );

    const pedido = transacao
      .objectStore(STORE_NAME)
      .getAll();

    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

async function excluirRegistro(banco, id) {
  return new Promise((resolve, reject) => {
    const transacao = banco.transaction(
      STORE_NAME,
      "readwrite"
    );

    transacao.objectStore(STORE_NAME).delete(id);

    transacao.oncomplete = () => resolve();
    transacao.onerror = () => reject(transacao.error);
    transacao.onabort = () => reject(transacao.error);
  });
}

async function hashEndpoint(endpoint) {
  const dados = new TextEncoder().encode(endpoint);

  const digest = await crypto.subtle.digest(
    "SHA-256",
    dados
  );

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function inscricaoAtual() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  const registro = await navigator.serviceWorker.ready;

  const sub = await registro.pushManager.getSubscription();

  if (!sub?.endpoint) {
    return null;
  }

  return hashEndpoint(sub.endpoint);
}

async function sincronizarRecebimentos() {
  if (sincronizando) return;

  const usuario = auth.currentUser;

  if (!usuario) return;

  if (
    !("indexedDB" in window) ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  sincronizando = true;

  let banco = null;

  try {
    const inscricaoHash = await inscricaoAtual();

    if (!inscricaoHash) {
      return;
    }

    banco = await abrirBanco();

    const registros = await listarRegistros(banco);

    if (!registros.length) return;

    let enviados = 0;

    for (const registro of registros) {
      // Não atribuir ao usuário atual os
      // registros de outra inscrição.

      if (registro.inscricaoHash !== inscricaoHash) {
        continue;
      }

      if (auth.currentUser?.uid !== usuario.uid) {
        break;
      }

      const data = new Date(registro.recebidoEmISO);

      if (
        !registro.id ||
        !registro.animalId ||
        !Number.isFinite(data.getTime())
      ) {
        continue;
      }

      const idDocumento =
        `${usuario.uid}_${registro.id}`;

      try {
        await setDoc(
          doc(db, "pushReceipts", idDocumento),
          {
            uid: usuario.uid,
            animalId: registro.animalId,
            inscricaoHash,
            recebidoEm: data,
            sincronizadoEm: serverTimestamp(),
            resultado: "exibicao_solicitada"
          }
        );

        await excluirRegistro(banco, registro.id);

        enviados++;
      } catch (erro) {
        console.warn(
          "Falha ao sincronizar recebimento:",
          erro
        );
      }
    }

    if (enviados) {
      console.log(
        `Cadê Meu Pet: ${enviados} recebimento(s) sincronizado(s).`
      );
    }

  } catch (erro) {
    console.warn(
      "Sincronização de push indisponível:",
      erro
    );
  } finally {
    if (banco) banco.close();
    sincronizando = false;
  }
}

// SINCRONIZAR APÓS LOGIN

onAuthStateChanged(auth, usuario => {
  if (usuario) {
    sincronizarRecebimentos();
  }
});

// SINCRONIZAR QUANDO O USUÁRIO VOLTAR

document.addEventListener(
  "visibilitychange",
  () => {
    if (!document.hidden) {
      sincronizarRecebimentos();
    }
  }
);

window.addEventListener(
  "focus",
  sincronizarRecebimentos
);

// SINCRONIZAR QUANDO A PÁGINA TERMINAR DE CARREGAR

window.addEventListener(
  "load",
  sincronizarRecebimentos
);
