/* Service worker da Central do Evento (credenciados).
 *
 * Irmao do que esta em /conteudo/sw.js, mas le outra coisa: la sao pecas e
 * checklist, aqui sao os avisos e o mural que a producao publica pra imprensa.
 *
 * Nao guarda pagina em cache de proposito. Durante o evento a tela muda varias
 * vezes por dia, e service worker segurando HTML e a receita conhecida de todo
 * mundo preso numa versao velha. O cache do navegador ja da trabalho suficiente.
 *
 * O push chega SEM conteudo. O servidor so toca a campainha; o texto e montado
 * aqui, lendo o Firestore na hora de acordar. Assim ninguem precisa cifrar
 * payload, e a notificacao mostra o aviso mais recente de verdade.
 */
var PROJETO = "festival-interlagos-2026";
var API_KEY = "AIzaSyBMY82Mcp1rhNXHt6gQhTvyV4VAjIkU0bI";
var BASE = "https://firestore.googleapis.com/v1/projects/" + PROJETO +
           "/databases/(default)/documents";
var APP_URL = "/";

function val(v){
  if(!v || typeof v !== "object") return v;
  if("stringValue"  in v) return v.stringValue;
  if("integerValue" in v) return parseInt(v.integerValue, 10);
  if("booleanValue" in v) return v.booleanValue;
  return null;
}

// avisos e mural guardam a lista inteira dentro de um documento so, em "items"
function maisNovoDoDoc(caminho, rotulo){
  return fetch(BASE + "/" + caminho + "?key=" + API_KEY)
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      var arr = (((d || {}).fields || {}).items || {}).arrayValue;
      var lista = (arr && arr.values) || [];
      var melhor = null, t = 0;
      for(var i=0;i<lista.length;i++){
        var f = (lista[i].mapValue || {}).fields || {};
        var ts = val(f.ts);
        if(typeof ts !== "number") ts = val(f.criadoEm);
        if(typeof ts !== "number") ts = val(f.em);
        if(typeof ts === "number" && ts > t){ t = ts; melhor = f; }
      }
      return melhor ? { f:melhor, ts:t, rotulo:rotulo } : null;
    })["catch"](function(){ return null; });
}

self.addEventListener("push", function(ev){
  ev.waitUntil(
    Promise.all([
      maisNovoDoDoc("board/avisos", "Aviso"),
      maisNovoDoDoc("board/mural",  "Mural do Evento")
    ]).then(function(r){
      var a = r[0], m = r[1];
      var alvo = (!m || (a && a.ts >= m.ts)) ? a : m;

      var titulo = "Novidade na Central do Evento";
      var corpo  = "A produção publicou uma informação nova. Toque para ver.";

      if(alvo){
        var f = alvo.f;
        var tema = val(f.tema) || val(f.titulo) || "";
        var txt  = val(f.texto) || val(f.mensagem) || val(f.corpo) || "";
        titulo = tema ? (alvo.rotulo + ": " + tema) : ("Novo " + alvo.rotulo.toLowerCase());
        if(txt) corpo = txt.length > 140 ? txt.slice(0, 137) + "..." : txt;
      }

      return self.registration.showNotification(titulo, {
        body: corpo,
        icon: "icon-192.png",
        badge: "icon-192.png",
        // tag fixa: dois avisos seguidos SUBSTITUEM a notificacao em vez de
        // empilhar duas na tela de bloqueio do jornalista
        tag: "central-fi",
        renotify: true,
        data: { url: APP_URL }
      });
    })
    // Se o Firestore nao responder, mostra assim mesmo: no iOS, push recebido
    // sem notificacao visivel conta como falta e a Apple pode cortar o envio.
    ["catch"](function(){
      return self.registration.showNotification("Novidade na Central do Evento", {
        body: "A produção publicou uma informação nova. Toque para ver.",
        icon: "icon-192.png", tag: "central-fi", data: { url: APP_URL }
      });
    })
  );
});

self.addEventListener("notificationclick", function(ev){
  ev.notification.close();
  var destino = (ev.notification.data && ev.notification.data.url) || APP_URL;
  ev.waitUntil(
    self.clients.matchAll({ type:"window", includeUncontrolled:true }).then(function(lista){
      for(var i=0;i<lista.length;i++){
        if(lista[i].url.indexOf(destino) >= 0 && "focus" in lista[i]) return lista[i].focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(destino) : null;
    })
  );
});

self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(ev){ ev.waitUntil(self.clients.claim()); });
