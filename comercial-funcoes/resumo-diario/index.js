/*
 * Resumo diario do Painel Comercial por e-mail: segunda a sexta, 8h de Sao Paulo, chamado
 * pelo Cloud Scheduler. Cada vendedor recebe os alertas das marcas dele; administrador e dono
 * recebem a equipe inteira. Todo mundo ve o que foi assinado desde o resumo anterior.
 *
 * As regras dos alertas sao as mesmas da tela Inicio do painel (calcularAlertas,
 * alertasRenovacao e getProspects no index.html). Mudou la, muda aqui. Desde a VERSAO
 * 2026-09-18.6 do painel: renovacao 2027 (confirmar, sinal de 10%, contrato) em primeiro lugar,
 * e o resto vira "Outras pendencias".
 *
 * Envio: Gmail com senha de app, lido do segredo "gmail-painel" (variavel GMAIL), em texto
 * livre com o e-mail e a senha de 16 letras. Sem o segredo, a funcao so monta e registra.
 * SO_PARA (variavel opcional): manda so para esse endereco, para testar sem acordar a equipe.
 * ?ensaio=1 na chamada: monta tudo, nao envia nada e devolve o resumo em JSON.
 */
const functions = require("@google-cloud/functions-framework");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");

initializeApp();
const db = getFirestore();

// identidade do codigo publicado: confere com o arquivo local sem precisar ler o editor
console.log("resumo-diario carregado, sha256 " + crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"));

const URL_PAINEL = "https://central.festivalinterlagos.com.br/comercial/#/app/inicio";
// datas das edicoes 2027 e prazos da renovacao: e-mail "Confirmacao das datas" (18/09/2026)
const CONFIG_PADRAO = { moto_data: "2027-05-19", auto_data: "2027-06-02", dias_sem_contato: 14, dias_gatilho_master: 90,
  prazo_confirmacao: "2026-09-30", prazo_sinal: "2026-10-30", prazo_assinatura: "2026-11-30" };
const JANELA_AVISO = { confirmacao: 15, sinal: 10, assinatura: 15 };
const DIAS_ESPERA_CONTRATO = 7;
const MARGEM_ESPACO = 7; // semana de margem depois do prazo, antes de o espaco poder ser liberado
const STATUS_CONTRATO = { rascunho: "rascunho", enviado: "aguardando assinatura", assinado: "assinado" };
const RENOVACAO = { sem_contato: "Sem contato", em_negociacao: "Em negociação", renovado: "Renovado", recusou: "Recusou" };
const ANDAMENTO = ["mapeada", "primeiro_contato", "proposta", "negociacao"];
const COR = { vermelho: "#E5484D", amarelo: "#E0A100", azul: "#5B8DEF" };

// ------------------------------------------------------------------ datas (Sao Paulo)
function hojeMais(dias) {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(hoje + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function diasAte(dataIso) {
  if (!dataIso) return null;
  const hoje = new Date(hojeMais(0) + "T12:00:00Z"), alvo = new Date(String(dataIso).slice(0, 10) + "T12:00:00Z");
  if (isNaN(alvo)) return null;
  return Math.round((alvo - hoje) / 86400000);
}
function textoDias(n, futuro) {
  if (n === 0) return "hoje";
  if (n === 1) return futuro ? "em 1 dia" : "há 1 dia";
  return futuro ? "em " + n + " dias" : "há " + n + " dias";
}
function dataCurta(iso) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(String(iso).slice(0, 10) + "T12:00:00-03:00"));
}
function diaDaSemana(iso) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" }).format(new Date(iso + "T12:00:00-03:00"));
}
function reais(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}
function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function ddmm(iso) { return dataCurta(iso).slice(0, 5); }
function chave(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
function dataValida(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null; }
// contrato da edicao 2027: vigencia em 2027, "2027" no titulo ou assinado depois de setembro de 2026
function eContrato2027(c) {
  return (!!c.fim && c.fim >= "2027-01-01") || (!!c.inicio && c.inicio >= "2027-01-01") || /2027/.test(c.titulo || "") || (!!c.assinado_em && c.assinado_em >= "2026-09-01");
}
// "CFMOTO" e "cfmoto" sao a mesma marca; "Consorcio Honda" e "Honda" nao sao.
function mesmaMarca(a, b) {
  const limpa = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const x = limpa(a), y = limpa(b);
  return !!x && x === y;
}

// ------------------------------------------------------------------ dados
async function lerTudo() {
  const nomes = ["patrocinadores", "espacos", "interacoes", "combinados", "contratos", "prospeccao", "profiles"];
  const snaps = await Promise.all(nomes.map((n) => db.collection(n).get()));
  const d = {};
  nomes.forEach((n, i) => { d[n] = []; snaps[i].forEach((doc) => d[n].push(Object.assign({}, doc.data(), { id: doc.id }))); });
  const cfg = await db.collection("config").doc("geral").get();
  d.cfg = Object.assign({}, CONFIG_PADRAO, cfg.exists ? cfg.data() : {});
  return d;
}

// ------------------------------------------------------------------ regras (iguais as do Inicio)
function montarAlertas(d) {
  const cfg = d.cfg;
  const hoje = hojeMais(0), semana = hojeMais(7);
  const lista = [];
  const espacoPorId = {};
  d.espacos.forEach((e) => { espacoPorId[e.id] = e; });
  const ultimo = {};
  d.interacoes.forEach((i) => { if (i.patrocinador_id && (!ultimo[i.patrocinador_id] || i.data > ultimo[i.patrocinador_id])) ultimo[i.patrocinador_id] = i.data; });

  // base de 2026 = marcas que ocuparam algum espaco na planta de 2026
  const ocupou = {};
  d.espacos.forEach((e) => { const k = chave(e.ocupante_2026); if (k) (ocupou[k] = ocupou[k] || []).push(e); });
  const contratos27 = {};
  const ordemC = { assinado: 0, enviado: 1, rascunho: 2 };
  d.contratos.forEach((c) => { if (c.patrocinador_id && c.status !== "cancelado" && eContrato2027(c)) (contratos27[c.patrocinador_id] = contratos27[c.patrocinador_id] || []).push(c); });

  const patros = d.patrocinadores.map((s) => ({
    id: s.id, nome: s.nome || "Patrocinador", status: s.status || "ativo", master: s.master === true,
    renovacao: RENOVACAO[s.renovacao] ? s.renovacao : "sem_contato",
    vencimento: s.data_vencimento_contrato || null,
    vendedorUid: s.vendedor_uid || null, vendedorNome: s.vendedor_nome || s.responsavel_comercial || "",
    atendimentoUid: s.atendimento_uid || null, atendimentoNome: s.atendimento_nome || "",
    espacoVinculado: s.espaco_vinculado_id && espacoPorId[s.espaco_vinculado_id] ? espacoPorId[s.espaco_vinculado_id].nome : null,
    edicao: s.espaco_vinculado_id && espacoPorId[s.espaco_vinculado_id] ? espacoPorId[s.espaco_vinculado_id].edicao || null : null,
    ultimoContato: ultimo[s.id] || null,
    confirmou: dataValida(s.renovacao_2027_em),
    forma: s.pagamento_2027 === "valor_2026" || s.pagamento_2027 === "valor_2027" ? s.pagamento_2027 : null,
    sinal: dataValida(s.sinal_pago_em),
    base: typeof s.base_2026 === "boolean" ? s.base_2026 : !!ocupou[chave(s.nome)],
    espacos2026: ocupou[chave(s.nome)] || [],
    contrato: (contratos27[s.id] || []).sort((a, b) => ordemC[a.status] - ordemC[b.status])[0] || null,
  }));
  patros.forEach((p) => { p.naFila = p.espacos2026.reduce((n, e) => n + (Array.isArray(e.fila) ? e.fila.filter((f) => f && f.marca_nome && !mesmaMarca(f.marca_nome, p.nome)).length : 0), 0); });
  // contrato 2027 assinado prova a renovacao, mesmo que ninguem tenha marcado a confirmacao
  const resposta = (p) => (p.confirmou || p.renovacao === "renovado" || (p.contrato && p.contrato.status === "assinado") ? "confirmou" : p.renovacao === "recusou" ? "recusou" : "aberta");
  const edicaoCurta = (e) => (e === "moto" ? "Moto" : e === "auto" ? "Auto" : "");

  patros.forEach((p) => {
    renovacao2027(p, cfg, lista, resposta(p));
    const base = { nome: p.nome, vendedorUid: p.vendedorUid, vendedorNome: p.vendedorNome, grupo: "outras" };
    if (p.renovacao === "recusou" && (p.base || p.status !== "encerrado")) {
      const esp = p.espacos2026.map((e) => (e.nome || "Espaço") + (e.edicao ? " (" + edicaoCurta(e.edicao) + ")" : ""));
      lista.push(Object.assign({}, base, { nivel: "azul", peso: 3, tipo: "recusou", titulo: p.nome + " recusou renovar",
        detalhe: esp.length ? "Pode oferecer a outra marca: " + esp.slice(0, 3).join(", ") + (esp.length > 3 ? " e mais " + (esp.length - 3) : "")
          : p.espacoVinculado ? "O espaço " + p.espacoVinculado + " pode ser oferecido a outra marca" : "Sem espaço vinculado" }));
    }
    if (p.status === "encerrado") return;
    let diasEvento = Math.min(diasAte(cfg.moto_data), diasAte(cfg.auto_data));
    if (p.edicao === "moto") diasEvento = diasAte(cfg.moto_data);
    if (p.edicao === "auto") diasEvento = diasAte(cfg.auto_data);
    const diasVenc = diasAte(p.vencimento);
    const diasContato = p.ultimoContato ? -diasAte(p.ultimoContato) : null;
    const ren = "Renovação: " + RENOVACAO[p.renovacao];
    const assinou = !!(p.contrato && p.contrato.status === "assinado");
    if (p.master && resposta(p) !== "confirmou" && !assinou && diasEvento !== null && diasEvento <= cfg.dias_gatilho_master) {
      lista.push(Object.assign({}, base, { grupo: "renovacao", tipo: "renovacao", nivel: "vermelho", peso: 0, titulo: p.nome + " é Master e ainda não renovou", detalhe: (diasEvento < 0 ? "A edição já passou" : "Faltam " + diasEvento + " dias para a edição") + " · " + ren }));
    }
    // vencimento do contrato: so para quem esta fora da renovacao 2027 (a base ja tem os prazos)
    if (!p.base && p.renovacao !== "recusou" && p.renovacao !== "renovado" && diasVenc !== null) {
      const bv = Object.assign({}, base, { tipo: "vencimento" });
      if (diasVenc < 0) lista.push(Object.assign({}, bv, { nivel: "vermelho", peso: 1, titulo: "Contrato de " + p.nome + " venceu " + textoDias(-diasVenc, false), detalhe: ren }));
      else if (diasVenc <= 30) lista.push(Object.assign({}, bv, { nivel: "vermelho", peso: 1, titulo: "Contrato de " + p.nome + " vence " + textoDias(diasVenc, true), detalhe: ren }));
      else if (diasVenc <= 90) lista.push(Object.assign({}, bv, { nivel: "amarelo", peso: 2, titulo: "Contrato de " + p.nome + " vence " + textoDias(diasVenc, true), detalhe: ren }));
    }
    if (p.renovacao === "sem_contato" || p.renovacao === "em_negociacao") {
      const bc = Object.assign({}, base, { tipo: "contato" });
      if (diasContato === null) lista.push(Object.assign({}, bc, { nivel: "amarelo", peso: 2, titulo: "Nenhum contato registrado com " + p.nome, detalhe: "Registre a primeira conversa para sair deste alerta" }));
      else if (diasContato > cfg.dias_sem_contato) lista.push(Object.assign({}, bc, { nivel: "amarelo", peso: 2, titulo: p.nome + " está sem contato " + textoDias(diasContato, false), detalhe: "Limite combinado: " + cfg.dias_sem_contato + " dias" }));
    }
  });

  // entregas: passou do prazo (vermelho) ou vence em 7 dias (amarelo), um alerta por marca
  const porPatro = {};
  d.combinados.forEach((c) => {
    const st = c.status === "prometido" ? "combinado" : c.status;
    const prazo = /^\d{4}-\d{2}-\d{2}$/.test(c.prazo || "") ? c.prazo : "";
    if (!c.patrocinador_id || st !== "combinado" || !prazo) return;
    const g = porPatro[c.patrocinador_id] || (porPatro[c.patrocinador_id] = { atrasadas: [], vencendo: [] });
    const item = { descricao: c.descricao || "Entrega", prazo: prazo };
    if (prazo < hoje) g.atrasadas.push(item); else if (prazo <= semana) g.vencendo.push(item);
  });
  patros.forEach((p) => {
    const g = porPatro[p.id];
    if (!g) return;
    const base = { nome: p.nome, vendedorUid: p.vendedorUid, vendedorNome: p.vendedorNome, grupo: "outras", tipo: "entregas" };
    const ordena = (a, b) => a.prazo.localeCompare(b.prazo);
    if (g.atrasadas.length) {
      const l = g.atrasadas.sort(ordena), n = l.length;
      lista.push(Object.assign({}, base, { nivel: "vermelho", peso: 1, titulo: n + (n > 1 ? " entregas da " : " entrega da ") + p.nome + (n > 1 ? " passaram do prazo" : " passou do prazo"),
        detalhe: l[0].descricao + " venceu " + textoDias(-diasAte(l[0].prazo), false) + (n > 1 ? " · e mais " + (n - 1) : "") }));
    }
    if (g.vencendo.length) {
      const l = g.vencendo.sort(ordena), n = l.length;
      lista.push(Object.assign({}, base, { nivel: "amarelo", peso: 2, titulo: n + (n > 1 ? " entregas da " : " entrega da ") + p.nome + (n > 1 ? " vencem" : " vence") + " nos próximos 7 dias",
        detalhe: l[0].descricao + " até " + dataCurta(l[0].prazo) + (n > 1 ? " · e mais " + (n - 1) : "") }));
    }
  });

  // Espaco Disponivel no cadastro fica guardado para a marca de 2026 ate ela responder. So vira
  // "livre" (e a fila e avisada) quando ela recusa ou alguem libera. Passou do prazo e da semana
  // de margem sem resposta: aviso para liberar (nada e liberado sozinho). Igual ao painel.
  const donoPorChave = {};
  patros.forEach((p) => { if (p.base) donoPorChave[chave(p.nome)] = p; });
  const situacaoEspaco = (e) => {
    if (e.status !== "disponivel") return null;
    if (dataValida(e.liberado_2027_em)) return { tipo: "livre" };
    const dono = donoPorChave[chave(e.ocupante_2026)];
    if (!dono) return { tipo: "livre" };
    const r = resposta(dono);
    if (r === "recusou") return { tipo: "livre" };
    if (r === "confirmou") {
      const assinou = !!(dono.contrato && dono.contrato.status === "assinado");
      if (!assinou && diasAte(cfg.prazo_assinatura) < -MARGEM_ESPACO) return { tipo: "vencido", dono: dono, motivo: "assinatura" };
      return { tipo: "renovou", dono: dono };
    }
    if (diasAte(cfg.prazo_confirmacao) < -MARGEM_ESPACO) return { tipo: "vencido", dono: dono, motivo: "confirmacao" };
    return { tipo: "guardado", dono: dono };
  };
  const vencidos = {};
  // espacos: reserva feita na mao vencida ou a 3 dias, e espaco livre com gente na fila
  d.espacos.forEach((e) => {
    const fila = (Array.isArray(e.fila) ? e.fila : []).filter((f) => f && f.marca_nome).sort((a, b) => {
      const ra = mesmaMarca(a.marca_nome, e.ocupante_2026) ? 0 : 1, rb = mesmaMarca(b.marca_nome, e.ocupante_2026) ? 0 : 1;
      return ra - rb || String(a.entrou_em || "").localeCompare(String(b.entrou_em || ""));
    });
    const onde = (e.nome || "Espaço") + (e.edicao ? " (" + edicaoCurta(e.edicao) + ")" : "");
    const base = { nome: e.nome || "", vendedorUid: e.vendedor_uid || null, vendedorNome: e.vendedor_nome || "", grupo: "outras" };
    const naMao = e.status === "reservado" && !e.reservado_para_id && /^\d{4}-\d{2}-\d{2}$/.test(e.reservado_ate || "");
    if (naMao) {
      const dr = diasAte(e.reservado_ate);
      const depois = fila[0] ? " · Na fila: " + fila[0].marca_nome + (fila.length > 1 ? " e mais " + (fila.length - 1) : "") : "";
      if (dr < 0) lista.push(Object.assign({}, base, { nivel: "vermelho", peso: 1, tipo: "reserva", titulo: "Reserva de " + onde + " venceu " + textoDias(-dr, false), detalhe: "Renove o prazo ou libere o espaço" + depois }));
      else if (dr <= 3) lista.push(Object.assign({}, base, { nivel: "amarelo", peso: 2, tipo: "reserva", titulo: "Reserva de " + onde + (dr === 0 ? " vence hoje" : " vence " + textoDias(dr, true)), detalhe: "Feche com a marca ou renove o prazo" + depois }));
    }
    const s27 = situacaoEspaco(e);
    if (s27 && s27.tipo === "vencido") (vencidos[s27.dono.id] = vencidos[s27.dono.id] || { dono: s27.dono, motivo: s27.motivo, espacos: [] }).espacos.push({ nome: String(e.nome || "Espaço").split(" · ")[0], fila: fila.length });
    if (e.status === "disponivel" && fila.length && s27 && s27.tipo === "livre") {
      lista.push(Object.assign({}, base, { nivel: "amarelo", peso: 2, tipo: "fila", vendedorUid: fila[0].por_uid || base.vendedorUid, vendedorNome: fila[0].por_nome || base.vendedorNome,
        titulo: onde + " está livre e tem " + fila.length + (fila.length > 1 ? " marcas" : " marca") + " na fila",
        detalhe: "A primeira é " + fila[0].marca_nome + (mesmaMarca(fila[0].marca_nome, e.ocupante_2026) ? ", que ocupou o espaço em 2026" : "") + ". Ofereça o espaço" }));
    }
  });

  Object.keys(vencidos).forEach((k) => {
    const g = vencidos[k], p = g.dono, nf = g.espacos.reduce((n, e) => n + e.fila, 0);
    const nomes = g.espacos.map((e) => e.nome).join(", ").replace(/, ([^,]*)$/, " e $1");
    lista.push({ nome: p.nome, grupo: "outras", tipo: "liberar", nivel: "vermelho", peso: 1,
      vendedorUid: p.atendimentoUid || p.vendedorUid, vendedorNome: p.atendimentoUid ? p.atendimentoNome : p.vendedorNome, papelResp: p.atendimentoUid ? "Atendimento" : "Vendedor",
      titulo: (g.espacos.length > 1 ? "Espaços de " + p.nome + " podem ser liberados: " : "Espaço de " + p.nome + " pode ser liberado: ") + nomes,
      detalhe: "Passou a semana de margem depois de " + ddmm(g.motivo === "assinatura" ? cfg.prazo_assinatura : cfg.prazo_confirmacao) + (g.motivo === "assinatura" ? " sem o contrato 2027 assinado" : " sem a confirmação") + ". " + (nf ? nf + (nf > 1 ? " marcas esperam" : " marca espera") + " na fila. Libere no painel" : "Ninguém na fila ainda. Libere no painel") });
  });
  const ordem = (a) => (a.grupo === "outras" ? 10 : 0) + a.peso; // renovacao primeiro
  return lista.sort((a, b) => ordem(a) - ordem(b) || String(a.nome).localeCompare(String(b.nome), "pt-BR"));
}

// Prazos do e-mail as marcas: confirmar (garante o espaco), sinal de 10% de quem paga com o
// valor de 2026, contrato 2027 assinado. Vermelho = passou; amarelo = chegando.
function renovacao2027(p, cfg, lista, resp) {
  if (!p.base || resp === "recusou") return;
  const base = { nome: p.nome, vendedorUid: p.vendedorUid, vendedorNome: p.vendedorNome, grupo: "renovacao", tipo: "renovacao" };
  const dConf = diasAte(cfg.prazo_confirmacao), dSinal = diasAte(cfg.prazo_sinal), dAss = diasAte(cfg.prazo_assinatura);
  if (resp !== "confirmou") {
    if (dConf !== null && dConf < 0) lista.push(Object.assign({}, base, { nivel: "vermelho", peso: 0,
      titulo: p.nome + " não confirmou a renovação até " + ddmm(cfg.prazo_confirmacao),
      detalhe: "O prazo passou " + textoDias(-dConf, false) + ". Se a marca já respondeu o e-mail, registre a confirmação. Se não vai renovar, marque que recusou" }));
    else if (dConf !== null && dConf <= JANELA_AVISO.confirmacao) lista.push(Object.assign({}, base, { nivel: "amarelo", peso: 1,
      titulo: "Confirmação da renovação de " + p.nome + (dConf === 0 ? " vence hoje" : " vence " + textoDias(dConf, true)),
      detalhe: "Prazo " + ddmm(cfg.prazo_confirmacao) + ". É a resposta ao e-mail que garante o espaço em 2027" + (p.naFila ? " · " + p.naFila + (p.naFila > 1 ? " marcas estão" : " marca está") + " na fila pelo espaço" : "") }));
    return;
  }
  const assinado = !!(p.contrato && p.contrato.status === "assinado");
  if (!assinado && dAss !== null) {
    const comoEsta = p.contrato ? "Contrato 2027: " + (STATUS_CONTRATO[p.contrato.status] || p.contrato.status) : "O contrato 2027 ainda nem foi enviado";
    if (dAss < 0) lista.push(Object.assign({}, base, { nivel: "vermelho", peso: 0, titulo: p.nome + " confirmou, mas não assinou o contrato 2027 até " + ddmm(cfg.prazo_assinatura), detalhe: comoEsta }));
    else if (dAss <= JANELA_AVISO.assinatura) lista.push(Object.assign({}, base, { nivel: "amarelo", peso: 1, titulo: "Assinatura do contrato 2027 de " + p.nome + (dAss === 0 ? " vence hoje" : " vence " + textoDias(dAss, true)), detalhe: comoEsta }));
    const desde = p.confirmou ? -diasAte(p.confirmou) : null;
    if ((!p.contrato || p.contrato.status === "rascunho") && desde !== null && desde > DIAS_ESPERA_CONTRATO) lista.push(Object.assign({}, base, { grupo: "outras", tipo: "contrato", nivel: "amarelo", peso: 2,
      titulo: "Contrato 2027 de " + p.nome + " ainda não foi enviado", detalhe: "Confirmou em " + ddmm(p.confirmou) + ", " + textoDias(desde, false) + ". Suba o contrato e mande assinar" }));
  }
  // sinal e forma de pagamento vao para o atendimento da marca, quando tem um
  const comAtend = Object.assign({}, base, p.atendimentoUid ? { vendedorUid: p.atendimentoUid, vendedorNome: p.atendimentoNome, papelResp: "Atendimento" } : {});
  if (dSinal === null) return;
  if (p.forma === "valor_2026" && !p.sinal) {
    if (dSinal < 0) lista.push(Object.assign({}, comAtend, { grupo: "outras", tipo: "sinal-vencido", nivel: "amarelo", peso: 2,
      titulo: p.nome + " não pagou o sinal de 10% até " + ddmm(cfg.prazo_sinal), detalhe: "Pelas regras da renovação, passa para o Valor 2027, com reajuste de 12%" }));
    else if (dSinal <= JANELA_AVISO.sinal) lista.push(Object.assign({}, comAtend, { nivel: "amarelo", peso: 1, tipo: "sinal",
      titulo: "Sinal de 10% de " + p.nome + (dSinal === 0 ? " vence hoje" : " vence " + textoDias(dSinal, true)), detalhe: "Prazo " + ddmm(cfg.prazo_sinal) + ". Marque na ficha quando o pagamento cair" }));
  } else if (!p.forma && dSinal <= JANELA_AVISO.sinal) {
    lista.push(Object.assign({}, comAtend, { grupo: "outras", tipo: "forma", nivel: "amarelo", peso: 2, titulo: "Falta registrar como " + p.nome + " vai pagar",
      detalhe: dSinal < 0 ? "Sem sinal até " + ddmm(cfg.prazo_sinal) + ", pelas regras fica no Valor 2027 (+12%)" : "Valor 2026 (sinal de 10% até " + ddmm(cfg.prazo_sinal) + ") ou Valor 2027 (+12%)" }));
  }
}

// quanto da base de 2026 ja confirmou a renovacao 2027 (o mesmo numero do Inicio)
function progressoBase(d) {
  const ocupou = {};
  d.espacos.forEach((e) => { const k = chave(e.ocupante_2026); if (k) ocupou[k] = true; });
  const base = d.patrocinadores.filter((s) => (typeof s.base_2026 === "boolean" ? s.base_2026 : !!ocupou[chave(s.nome)]));
  const assinou = {};
  d.contratos.forEach((c) => { if (c.status === "assinado" && eContrato2027(c)) assinou[c.patrocinador_id] = true; });
  const conf = base.filter((s) => dataValida(s.renovacao_2027_em) || s.renovacao === "renovado" || assinou[s.id]).length;
  return { total: base.length, confirmaram: conf, pct: base.length ? Math.round(100 * conf / base.length) : 0 };
}

// marcas desejo em andamento paradas alem do limite ou com a proxima acao vencida
function marcasParadas(d) {
  const ultimo = {};
  d.interacoes.forEach((i) => { if (i.prospeccao_id && (!ultimo[i.prospeccao_id] || i.data > ultimo[i.prospeccao_id])) ultimo[i.prospeccao_id] = i.data; });
  const hoje = hojeMais(0);
  const lista = [];
  d.prospeccao.forEach((m) => {
    if (ANDAMENTO.indexOf(m.estagio || "mapeada") < 0) return;
    const desde = ultimo[m.id] || m.created_at || null;
    const parado = desde ? Math.max(0, -diasAte(desde)) : null;
    const esfriando = parado !== null && parado > d.cfg.dias_sem_contato;
    const atrasada = !!m.proxima_acao_data && m.proxima_acao_data < hoje;
    if (!esfriando && !atrasada) return;
    const motivos = [];
    if (atrasada) motivos.push("próxima ação venceu " + textoDias(-diasAte(m.proxima_acao_data), false) + (m.proxima_acao ? ": " + m.proxima_acao : ""));
    if (esfriando) motivos.push("sem contato " + textoDias(parado, false));
    lista.push({ nome: m.nome || "Marca", vendedorUid: m.vendedor_uid || null, vendedorNome: m.vendedor_nome || "", nivel: atrasada ? "vermelho" : "amarelo", titulo: m.nome || "Marca", detalhe: motivos.join(" · ") });
  });
  return lista.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
}

// segunda olha desde sexta; nos outros dias, desde ontem
function janelaAssinados() {
  const hoje = hojeMais(0);
  const segunda = new Date(hoje + "T12:00:00Z").getUTCDay() === 1;
  return { desde: hojeMais(segunda ? -3 : -1), ate: hoje };
}
function contratosAssinados(d, janela) {
  const nomes = {};
  d.patrocinadores.forEach((p) => { nomes[p.id] = p.nome; });
  return d.contratos.filter((c) => c.status === "assinado" && c.assinado_em && c.assinado_em >= janela.desde && c.assinado_em < janela.ate)
    .map((c) => ({ marca: nomes[c.patrocinador_id] || "Patrocinador", titulo: c.titulo || "Contrato", valor: c.valor == null ? null : Number(c.valor), em: c.assinado_em }))
    .sort((a, b) => a.em.localeCompare(b.em));
}
function contratosEsperando(d) {
  const nomes = {};
  d.patrocinadores.forEach((p) => { nomes[p.id] = p.nome; });
  return d.contratos.filter((c) => c.status === "enviado").map((c) => ({ marca: nomes[c.patrocinador_id] || "Patrocinador", titulo: c.titulo || "Contrato", desde: c.assinatura && c.assinatura.enviado_em ? String(c.assinatura.enviado_em).slice(0, 10) : null }));
}

// ------------------------------------------------------------------ e-mail
function cartao(a, comVendedor) {
  return '<tr><td style="padding:0 0 10px 0"><div style="border-left:4px solid ' + COR[a.nivel] + ";background:#ffffff;border:1px solid #e6e6e6;border-left-width:4px;border-left-color:" + COR[a.nivel] + ';padding:10px 14px">' +
    '<div style="font-weight:700;color:#111;font-size:15px">' + esc(a.titulo) + "</div>" +
    '<div style="color:#555;font-size:13px;margin-top:3px">' + esc(a.detalhe) + (comVendedor ? " · " + (a.papelResp || "Vendedor") + ": " + esc(a.vendedorNome || "sem responsável") : "") + "</div></div></td></tr>";
}
function secao(titulo, itens) {
  return '<tr><td style="padding:18px 0 8px 0;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#111">' + titulo + "</td></tr>" + itens;
}
function montarEmail(pessoa, alertas, marcas, assinados, esperando, ehAdmin, dia, progresso) {
  // os contadores contam MARCAS, como no Inicio: uma marca com dois alertas vermelhos conta uma vez
  const vermA = alertas.filter((a) => a.grupo === "renovacao" && a.nivel === "vermelho");
  const amarA = alertas.filter((a) => a.grupo === "renovacao" && a.nivel !== "vermelho");
  const outras = alertas.filter((a) => a.grupo !== "renovacao");
  const nomesV = new Set(vermA.map((a) => a.nome));
  const nV = nomesV.size, nA = new Set(amarA.filter((a) => !nomesV.has(a.nome)).map((a) => a.nome)).size;
  const nO = outras.length + marcas.length;
  const vazio = !alertas.length && !marcas.length;
  const partesAssunto = [];
  if (nV) partesAssunto.push(nV + (nV > 1 ? " não renovaram nem assinaram" : " não renovou nem assinou"));
  if (nA) partesAssunto.push(nA + " com prazo perto de vencer");
  if (nO) partesAssunto.push(nO + (nO > 1 ? " outras pendências" : " outra pendência"));
  if (assinados.length) partesAssunto.push(assinados.length + (assinados.length > 1 ? " assinados" : " assinado"));
  const quando = diaDaSemana(dia) + ", " + dataCurta(dia).slice(0, 5);
  const assunto = "Painel Comercial · " + (partesAssunto.length ? partesAssunto.join(", ") : "nada pendente") + " · " + quando;

  const primeiro = String(pessoa.nome || "").trim().split(/\s+/)[0] || "";
  const intro = ehAdmin
    ? "Resumo da equipe inteira. Comece pelas marcas que não renovaram nem assinaram."
    : (vazio ? "Nada pendente com as suas marcas hoje." : "O que precisa de você hoje, das marcas que você cuida.");
  let corpo = "";
  if (ehAdmin && progresso && progresso.total) {
    corpo += '<tr><td style="padding:16px 0 4px 0;font-size:14px;color:#111"><b>Renovação 2027:</b> ' + progresso.confirmaram + " de " + progresso.total + " marcas da base de 2026 confirmaram (" + progresso.pct + "%). Meta: 100%.</td></tr>";
  }
  if (vermA.length) corpo += secao("Não renovaram nem assinaram (" + nV + ")", vermA.map((a) => cartao(a, ehAdmin)).join(""));
  if (amarA.length) corpo += secao("Prazo perto de vencer (" + new Set(amarA.map((a) => a.nome)).size + ")", amarA.map((a) => cartao(a, ehAdmin)).join(""));
  if (outras.length) corpo += secao("Outras pendências (" + outras.length + ")", outras.map((a) => cartao(a, ehAdmin)).join(""));
  if (marcas.length) corpo += secao("Marcas desejo paradas (" + marcas.length + ")", marcas.map((a) => cartao(a, ehAdmin)).join(""));
  if (assinados.length) {
    corpo += secao("Assinados desde o último resumo (" + assinados.length + ")", assinados.map((c) =>
      '<tr><td style="padding:0 0 8px 0;font-size:14px;color:#111"><b>' + esc(c.marca) + "</b> · " + esc(c.titulo) + (c.valor ? " · " + esc(reais(c.valor)) : "") + ' <span style="color:#777">(' + esc(dataCurta(c.em)) + ")</span></td></tr>").join(""));
  }
  if (ehAdmin && esperando.length) {
    corpo += secao("Esperando assinatura (" + esperando.length + ")", esperando.map((c) =>
      '<tr><td style="padding:0 0 8px 0;font-size:14px;color:#111"><b>' + esc(c.marca) + "</b> · " + esc(c.titulo) + (c.desde ? ' <span style="color:#777">(enviado em ' + esc(dataCurta(c.desde)) + ")</span>" : "") + "</td></tr>").join(""));
  }
  if (!corpo) corpo = '<tr><td style="padding:18px 0;font-size:14px;color:#333">Nenhum alerta, nenhuma marca parada. Bom dia de trabalho.</td></tr>';

  const html = '<!doctype html><html><body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +
    '<tr><td style="background:#000;padding:18px 22px"><div style="color:#B0F867;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Painel Comercial · Festival Interlagos</div>' +
    '<div style="color:#fff;font-size:22px;font-weight:700;margin-top:6px">Bom dia' + (primeiro ? ", " + esc(primeiro) : "") + "</div>" +
    '<div style="color:#bbb;font-size:13px;margin-top:4px">' + esc(quando.charAt(0).toUpperCase() + quando.slice(1)) + " · " + esc(intro) + "</div></td></tr>" +
    '<tr><td style="background:#f7f7f7;padding:6px 22px 18px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + corpo + "</table>" +
    '<div style="padding-top:14px"><a href="' + URL_PAINEL + '" style="display:inline-block;background:#B0F867;color:#000;font-weight:700;text-decoration:none;padding:11px 18px;font-size:14px">Abrir o painel</a></div></td></tr>' +
    '<tr><td style="padding:14px 22px;color:#888;font-size:11px">Enviado de segunda a sexta às 8h pelo Painel Comercial. ' + (ehAdmin ? "Você recebe o resumo da equipe porque é administrador." : "Você recebe só o que é das marcas que você cuida.") + "</td></tr>" +
    "</table></td></tr></table></body></html>";

  const linhas = [assunto, ""];
  const txt = (titulo, l) => { if (l.length) { linhas.push(titulo); l.forEach((a) => linhas.push("- " + a.titulo + " (" + a.detalhe + (ehAdmin ? " · " + (a.papelResp || "Vendedor") + ": " + (a.vendedorNome || "sem responsável") : "") + ")")); linhas.push(""); } };
  if (ehAdmin && progresso && progresso.total) { linhas.push("Renovação 2027: " + progresso.confirmaram + " de " + progresso.total + " marcas da base de 2026 confirmaram (" + progresso.pct + "%)."); linhas.push(""); }
  txt("Não renovaram nem assinaram:", vermA); txt("Prazo perto de vencer:", amarA); txt("Outras pendências:", outras); txt("Marcas desejo paradas:", marcas);
  if (assinados.length) { linhas.push("Assinados desde o último resumo:"); assinados.forEach((c) => linhas.push("- " + c.marca + " · " + c.titulo)); linhas.push(""); }
  linhas.push("Abrir o painel: " + URL_PAINEL);
  return { assunto: assunto, html: html, texto: linhas.join("\n"), vazio: vazio };
}

// ------------------------------------------------------------------ envio
function lerGmail(texto) {
  const t = String(texto || "");
  const email = (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0] || "";
  // senha de app do Google: 16 letras, as vezes em blocos de 4 com espaco
  const semEmail = t.replace(email, " ");
  const senha = ((semEmail.match(/\b[a-z]{4}\s?[a-z]{4}\s?[a-z]{4}\s?[a-z]{4}\b/i) || [])[0] || "").replace(/\s+/g, "");
  return email && senha.length === 16 ? { email: email, senha: senha } : null;
}

function destinatarios(d) {
  return d.profiles.filter((p) => /@/.test(p.email || "")).map((p) => ({ uid: p.id, nome: p.nome || "", email: String(p.email).trim(), admin: p.papel === "admin" || p.papel === "dono" }));
}

async function montarTudo() {
  const d = await lerTudo();
  const dia = hojeMais(0);
  const alertas = montarAlertas(d);
  const marcas = marcasParadas(d);
  const assinados = contratosAssinados(d, janelaAssinados());
  const esperando = contratosEsperando(d);
  const progresso = progressoBase(d);
  const emails = [];
  destinatarios(d).forEach((p) => {
    const meus = p.admin ? alertas : alertas.filter((a) => a.vendedorUid === p.uid);
    const minhas = p.admin ? marcas : marcas.filter((m) => m.vendedorUid === p.uid);
    const e = montarEmail(p, meus, minhas, assinados, esperando, p.admin, dia, progresso);
    // vendedor sem nada dele para fazer nao recebe e-mail so com a novidade dos outros
    if (!p.admin && e.vazio) return;
    emails.push(Object.assign({ para: p.email, nome: p.nome, admin: p.admin }, e));
  });
  const conta = (g, n) => alertas.filter((a) => a.grupo === g && (!n || a.nivel === n)).length;
  return { dia: dia, emails: emails, alertas: alertas.length, marcas: marcas.length, assinados: assinados.length, progresso: progresso,
    resumoAlertas: conta("renovacao", "vermelho") + " não renovaram/assinaram, " + (conta("renovacao") - conta("renovacao", "vermelho")) + " prazo perto, " + conta("outras") + " outras pendências" };
}

functions.http("resumoDiario", async (req, res) => {
  try {
    const ensaio = String((req.query && req.query.ensaio) || "") === "1";
    const r = await montarTudo();
    let envio = r.emails;
    const soPara = String(process.env.SO_PARA || "").trim().toLowerCase();
    if (soPara) {
      const meu = envio.filter((e) => e.para.toLowerCase() === soPara);
      // em teste: se a pessoa nao tem perfil com esse e-mail, recebe a versao de administrador
      envio = meu.length ? meu : envio.filter((e) => e.admin).slice(0, 1).map((e) => Object.assign({}, e, { para: soPara }));
    }
    const resumo = envio.map((e) => e.para + " → " + e.assunto);
    console.log("resumo " + r.dia + ": " + r.resumoAlertas + ", " + r.marcas + " marcas paradas, " + r.assinados + " assinados, base " + r.progresso.confirmaram + "/" + r.progresso.total + "; " + (ensaio ? "ensaio, " : "") + envio.length + " e-mail(s)" + (soPara ? " (só para " + soPara + ")" : "") + ": " + resumo.join(" | "));
    if (ensaio) return res.json({ dia: r.dia, envio: resumo });
    const cred = lerGmail(process.env.GMAIL);
    if (!cred) { console.log("sem a conta de envio no segredo GMAIL: nada foi enviado"); return res.status(200).send("sem conta de envio"); }
    const correio = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: cred.email, pass: cred.senha } });
    let ok = 0;
    for (const e of envio) {
      try {
        await correio.sendMail({ from: '"Painel Comercial FI" <' + cred.email + ">", to: e.para, subject: e.assunto, html: e.html, text: e.texto });
        ok++;
      } catch (err) { console.error("falhou para " + e.para + ": " + (err && err.message)); }
    }
    console.log("enviados " + ok + " de " + envio.length);
    res.status(200).send("enviados " + ok + " de " + envio.length);
  } catch (e) {
    console.error("resumo: " + (e && e.stack || e));
    res.status(500).send("erro");
  }
});

module.exports = { montarAlertas, marcasParadas, contratosAssinados, janelaAssinados, montarEmail, lerGmail, destinatarios, hojeMais, progressoBase };
