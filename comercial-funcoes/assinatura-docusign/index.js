/*
 * Assinatura de contrato pela DocuSign.
 *
 *   POST /enviar     o painel pede para mandar um contrato para assinar
 *   POST /conferir   o painel pede para conferir agora se ja assinaram
 *   POST /docusign   a DocuSign avisa que o envelope terminou
 *
 * Quando assina, o contrato vira "assinado" e o PDF assinado entra no lugar do original.
 * Essa gravacao dispara a outra funcao, reservar-espaco-ao-assinar, que reserva o espaco.
 *
 * A volta da DocuSign nao e confiada as cegas: a funcao confere a situacao do envelope
 * direto na DocuSign com as credenciais dela antes de mudar qualquer coisa.
 *
 * As credenciais ficam no Secret Manager, no segredo "docusign", entregue aqui como a
 * variavel DOCUSIGN. O formato e solto de proposito, para colar sem erro: o Integration
 * Key, o User ID e a chave privada inteira, em qualquer ordem, com ou sem rotulo.
 */
const functions = require("@google-cloud/functions-framework");
const crypto = require("crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");

const BUCKET = "painel-comercial-fi.firebasestorage.app";
const ORIGENS = ["https://central.festivalinterlagos.com.br"];
initializeApp({ storageBucket: BUCKET });
const db = getFirestore();

class Erro extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }

const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// ------------------------------------------------------------------ credenciais
function lerCredenciais(textoBruto) {
  const bruto = String(textoBruto == null ? process.env.DOCUSIGN || "" : textoBruto);
  const bloco = bruto.match(/-----BEGIN ([A-Z ]*)PRIVATE KEY-----([\s\S]+?)-----END [A-Z ]*PRIVATE KEY-----/);
  if (!bloco) throw new Erro("Falta a chave privada da DocuSign no cofre do Google Cloud.", 500);
  // quem cola pode perder as quebras de linha: remonta a chave do jeito que ela tem que ser
  const corpo = bloco[2].replace(/\s+/g, "");
  const pem = "-----BEGIN " + bloco[1] + "PRIVATE KEY-----\n" + corpo.match(/.{1,64}/g).join("\n") + "\n-----END " + bloco[1] + "PRIVATE KEY-----\n";
  const resto = bruto.replace(bloco[0], " ");
  const GUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const comRotulo = (r) => { const m = resto.match(new RegExp(r + "[^\\n]*?(" + GUID + ")", "i")); return m ? m[1] : null; };
  const todos = resto.match(new RegExp(GUID, "gi")) || [];
  const integracao = comRotulo("integra") || todos[0] || null;
  const usuario = comRotulo("user") || comRotulo("usu") || todos.find((g) => g !== integracao) || null;
  if (!integracao || !usuario) throw new Erro("Falta o Integration Key ou o User ID da DocuSign no cofre do Google Cloud.", 500);
  const producao = /produ/i.test(process.env.DOCUSIGN_AMBIENTE || "");
  return { pem, integracao, usuario, oauth: producao ? "account.docusign.com" : "account-d.docusign.com" };
}

// ----------------------------------------------------------- acesso a DocuSign
let guardado = null; // o token vale uma hora; reaproveita enquanto a instancia estiver viva
async function acessoDocuSign() {
  if (guardado && guardado.vence > Date.now() + 60000) return guardado;
  const cred = lerCredenciais();
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = b64url(JSON.stringify({ iss: cred.integracao, sub: cred.usuario, aud: cred.oauth, iat: agora, exp: agora + 3000, scope: "signature impersonation" }));
  let assinatura;
  try { assinatura = crypto.createSign("RSA-SHA256").update(cab + "." + corpo).sign(cred.pem); }
  catch (e) { throw new Erro("A chave privada da DocuSign no cofre não é válida. Gere outra em Apps and Keys e cole de novo.", 500); }
  const r = await fetch("https://" + cred.oauth + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + cab + "." + corpo + "." + b64url(assinatura),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "consent_required") throw new Erro("A DocuSign ainda não autorizou o aplicativo. Falta abrir o link de autorização e clicar em Allow Access.", 502);
    throw new Erro("A DocuSign recusou o acesso (" + (j.error_description || j.error || r.status) + "). Confira o Integration Key, o User ID e a chave no cofre.", 502);
  }
  const u = await fetch("https://" + cred.oauth + "/oauth/userinfo", { headers: { Authorization: "Bearer " + j.access_token } });
  const info = await u.json().catch(() => ({}));
  const contas = info.accounts || [];
  const conta = contas.find((a) => a.is_default) || contas[0];
  if (!conta) throw new Erro("Esse usuário da DocuSign não tem conta de assinatura ligada.", 502);
  guardado = { token: j.access_token, base: conta.base_uri + "/restapi/v2.1/accounts/" + conta.account_id, vence: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return guardado;
}
async function docusign(caminho, opcoes) {
  const ds = await acessoDocuSign();
  const o = opcoes || {};
  const r = await fetch(ds.base + caminho, {
    method: o.method || "GET",
    headers: Object.assign({ Authorization: "Bearer " + ds.token }, o.json ? { "Content-Type": "application/json" } : {}),
    body: o.json ? JSON.stringify(o.json) : undefined,
  });
  return r;
}

// ------------------------------------------------------------------ quem pede
async function pessoaLogada(req) {
  const cab = String(req.get("Authorization") || "");
  const idToken = cab.startsWith("Bearer ") ? cab.slice(7) : "";
  if (!idToken) throw new Erro("Entre no painel de novo para continuar.", 401);
  let quem;
  try { quem = await getAuth().verifyIdToken(idToken); } catch (e) { throw new Erro("Sua sessão expirou. Entre no painel de novo.", 401); }
  if (!quem.email_verified) throw new Erro("Confirme o seu e-mail antes de mandar contrato para assinar.", 403);
  return quem;
}

// ------------------------------------------------------------------- enviar
async function enviar(req, res) {
  const quem = await pessoaLogada(req);
  const contratoId = String((req.body || {}).contratoId || "");
  if (!contratoId) throw new Erro("Faltou dizer qual contrato.");
  const ref = db.collection("contratos").doc(contratoId);
  const doc = await ref.get();
  if (!doc.exists) throw new Erro("Contrato não encontrado.", 404);
  const c = doc.data();
  const a = c.assinatura || {};
  if (c.status === "assinado") throw new Erro("Este contrato já está assinado.", 409);
  if (c.status === "cancelado") throw new Erro("Este contrato está cancelado.", 409);
  if (a.status === "enviado") throw new Erro("Este contrato já foi enviado e está esperando assinatura.", 409);
  if (!c.arquivo_path) throw new Erro("Suba o PDF do contrato antes de mandar para assinar.");

  const lista = (c.signatarios || []).filter((s) => s && String(s.nome || "").trim());
  if (!lista.length) throw new Erro("Coloque em Quem assina pelo menos uma pessoa, com nome e e-mail.");
  const semEmail = lista.filter((s) => !EMAIL.test(String(s.email || "").trim()));
  if (semEmail.length) throw new Erro("Falta um e-mail válido para: " + semEmail.map((s) => s.nome).join(", ") + ". Todo mundo que assina precisa de e-mail.");

  let pdf;
  try { [pdf] = await getStorage().bucket().file(c.arquivo_path).download(); }
  catch (e) { throw new Erro("Não consegui abrir o PDF guardado deste contrato.", 500); }

  const segredo = crypto.randomBytes(18).toString("hex");
  const volta = "https://" + req.get("host") + "/docusign?c=" + encodeURIComponent(contratoId) + "&t=" + segredo;
  const r = await docusign("/envelopes", {
    method: "POST",
    json: {
      emailSubject: ("Assinatura: " + (c.titulo || "Contrato")).slice(0, 100),
      emailBlurb: "Contrato enviado pelo Festival Interlagos. Leia e assine pelo botão abaixo.",
      documents: [{ documentBase64: pdf.toString("base64"), name: c.arquivo_nome || "contrato.pdf", fileExtension: "pdf", documentId: "1" }],
      // sem campos marcados: quem assina escolhe onde assinar, o que serve para qualquer PDF
      recipients: { signers: lista.map((s, i) => ({ email: String(s.email).trim(), name: String(s.nome).trim(), recipientId: String(i + 1), routingOrder: "1" })) },
      eventNotification: {
        url: volta, loggingEnabled: "true", requireAcknowledgment: "true",
        envelopeEvents: ["completed", "declined", "voided"].map((e) => ({ envelopeEventStatusCode: e })),
        eventData: { version: "restv2.1", format: "json" },
      },
      status: "sent",
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Erro("A DocuSign não aceitou o envio: " + (j.message || j.errorCode || r.status), 502);

  const agora = new Date().toISOString();
  await ref.update({
    status: "enviado",
    assinatura: {
      provedor: "docusign", envelope_id: j.envelopeId, status: "enviado", segredo: segredo,
      enviado_em: agora, enviado_por: quem.email || quem.uid,
      para: lista.map((s) => String(s.email).trim()), concluida_em: null, detalhe: "",
    },
    updated_at: agora,
  });
  console.log("enviado " + contratoId + " para " + lista.map((s) => s.email).join(", ") + " envelope " + j.envelopeId);
  res.json({ ok: true, para: lista.map((s) => String(s.email).trim()) });
}

// ------------------------------------------------ conferir a situacao na DocuSign
async function conferirContrato(contratoId) {
  const ref = db.collection("contratos").doc(contratoId);
  const doc = await ref.get();
  if (!doc.exists) return { situacao: "contrato-apagado" };
  const c = doc.data();
  const a = c.assinatura || {};
  if (!a.envelope_id) return { situacao: "nunca-enviado" };
  if (a.status === "assinado") return { situacao: "assinado" };

  const r = await docusign("/envelopes/" + a.envelope_id);
  const env = await r.json().catch(() => ({}));
  if (!r.ok) throw new Erro("Não consegui conferir o envelope na DocuSign (" + (env.message || r.status) + ").", 502);
  const agora = new Date().toISOString();

  if (env.status === "completed") {
    const pdfR = await docusign("/envelopes/" + a.envelope_id + "/documents/combined");
    if (!pdfR.ok) throw new Erro("A DocuSign disse que assinou, mas não entregou o PDF assinado.", 502);
    const pdf = Buffer.from(await pdfR.arrayBuffer());
    const caminho = "contratos/" + c.patrocinador_id + "/" + Date.now() + "-assinado.pdf";
    await getStorage().bucket().file(caminho).save(pdf, { contentType: "application/pdf" });
    const nomeBase = String(c.arquivo_nome || "contrato.pdf").replace(/\.pdf$/i, "");
    await ref.update({
      status: "assinado",
      assinado_em: hojeSP(),
      arquivo_original_path: c.arquivo_path || "",
      arquivo_original_nome: c.arquivo_nome || "",
      arquivo_path: caminho,
      arquivo_nome: nomeBase + " (assinado).pdf",
      "assinatura.status": "assinado",
      "assinatura.concluida_em": agora,
      updated_at: agora,
    });
    // igual o painel faz ao salvar contrato assinado com data de fim: atualiza o vencimento da marca
    if (/^\d{4}-\d{2}-\d{2}$/.test(c.fim || "") && c.patrocinador_id) {
      const pref = db.collection("patrocinadores").doc(c.patrocinador_id);
      const p = (await pref.get()).data();
      if (p && (!p.data_vencimento_contrato || c.fim > p.data_vencimento_contrato)) {
        await pref.update({ data_vencimento_contrato: c.fim, status: p.status === "encerrado" ? "encerrado" : "ativo" });
      }
    }
    return { situacao: "assinado" };
  }
  if (env.status === "declined" || env.status === "voided") {
    const nova = env.status === "declined" ? "recusado" : "cancelado";
    if (a.status !== nova) await ref.update({ "assinatura.status": nova, "assinatura.detalhe": env.voidedReason || "", updated_at: agora });
    return { situacao: nova };
  }
  return { situacao: "esperando", docusign: env.status };
}

async function conferir(req, res) {
  await pessoaLogada(req);
  const contratoId = String((req.body || {}).contratoId || "");
  if (!contratoId) throw new Erro("Faltou dizer qual contrato.");
  res.json(await conferirContrato(contratoId));
}

// ------------------------------------------------------- a DocuSign avisando
async function voltaDaDocuSign(req, res) {
  const contratoId = String(req.query.c || ""), segredo = String(req.query.t || "");
  if (!contratoId || !segredo) return res.status(400).send("faltou contrato");
  const doc = await db.collection("contratos").doc(contratoId).get();
  // 200 para contrato que sumiu: senao a DocuSign fica tentando para sempre
  if (!doc.exists) return res.status(200).send("contrato nao existe mais");
  const a = doc.data().assinatura || {};
  if (!a.segredo || a.segredo !== segredo) return res.status(403).send("chamada nao reconhecida");
  const r = await conferirContrato(contratoId);
  console.log("docusign avisou " + contratoId + ": " + r.situacao);
  res.status(200).send(r.situacao);
}

// ------------------------------------------------------------------ entrada
functions.http("assinaturaDocusign", async (req, res) => {
  const origem = req.get("Origin");
  if (origem && ORIGENS.includes(origem)) { res.set("Access-Control-Allow-Origin", origem); res.set("Vary", "Origin"); }
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    return res.status(204).send("");
  }
  try {
    if (req.method === "POST" && req.path === "/enviar") return await enviar(req, res);
    if (req.method === "POST" && req.path === "/conferir") return await conferir(req, res);
    if (req.method === "POST" && req.path === "/docusign") return await voltaDaDocuSign(req, res);
    res.status(404).json({ erro: "caminho desconhecido" });
  } catch (e) {
    console.error(req.path + ": " + (e && e.stack || e));
    res.status(e.status || 500).json({ erro: e.message || "erro inesperado" });
  }
});

module.exports = { lerCredenciais, conferirContrato, Erro };
