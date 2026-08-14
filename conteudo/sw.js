/* Service worker do modulo de Conteudo da Central do Evento.
 *
 * So existe por causa da notificacao. Nao guarda pagina em cache de proposito:
 * durante o evento a tela muda varias vezes por dia, e service worker guardando
 * HTML e a receita conhecida de time inteiro preso numa versao velha. O cache
 * do navegador ja da trabalho suficiente (foi por isso que a tela ganhou o
 * aviso de "saiu uma versao mais nova").
 *
 * O push chega SEM conteudo. A Cloudflare so avisa "entrou coisa nova"; quem
 * monta o texto e este arquivo, lendo o Firestore na hora. Assim o servidor nao
 * precisa cifrar payload (aes128gcm), que e a parte chata e mais faceis de
 * errar do Web Push, e a notificacao sempre mostra o dado mais recente de
 * verdade, nao um texto que foi montado minutos antes.
 */
var PROJETO = "central-evento-fi";
var API_KEY = "AIzaSyD1spoy847dEtccSGJflKtG4-EYZMe23OQ";
var BASE = "https://firestore.googleapis.com/v1/projects/" + PROJETO +
           "/databases/(default)/documents";
var APP_URL = "/conteudo/";

function val(v){
  if(!v || typeof v !== "object") return v;
  if("stringValue"  in v) return v.stringValue;
  if("integerValue" in v) return parseInt(v.integerValue, 10);
  if("booleanValue" in v) return v.booleanValue;
  return null;
}

function carimbo(f){
  var c = val(f.criadoEm);
  if(typeof c === "number" && c > 0) return c;
  var e = val(f.em);
  return typeof e === "number" ? e : 0;
}

function maisNovo(colecao){
  return fetch(BASE + "/" + colecao + "?key=" + API_KEY + "&pageSize=300")
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      var docs = (d && d.documents) || [], melhor = null, t = 0;
      for(var i=0;i<docs.length;i++){
        var f = docs[i].fields || {}, c = carimbo(f);
        if(c > t){ t = c; melhor = f; }
      }
      return melhor ? { f:melhor, ts:t, col:colecao } : null;
    })["catch"](function(){ return null; });
}

self.addEventListener("push", function(ev){
  ev.waitUntil(
    Promise.all([maisNovo("cont_pecas"), maisNovo("cont_story")])
      .then(function(r){
        var pecas = r[0], story = r[1];
        var alvo = (!story || (pecas && pecas.ts >= story.ts)) ? pecas : story;
        var titulo = "Conteúdo novo na Central";
        var corpo  = "Entrou material novo. Toque para ver.";

        if(alvo && alvo.col === "cont_pecas"){
          var marca   = val(alvo.f.marca)   || val(alvo.f.tema) || "Sem marca";
          var formato = val(alvo.f.formato) || "";
          var quem    = val(alvo.f.por)     || "";
          titulo = "Peça nova: " + marca;
          corpo  = (formato ? formato : "Orgânicos e pagos") + (quem ? " · por " + quem : "");
        } else if(alvo && alvo.col === "cont_story"){
          titulo = "StoryMaker: " + (val(alvo.f.grupo) || "bloco novo");
          corpo  = val(alvo.f.texto) || "Novo item no checklist.";
        }

        return self.registration.showNotification(titulo, {
          body: corpo,
          icon: "icon-192.png",
          badge: "icon-192.png",
          // tag fixa: se entrarem tres pecas seguidas, a notificacao e
          // SUBSTITUIDA em vez de empilhar tres avisos na tela de bloqueio
          tag: "conteudo-fi",
          renotify: true,
          data: { url: APP_URL }
        });
      })
      // Se o Firestore nao responder, ainda assim mostra alguma coisa: no iOS,
      // push recebido sem notificacao visivel conta como falta e a Apple pode
      // cortar o envio pro app depois de algumas vezes.
      ["catch"](function(){
        return self.registration.showNotification("Conteúdo novo na Central", {
          body: "Entrou material novo. Toque para ver.",
          icon: "icon-192.png", tag: "conteudo-fi", data: { url: APP_URL }
        });
      })
  );
});

self.addEventListener("notificationclick", function(ev){
  ev.notification.close();
  var destino = (ev.notification.data && ev.notification.data.url) || APP_URL;
  ev.waitUntil(
    self.clients.matchAll({ type:"window", includeUncontrolled:true }).then(function(lista){
      // se a Central ja esta aberta, traz ela pra frente em vez de abrir outra
      for(var i=0;i<lista.length;i++){
        if(lista[i].url.indexOf(destino) >= 0 && "focus" in lista[i]) return lista[i].focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(destino) : null;
    })
  );
});

self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(ev){ ev.waitUntil(self.clients.claim()); });
