/*
 * Catálogo dos espaços comercializáveis do Festival Interlagos, por edição.
 *
 * Fonte: plantas de 2026 (implantação A1 de Motos e Autos de 06/07/2026,
 * planta do Paddock Moto 2026 e mapas do Box/Boulevard das duas edições).
 * Os nomes em "ocupante" são as marcas que ocuparam cada espaço em 2026 e
 * servem de base de renovação. Onde a planta não deixou ler, ficou vazio.
 *
 * A chave de cada espaço no banco é "edicao:zona:codigo" (campo `mapa`).
 * Este arquivo é lido pela página (desenho do mapa) e pela carga inicial do
 * banco, para as duas coisas nunca discordarem.
 */

export const EDICOES = [
  { id: "moto", rotulo: "Edição Moto", curto: "Moto" },
  { id: "auto", rotulo: "Edição Auto", curto: "Auto" },
];

// tipo -> tamanho do desenho (px do viewBox) e rótulo de categoria
export const TIPOS = {
  box:     { w: 42,  h: 72, categoria: "Box · Pit Lane" },
  blv:     { w: 52,  h: 58, categoria: "Boulevard" },
  pad:     { w: 56,  h: 58, categoria: "Paddock · 2º piso" },
  padg:    { w: 150, h: 58, categoria: "Paddock · 2º piso" },
  grande:  { w: 112, h: 80, categoria: "Arena · área de marca" },
  t225:    { w: 88,  h: 66, categoria: "Arena · tenda 225 m²" },
  t100:    { w: 66,  h: 54, categoria: "Arena · tenda 100 m²" },
  ponto:   { w: 100, h: 54, categoria: "Arena · ponto de ativação" },
  sub:     { w: 88,  h: 54, categoria: "Área temática · tenda" },
  esp:     { w: 136, h: 64, categoria: "Área especial" },
};

export const ZONAS = [
  { id: "box",        titulo: "Boxes · Pit Lane",        nota: "Numeração do 23 ao 00, no sentido da pista" },
  { id: "boulevard",  titulo: "Boulevard",               nota: "Stands em frente aos boxes" },
  { id: "paddock",    titulo: "Paddock · 2º piso",       nota: "Edifício do paddock, planta com 38 stands" },
  { id: "arena",      titulo: "Arena",                   nota: "Áreas de marca, tendas de 225 m² e 100 m²" },
  { id: "mobilidade", titulo: "Mobilidade Urbana",       nota: "Área temática de 2.400 m²" },
  { id: "village",    titulo: "Race Village",            nota: "Área temática de 2.672 m²" },
  { id: "especial",   titulo: "Áreas especiais",         nota: "Grandes áreas e ativações" },
];

function seq(tipo, de, ate, ocupantes, m2) {
  // gera codigos numericos de `de` a `ate` (decrescente se de > ate), com 2 digitos
  var itens = [];
  var passo = de > ate ? -1 : 1;
  for (var n = de; passo > 0 ? n <= ate : n >= ate; n += passo) {
    var cod = (n < 10 ? "0" : "") + n;
    var oc = ocupantes && ocupantes[cod] !== undefined ? ocupantes[cod] : (ocupantes && ocupantes["*"]) || "";
    var area = typeof m2 === "function" ? m2(cod) : (m2 && typeof m2 === "object" ? (m2[cod] !== undefined ? m2[cod] : null) : (m2 || null));
    itens.push({ codigo: cod, tipo: tipo, ocupante: oc, m2: area });
  }
  return itens;
}

function it(codigo, tipo, rotulo, ocupante, m2) {
  return { codigo: codigo, tipo: tipo, rotulo: rotulo || null, ocupante: ocupante || "", m2: m2 || null };
}

// ----------------------------------------------------------------- MOTO 2026
var boxesMoto = seq("box", 23, 0, {
  "23": "CFMOTO", "22": "CFMOTO", "21": "Haojue", "20": "Shineray", "19": "Suzuki", "18": "Dafra",
  "17": "Triumph", "16": "Triumph", "15": "Kawasaki", "14": "Kawasaki", "13": "Yamaha", "12": "Yamaha",
  "11": "Bajaj", "10": "Harley-Davidson", "09": "Honda", "08": "Honda", "07": "Honda",
  "06": "Ducati", "05": "Ducati", "04": "Royal Enfield", "03": "Royal Enfield",
  "02": "BMW Motorrad", "01": "BMW Motorrad", "00": "2W Motors",
}).concat([
  it("SPORT", "box", "Sport", "Sport Festival"),
  it("ATIV", "box", "Ativação", ""),
]);

var boulevardMoto = [
  it("00A", "blv", null, ""), it("00B", "blv", null, "AIMA"), it("00C", "blv", null, "FUN Motors"),
].concat(seq("blv", 1, 15, {
  "01": "", "02": "", "03": "Nacar", "04": "Mitas", "05": "Kawasaki", "06": "Yamaha",
  "07": "X11", "08": "Repsol", "09": "Honda", "10": "Bieffe", "11": "HLX", "12": "LS2", "13": "LS2", "14": "", "15": "",
}));

var padM2 = { "01": 100, "02": 100, "03": 100, "04": 100, "05": 100, "06": 100, "07": 50, "08": 50, "09": 100, "10": 100,
  "11": 100, "12": 100, "13": 100, "14": 100, "23": 50, "24": 50, "25": 100, "26": 100, "27": 100, "28": 100,
  "29": 100, "30": 100, "31": 100, "32": 100, "33": 50, "34": 50, "35": 100, "36": 100, "37": 70, "38": 70 };
var paddockMoto = seq("pad", 1, 38, {
  "01": "GIVI", "02": "GIVI", "03": "Nacar", "04": "Nacar", "05": "Bráz Acessórios", "06": "Bráz Acessórios",
  "07": "Sportsco", "08": "FW Performance", "09": "Sacramento", "10": "Sacramento", "11": "Winner", "12": "Winner",
  "13": "DID", "14": "DID", "15": "Tudo para Moto", "16": "Tudo para Moto", "17": "Tudo para Moto", "18": "Tudo para Moto",
  "19": "Pro Tork", "20": "Pro Tork", "21": "Pro Tork", "22": "Pro Tork", "23": "California Racing", "24": "KMC (Sudamerica)",
  "25": "Galpão", "26": "Galpão", "27": "Consórcio Honda", "28": "Consórcio Honda", "29": "Spencer", "30": "Spencer",
  "31": "T Mac", "32": "T Mac", "33": "Stallion", "34": "Autozone", "35": "EBF Capacetes", "36": "EBF Capacetes",
  "37": "Suhai", "38": "Suhai",
}, padM2).concat([
  it("PRACA", "padg", "Praça de Alimentação", "", 549.3),
  it("KIDS", "padg", "Espaço Kids", "Super Kids", 549.3),
]);

var arenaMoto = [
  it("G01", "grande", "Área 01", "Voge", 500),
  it("G02", "grande", "Área 02", "Yamaha", 500),
  it("G03", "grande", "Área 03", "Honda", 600),
  it("TV", "grande", "TV", "TV Globo", 225),
].concat(seq("t225", 4, 12, {
  "04": "Motul", "05": "Santander", "06": "Taurus", "07": "Triumph", "08": "Yadea", "09": "Mobil",
  "10": "Ipiranga Lubrificantes", "11": "Petronas Sprinta", "12": "Lubrax",
}, 225), [
  it("32", "t225", null, "Mbrisa", 225),
  it("34", "t225", null, "Honda Consórcio", 225),
  it("35", "t225", null, "Yamalube", 225),
], seq("t100", 23, 27, {
  "23": "Peels", "24": "Vipal", "25": "Technic", "26": "Auto Equip", "27": "MXF",
}, 100), [
  it("MM", "t100", "Mobil Michelin", "Mobil / Michelin", null),
  it("HAB", "ponto", "Pista de Habilidades", "", 200),
  it("LUCK", "ponto", "Luck Friends", "Luck Friends", 100),
  it("REDBULL", "ponto", "Ponto Red Bull", "Red Bull", null),
  it("ALIM", "ponto", "Alimentação", "", 800),
]);

var mobilidadeMoto = [
  it("MU", "esp", "Mobilidade Urbana", "", 2400),
  it("MU-YADEA", "sub", "Tenda 1", "Yadea", 100),
  it("MU-AIMA", "sub", "Tenda 2", "AIMA", 100),
  it("MU-YAMAHA", "sub", "Tenda 3", "Yamaha", 100),
  it("MU-HONDA", "sub", "Tenda 4", "Honda", 100),
];

var especialMoto = [
  it("SUPERCROSS", "esp", "Box Supercross", "", 8090),
  it("FORCA", "esp", "Força & Ação", "Força & Ação", 1100),
  it("FRED", "esp", "Fred Kyrillos", "Fred Kyrillos", 1050),
  it("CIRCUS", "esp", "Motorcycle Builder Circus", "", null),
  it("RODA", "esp", "Roda Gigante", "", null),
  it("LAJAO", "esp", "Lajão", "", null),
  it("HCVIP", "esp", "HC VIP Patrocinadores", "", null),
];

// ----------------------------------------------------------------- AUTO 2026
var boxesAuto = seq("box", 23, 0, {
  "23": "Mitsubishi", "22": "Mitsubishi", "21": "Volvo", "20": "Volvo", "19": "Honda", "18": "Honda",
  "17": "Peugeot", "16": "RAM", "15": "Jeep", "14": "Abarth", "13": "Leapmotor",
  "12": "Ford", "11": "Ford", "10": "Toyota", "09": "Toyota", "08": "BMW", "07": "BMW",
  "06": "BYD", "05": "BYD", "04": "GWM", "03": "GWM", "02": "Omoda Jaecoo", "01": "Omoda Jaecoo", "00": "BAIC",
}).concat([
  it("SPORT", "box", "Sport", "Sport Festival"),
  it("ATIV", "box", "Ativação", ""),
]);

var boulevardAuto = [
  it("00A", "blv", null, "Fullpower"), it("00B", "blv", null, ""), it("00C", "blv", null, "Volvo"),
].concat(seq("blv", 1, 15, {
  "01": "", "02": "Honda", "03": "Nacar", "04": "Stellantis", "05": "Stellantis", "06": "Ford",
  "07": "Toyota", "08": "Repsol", "09": "BMW", "10": "", "11": "BYD", "12": "GWM", "13": "Omoda Jaecoo", "14": "", "15": "",
}));

var paddockAuto = seq("pad", 1, 38, {
  "01": "Cambea", "02": "Cambea", "09": "JDM", "10": "JDM", "11": "DS", "12": "DS", "15": "Raw", "16": "Raw",
  "17": "Sempa", "18": "Sempa", "19": "SignHouse", "20": "SignHouse", "25": "Quad Film", "26": "Quad Film",
  "27": "Fiat 50", "28": "Fiat 50", "29": "Santander Kids", "30": "Santander Kids", "31": "Santander Kids", "32": "Santander Kids",
  "35": "Motocraft", "36": "Motocraft", "37": "Suhai", "38": "Suhai",
}, padM2).concat([
  it("DONGFENG", "padg", "Área 549 m²", "Dongfeng", 549.3),
]);

var arenaAuto = [
  it("G01", "grande", "Área 01", "Honda", 600),
  it("G02", "grande", "Área 02", "GAC International", 500),
  it("G03", "grande", "Área 03", "GWM", 500),
  it("G04", "grande", "Área 04", "Jetour", 500),
  it("TV", "grande", "TV", "TV Globo", 225),
].concat(seq("t225", 4, 14, {
  "04": "Motul", "05": "Santander", "06": "MG", "07": "Renault", "08": "Caoa Chery", "09": "Mobil",
  "10": "Ipiranga Lubrificantes", "11": "Petronas Sprinta", "12": "Lubrax", "13": "Ford", "14": "BYD",
}, 225), [
  it("32", "t225", null, "Geely", 225),
  it("34", "t225", null, "Honda Consórcio", 225),
  it("35", "t225", null, "Dongfeng", 225),
  it("36", "t225", null, "Ezvolt", 225),
  it("44", "t225", null, "Mitsubishi Motors", 225),
  it("45", "t225", null, "Jeep / RAM", 450),
], seq("t100", 23, 27, { "23": "Emaster" }, 100), [
  it("PROHONDA", "t100", "Pro Honda", "Pro Honda", null),
  it("OMODA", "ponto", "Omoda Jaecoo", "Omoda Jaecoo", 225),
  it("LUCK", "ponto", "Luck Friends", "Luck Friends", 100),
  it("REDBULL", "ponto", "Ponto Red Bull", "Red Bull", null),
  it("ALIM", "ponto", "Alimentação", "", 800),
]);

var villageAuto = [
  it("RV", "esp", "Race Village", "", 2672),
  it("RV-DENZA", "sub", "Tenda 1", "Denza", 128),
  it("RV-MINI", "sub", "Tenda 2", "Mini", 128),
  it("RV-ASTON", "sub", "Tenda 3", "Aston Martin / McLaren", 128),
  it("RV-CADILLAC", "sub", "Tenda 4", "Cadillac", 128),
];

var especialAuto = [
  it("OFFROAD", "esp", "Pista Off-Road", "", null),
  it("DRIFT", "esp", "Área de Drift", "", 3320),
  it("GARAGEM", "esp", "Garagem", "", null),
  it("DONGFENG", "esp", "Área Dongfeng", "Dongfeng", 1780),
  it("DENZA", "esp", "Área Denza", "Denza", 750),
  it("RODA", "esp", "Roda Gigante", "", null),
  it("LAJAO", "esp", "Lajão", "", null),
];

export const MAPA = {
  moto: { box: boxesMoto, boulevard: boulevardMoto, paddock: paddockMoto, arena: arenaMoto, mobilidade: mobilidadeMoto, especial: especialMoto },
  auto: { box: boxesAuto, boulevard: boulevardAuto, paddock: paddockAuto, arena: arenaAuto, village: villageAuto, especial: especialAuto },
};

// Nome completo de um espaço, como vai para o banco e para a lista.
export function nomeEspaco(edicao, zonaId, item) {
  var zona = ZONAS.find(function (z) { return z.id === zonaId; });
  var base = item.rotulo || (
    zonaId === "box" ? "Box " + item.codigo :
    zonaId === "boulevard" ? "Boulevard " + item.codigo :
    zonaId === "paddock" ? "Stand " + item.codigo :
    "Tenda " + item.codigo);
  return base + " · " + (zona ? zona.titulo.split(" · ")[0] : zonaId);
}

export function chaveMapa(edicao, zonaId, codigo) {
  return edicao + ":" + zonaId + ":" + codigo;
}

// Lista plana de todos os espaços das duas edições, no formato dos documentos.
export function todosEspacos() {
  var lista = [];
  EDICOES.forEach(function (ed) {
    ZONAS.forEach(function (zona) {
      var itens = (MAPA[ed.id] || {})[zona.id] || [];
      itens.forEach(function (item) {
        lista.push({
          mapa: chaveMapa(ed.id, zona.id, item.codigo),
          edicao: ed.id,
          zona: zona.id,
          codigo: item.codigo,
          tipo: item.tipo,
          nome: nomeEspaco(ed.id, zona.id, item),
          categoria: TIPOS[item.tipo].categoria,
          metragem: item.m2,
          ocupante_2026: item.ocupante || "",
          valor: 0,
          status: "disponivel",
        });
      });
    });
  });
  return lista;
}
