/*
 * Reserva automatica de espaco quando o contrato vira assinado.
 *
 * Existe para quando ninguem esta com o painel aberto: contrato assinado em outro
 * computador ou, quando a assinatura por API entrar, contrato que volta assinado sozinho.
 * O painel faz a mesma coisa quando abre, e os dois podem agir na mesma reserva sem se
 * atrapalhar.
 *
 * Roda a cada gravacao em contratos/{id}. Nao decodifica o evento: le o contrato direto
 * do banco pelo id, o que funciona igual publicando pelo console ou pela linha de comando.
 *
 * Regra, igual a do painel:
 *   1. o espaco que ja esta amarrado na ficha da marca
 *   2. os espacos da edicao do contrato em que a marca de 2026 e essa marca
 * Nunca encosta em espaco que ja e de outra marca, nunca rebaixa espaco vendido, e nao
 * age em contrato que ja reservou alguma vez: se depois disso alguem devolveu o espaco
 * para Disponivel, foi decisao de gente e fica como esta.
 */
const functions = require("@google-cloud/functions-framework");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// "CFMOTO" e "cfmoto" sao a mesma marca; "Consorcio Honda" e "Honda" nao sao.
function mesmaMarca(a, b) {
  const limpa = (t) => String(t || "").toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const x = limpa(a), y = limpa(b);
  return !!x && x === y;
}

// O evento do Firestore traz o caminho do documento, tipo "contratos/abc123".
function idDoContrato(evento) {
  const caminho = String(evento.document || evento.subject || "").replace(/^documents\//, "");
  const partes = caminho.split("/");
  return partes[0] === "contratos" && partes[1] ? partes[1] : null;
}

async function reservar(contratoId) {
  const contratoDoc = await db.collection("contratos").doc(contratoId).get();
  if (!contratoDoc.exists) return "contrato apagado, nada a fazer";
  const c = contratoDoc.data();
  if (c.status !== "assinado") return "contrato nao esta assinado";
  if (!c.patrocinador_id || !c.edicao) return "contrato assinado sem marca ou sem edicao";

  const espacosSnap = await db.collection("espacos").get();
  const espacos = [];
  espacosSnap.forEach((d) => espacos.push({ id: d.id, ...d.data() }));
  if (espacos.some((e) => e.reservado_por_contrato === contratoId)) return "contrato ja reservou antes";

  const marcaRef = db.collection("patrocinadores").doc(c.patrocinador_id);
  const marcaDoc = await marcaRef.get();
  if (!marcaDoc.exists) return "marca do contrato nao existe";
  const marca = marcaDoc.data();

  // quem ja tem dono: marca apontando para o espaco na ficha dela
  const donoPorVinculo = {};
  (await db.collection("patrocinadores").get()).forEach((d) => {
    const v = d.data();
    if (v.espaco_vinculado_id) donoPorVinculo[v.espaco_vinculado_id] = { id: d.id, nome: v.nome };
  });

  const candidatos = [];
  const junta = (e) => { if (e && !candidatos.includes(e)) candidatos.push(e); };
  if (marca.espaco_vinculado_id) junta(espacos.find((e) => e.id === marca.espaco_vinculado_id));
  espacos.forEach((e) => { if (e.edicao === c.edicao && mesmaMarca(e.ocupante_2026, marca.nome)) junta(e); });
  if (!candidatos.length) return "nenhum espaco da planta para " + marca.nome;

  const lote = db.batch();
  const reservados = [], conflitos = [];
  let primeiro = null;
  candidatos.forEach((e) => {
    const dono = donoPorVinculo[e.id];
    const deOutro = (dono && dono.id !== marcaDoc.id && !mesmaMarca(dono.nome, marca.nome)) ||
      (e.reservado_para_id && e.reservado_para_id !== marcaDoc.id);
    if (deOutro) { conflitos.push(e.nome); return; }
    if (e.status === "vendido") return;
    if (e.status === "reservado" && e.reservado_para_id === marcaDoc.id) return;
    lote.update(db.collection("espacos").doc(e.id), {
      status: "reservado",
      reservado_para_id: marcaDoc.id,
      reservado_para_nome: marca.nome,
      reservado_por_contrato: contratoId,
      updated_at: new Date().toISOString(),
    });
    if (!primeiro) primeiro = e.id;
    reservados.push(e.nome);
  });
  if (!reservados.length) return "nada novo para " + marca.nome + (conflitos.length ? ", nao mexi em: " + conflitos.join(", ") : "");
  // a ficha da marca aponta para um espaco so: preenche se estiver vazia
  if (!marca.espaco_vinculado_id && primeiro) lote.update(marcaRef, { espaco_vinculado_id: primeiro });
  await lote.commit();
  return "reservados para " + marca.nome + ": " + reservados.join(", ") +
    (conflitos.length ? " | nao mexi em: " + conflitos.join(", ") : "");
}

functions.cloudEvent("reservarEspacoAoAssinar", async (evento) => {
  const id = idDoContrato(evento);
  if (!id) { console.log("evento sem id de contrato", evento.subject); return; }
  console.log("contrato " + id + ": " + (await reservar(id)));
});

module.exports = { reservar, idDoContrato, mesmaMarca };
