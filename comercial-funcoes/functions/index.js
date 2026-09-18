/*
 * Reserva automatica de espaco quando o contrato vira assinado.
 *
 * Esta funcao existe para o caso em que ninguem esta com o painel aberto: contrato
 * assinado por outro computador, ou, quando a assinatura por API entrar, contrato que
 * volta assinado sozinho de madrugada. O painel tambem faz isso quando abre, e as duas
 * coisas podem rodar na mesma reserva sem problema: quem chegar depois nao muda nada.
 *
 * A regra e a mesma do painel, de proposito:
 *   1. o espaco que ja esta amarrado na ficha da marca
 *   2. os espacos da edicao do contrato em que a marca de 2026 e essa marca
 * Nunca encosta em espaco que ja e de outra marca, e nunca rebaixa espaco vendido.
 */
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const REGIAO = "southamerica-east1";
setGlobalOptions({ region: REGIAO, maxInstances: 3 });

initializeApp();
const db = getFirestore();

// "CFMOTO" e "cfmoto" sao a mesma marca; "Consorcio Honda" e "Honda" nao sao.
function mesmaMarca(a, b) {
  const limpa = (t) => String(t || "").toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const x = limpa(a), y = limpa(b);
  return !!x && x === y;
}

exports.reservarEspacoAoAssinar = onDocumentUpdated("contratos/{id}", async (evento) => {
  const antes = evento.data?.before?.data();
  const depois = evento.data?.after?.data();
  if (!depois) return;
  // so age na virada para assinado, nao a cada salvada do contrato
  if (antes?.status === "assinado" || depois.status !== "assinado") return;
  if (!depois.patrocinador_id || !depois.edicao) {
    console.log("contrato assinado sem marca ou sem edicao, nada a fazer", evento.params.id);
    return;
  }

  const contratoId = evento.params.id;
  const marcaRef = db.collection("patrocinadores").doc(depois.patrocinador_id);
  const marcaDoc = await marcaRef.get();
  if (!marcaDoc.exists) { console.log("marca do contrato nao existe", depois.patrocinador_id); return; }
  const marca = marcaDoc.data();

  const espacosSnap = await db.collection("espacos").get();
  const espacos = [];
  espacosSnap.forEach((d) => espacos.push({ id: d.id, ...d.data() }));

  // quem ja tem dono: marca apontando para o espaco na ficha dela
  const donoPorVinculo = {};
  const marcasSnap = await db.collection("patrocinadores").get();
  marcasSnap.forEach((d) => {
    const v = d.data();
    if (v.espaco_vinculado_id) donoPorVinculo[v.espaco_vinculado_id] = { id: d.id, nome: v.nome };
  });

  const candidatos = [];
  const junta = (e) => { if (e && !candidatos.includes(e)) candidatos.push(e); };
  if (marca.espaco_vinculado_id) junta(espacos.find((e) => e.id === marca.espaco_vinculado_id));
  espacos.forEach((e) => {
    if (e.edicao === depois.edicao && mesmaMarca(e.ocupante_2026, marca.nome)) junta(e);
  });
  if (!candidatos.length) { console.log("nenhum espaco da planta para", marca.nome); return; }

  const lote = db.batch();
  const reservados = [], conflitos = [];
  let primeiro = null;
  candidatos.forEach((e) => {
    const dono = donoPorVinculo[e.id];
    const deOutro = (dono && !mesmaMarca(dono.nome, marca.nome)) ||
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

  if (!reservados.length) {
    console.log("nada novo para reservar", marca.nome, "conflitos:", conflitos.join(", "));
    return;
  }
  // a ficha da marca aponta para um espaco so: preenche se estiver vazia
  if (!marca.espaco_vinculado_id && primeiro) lote.update(marcaRef, { espaco_vinculado_id: primeiro });
  await lote.commit();
  console.log("reservados para " + marca.nome + ": " + reservados.join(", ") +
    (conflitos.length ? " | nao mexi em: " + conflitos.join(", ") : ""));
});
