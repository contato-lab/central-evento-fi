/* Service worker do Apoio a Mobilidade.
 *
 * Irmao dos que estao em /sw.js e /conteudo/sw.js, mesma receita: NAO guarda
 * pagina em cache. Durante o evento a tela muda varias vezes por dia, e service
 * worker segurando HTML e a receita conhecida de equipe inteira presa numa
 * versao velha. Aqui isso seria pior que nos outros: a tela da equipe e o unico
 * lugar onde um pedido de ajuda aparece.
 *
 * Este arquivo atende DOIS caminhos, e a diferenca importa:
 *
 *   1. "push"    -> vem do servidor, acorda o celular mesmo com o app FECHADO.
 *                   Chega sem conteudo: o servidor so toca a campainha e o
 *                   texto e montado aqui, lendo o Firestore na hora. Assim
 *                   ninguem precisa cifrar payload e o aviso mostra o pedido
 *                   mais recente de verdade.
 *   2. "message" -> vem da propria pagina, quando ela ja esta aberta ou
 *                   recem-minimizada e viu um chamado novo na escuta em tempo
 *                   real. Nao depende de servidor nenhum.
 */
var PROJETO = "festival-interlagos-2026";
var API_KEY = "AIzaSyBMY82Mcp1rhNXHt6gQhTvyV4VAjIkU0bI";
var BASE = "https://firestore.googleapis.com/v1/projects/" + PROJETO +
           "/databases/(default)/documents";
var APP_URL = "/mobilidade/";

function val(v){
  if(!v || typeof v !== "object") return v;
  if("stringValue"  in v) return v.stringValue;
  if("integerValue" in v) return parseInt(v.integerValue, 10);
  if("booleanValue" in v) return v.booleanValue;
  return null;
}

// PEDE SO O ULTIMO, NAO A COLECAO INTEIRA. No Firestore listagem custa uma
// leitura por documento: varrer mob_chamados a cada push acordaria o aparelho e
// gastaria centenas de leituras por aviso, vezes cada celular inscrito.
// Ordenado por criadoEm com limite 1, custa 1 leitura e nao cresce com a fila.
function ultimoChamado(){
  return fetch(BASE + ":runQuery?key=" + API_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "mob_chamados" }],
        orderBy: [{ field: { fieldPath: "criadoEm" }, direction: "DESCENDING" }],
        limit: 1
      }
    })
  })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      var linhas = (d && d.length) ? d : [];
      for(var i=0;i<linhas.length;i++){
        if(linhas[i] && linhas[i].document) return linhas[i].document.fields || {};
      }
      return null;
    })["catch"](function(){ return null; });
}

// O TEXTO DIZ O LUGAR, nao so "pedido novo". Quem recebe isto esta andando pelo
// autodromo: saber que e no Boulevard resolve metade do problema antes de a
// pessoa tirar o celular do bolso.
function montar(f){
  var lugar = f ? (val(f.local) || "") : "";
  var texto = f ? (val(f.texto) || "") : "";
  return {
    titulo: lugar ? ("Pedido de ajuda: " + lugar) : "Pedido de ajuda novo",
    corpo:  texto ? texto.slice(0, 120) : "Alguem pediu apoio de mobilidade. Toque para ver."
  };
}

function mostrar(m){
  return self.registration.showNotification(m.titulo, {
    body: m.corpo,
    icon: "../icon-192.png",
    badge: "../icon-192.png",
    // tag fixa: tres pedidos seguidos SUBSTITUEM o aviso em vez de empilhar
    // tres cartoes na tela de bloqueio
    tag: "mobilidade-fi",
    renotify: true,
    requireInteraction: true,   // fica na tela ate alguem tocar: pedido de ajuda nao some sozinho
    data: { url: APP_URL }
  });
}

self.addEventListener("push", function(ev){
  ev.waitUntil(
    ultimoChamado()
      .then(function(f){ return mostrar(montar(f)); })
      // Se o Firestore nao responder, ainda assim mostra alguma coisa: no iOS,
      // push recebido sem notificacao visivel conta como falta e a Apple pode
      // cortar o envio pro app depois de algumas vezes.
      ["catch"](function(){ return mostrar(montar(null)); })
  );
});

// aviso disparado pela propria pagina (app aberto ou recem-minimizado)
self.addEventListener("message", function(ev){
  var d = ev.data || {};
  if(d.tipo !== "chamado-novo") return;
  ev.waitUntil(mostrar({
    titulo: d.local ? ("Pedido de ajuda: " + d.local) : "Pedido de ajuda novo",
    corpo:  d.texto ? String(d.texto).slice(0,120) : "Alguem pediu apoio de mobilidade. Toque para ver."
  }));
});

self.addEventListener("notificationclick", function(ev){
  ev.notification.close();
  var destino = (ev.notification.data && ev.notification.data.url) || APP_URL;
  ev.waitUntil(
    self.clients.matchAll({ type:"window", includeUncontrolled:true }).then(function(lista){
      // se a tela da equipe ja esta aberta, traz ela pra frente em vez de abrir outra
      for(var i=0;i<lista.length;i++){
        if(lista[i].url.indexOf(destino) >= 0 && "focus" in lista[i]) return lista[i].focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(destino) : null;
    })
  );
});

self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(ev){ ev.waitUntil(self.clients.claim()); });
