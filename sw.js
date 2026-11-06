
"use strict";

/*
  SERVICE WORKER - CADÊ MEU PET

  Versão inicial do PWA.

  Recursos:
  - Instalação do Service Worker.
  - Cache do manifesto e dos ícones.
  - Página de aviso quando estiver offline.

  O cadastro e a visualização dos anúncios
  continuam dependendo da internet e do Firebase.
*/

const CACHE_NAME = "cade-meu-pet-pwa-v2";

const ARQUIVOS = [
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/*
  INSTALAR
*/

self.addEventListener("install", evento => {

  evento.waitUntil(
    (async () => {

      const cache = await caches.open(
        CACHE_NAME
      );

      await cache.addAll(ARQUIVOS);

      await self.skipWaiting();

    })()
  );

});

/*
  ATIVAR
*/

self.addEventListener("activate", evento => {

  evento.waitUntil(
    (async () => {

      const chaves = await caches.keys();

      await Promise.all(
        chaves
          .filter(nome =>
            nome.startsWith("cade-meu-pet-") &&
            nome !== CACHE_NAME
          )
          .map(nome => caches.delete(nome))
      );

      await self.clients.claim();

    })()
  );

});

/*
  PÁGINA OFFLINE
*/

function paginaOffline() {

  return new Response(
    `<!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport"
        content="width=device-width,initial-scale=1">

      <meta name="theme-color" content="#006B75">

      <title>Cadê Meu Pet | Sem conexão</title>

      <style>
        * {
          box-sizing:border-box;
        }

        body {
          margin:0;
          min-height:100vh;
          padding:24px;
          display:grid;
          place-items:center;
          background:#e9f8f7;
          color:#063e49;
          font-family:Arial,sans-serif;
          text-align:center;
        }

        main {
          width:min(100%,440px);
          padding:36px 25px;
          border-radius:25px;
          background:white;
          box-shadow:0 12px 35px #123d4915;
        }

        h1 {
          color:#006b75;
        }

        p {
          line-height:1.6;
        }

        a {
          display:inline-block;
          padding:13px 22px;
          margin-top:15px;
          border-radius:13px;
          background:#006b75;
          color:white;
          text-decoration:none;
          font-weight:bold;
        }
      </style>
    </head>

    <body>
      <main>

        <h1>🐾 Cadê Meu Pet</h1>

        <h2>Você está sem conexão</h2>

        <p>
          Conecte-se à internet para consultar
          os anúncios de animais perdidos,
          encontrados e reencontrados.
        </p>

        <a href="./index.html">
          Tentar novamente
        </a>

      </main>
    </body>
    </html>`,
    {
      status:503,
      headers:{
        "Content-Type":"text/html; charset=UTF-8"
      }
    }
  );
}

/*
  REQUISIÇÕES
*/

self.addEventListener("fetch", evento => {

  const pedido = evento.request;

  if (pedido.method !== "GET") {
    return;
  }

  const url = new URL(pedido.url);

  /*
    Não interferir em serviços externos
    como Firebase, Cloudinary e Google.
  */

  if (url.origin !== self.location.origin) {
    return;
  }

  /*
    Navegação usa a rede primeiro.
  */

  if (pedido.mode === "navigate") {

    evento.respondWith(
      fetch(pedido).catch(() => paginaOffline())
    );

    return;
  }

  /*
    Ícones e manifesto:
    usar cache quando disponível.
  */

  const arquivoEstatico =
    url.pathname.endsWith("/manifest.json") ||
    url.pathname.endsWith("/icons/icon-192.png") ||
    url.pathname.endsWith("/icons/icon-512.png");

  if (arquivoEstatico) {

    evento.respondWith(
      (async () => {

        const cache = await caches.open(
          CACHE_NAME
        );

        const salvo = await cache.match(
          pedido
        );

        if (salvo) {
          return salvo;
        }

        const resposta = await fetch(pedido);

        if (resposta.ok) {
          await cache.put(
            pedido,
            resposta.clone()
          );
        }

        return resposta;

      })()
    );
  }

});
