// API do Amigo Secreto (uma única função na Vercel, roteada pelo vercel.json)
import crypto from 'node:crypto';
import { store, hasDb } from './_store.js';

const LIM = { nome: 40, grupo: 60, valor: 30, item: 80, link: 500, obs: 160, itens: 30 };
const MIN_PESSOAS = 3;

class HttpErr extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new HttpErr(code, msg); };

const K = {
  grupo: id => `g:${id}`,
  pessoas: id => `g:${id}:p`,
  token: t => `t:${t}`,
  trava: id => `g:${id}:trava`,
  tentativas: (id, pid) => `rl:${id}:${pid}`,
  criacao: ip => `rlc:${ip}`,
};

const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const limpar = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const parse = v => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const novoToken = () => crypto.randomBytes(24).toString('base64url');
function novoId(n = 8) {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  while (s.length < n) { const b = crypto.randomBytes(1)[0]; if (b < 248) s += a[b % a.length]; }
  return s;
}
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
function checarPin(pin) {
  pin = String(pin ?? '').trim();
  if (!/^\d{4}$/.test(pin)) fail(400, 'O PIN precisa ter 4 números.');
  return pin;
}
function pinConfere(p, pin) {
  const a = Buffer.from(hashPin(pin, p.salt), 'hex'), b = Buffer.from(p.pinHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function limparLink(u) {
  u = String(u || '').trim().slice(0, LIM.link);
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) && x.hostname.includes('.') ? x.href : '';
  } catch { return ''; }
}
function limparItens(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, LIM.itens)
    .map(i => ({ nome: limpar(i?.nome, LIM.item), link: limparLink(i?.link), obs: limpar(i?.obs, LIM.obs) }))
    .filter(i => i.nome);
}
function limparData(d) { d = String(d || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''; }
function nomeValido(nome) {
  nome = limpar(nome, LIM.nome);
  if (nome.length < 2) fail(400, 'Digite um nome com pelo menos 2 letras.');
  return nome;
}

// Permutação aleatória sem ninguém tirando a si mesmo.
// Sendo permutação, cada pessoa tira exatamente uma e ninguém é tirado duas vezes.
function randInt(n) {
  const lim = Math.floor(0x100000000 / n) * n;
  let x; do x = crypto.randomBytes(4).readUInt32BE(0); while (x >= lim);
  return x % n;
}
function sortear(ids) {
  const n = ids.length;
  for (;;) {
    const p = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = randInt(i + 1); [p[i], p[j]] = [p[j], p[i]]; }
    if (p.every((v, i) => v !== i)) return Object.fromEntries(ids.map((id, i) => [id, ids[p[i]]]));
  }
}
function paresValidos(ids, pares) {
  const tirados = new Set();
  for (const id of ids) {
    const r = pares[id];
    if (!r || r === id || !ids.includes(r) || tirados.has(r)) return false;
    tirados.add(r);
  }
  return tirados.size === ids.length;
}

/* ---------- acesso a dados ---------- */
async function lerGrupo(id) {
  if (!/^[a-z0-9]{6,12}$/.test(id || '')) fail(404, 'Sorteio não encontrado.');
  const g = parse(await store.get(K.grupo(id)));
  if (!g) fail(404, 'Sorteio não encontrado. Confira o link.');
  return g;
}
async function lerPessoas(id) {
  const h = await store.hgetall(K.pessoas(id));
  return Object.values(h || {}).map(parse).sort((a, b) => a.criadoEm - b.criadoEm);
}
const salvarPessoa = (gid, p) => store.hset(K.pessoas(gid), { [p.id]: JSON.stringify(p) });
const salvarGrupo = g => store.set(K.grupo(g.id), JSON.stringify(g));

async function autenticar(req, gid) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!t) fail(401, 'Entre com seu nome e PIN.');
  const s = parse(await store.get(K.token(t)));
  if (!s || s.g !== gid) fail(401, 'Sua sessão expirou. Entre de novo com seu nome e PIN.');
  const p = parse(await store.hget(K.pessoas(gid), s.p));
  if (!p) fail(401, 'Seu cadastro não foi encontrado neste sorteio.');
  return p;
}
async function criarSessao(gid, pid) {
  const t = novoToken();
  await store.set(K.token(t), JSON.stringify({ g: gid, p: pid }), 60 * 60 * 24 * 365);
  return t;
}

function publico(g, pessoas) {
  return {
    id: g.id, nome: g.nome, data: g.data, valor: g.valor,
    status: g.status, sorteadoEm: g.sorteadoEm || null,
    pessoas: pessoas.map(p => ({ id: p.id, nome: p.nome })),
    participantes: pessoas.filter(p => p.participa).length,
  };
}
function meuPerfil(g, pessoas, eu) {
  let amigo = null;
  if (g.status === 'sorteado' && eu.participa && eu.tirou) {
    const a = pessoas.find(p => p.id === eu.tirou);
    if (a) amigo = { nome: a.nome, itens: a.itens };
  }
  const out = {
    grupo: publico(g, pessoas),
    eu: { id: eu.id, nome: eu.nome, itens: eu.itens, admin: !!eu.admin, participa: !!eu.participa },
    amigo,
  };
  if (eu.admin) {
    out.adm = {
      pessoas: pessoas.map(p => ({ id: p.id, nome: p.nome, itens: p.itens.length, participa: !!p.participa, admin: !!p.admin })),
    };
  }
  return out;
}

/* ---------- rotas ---------- */
async function rotear(req, partes) {
  const m = req.method;
  const [r0, gid, r2, r3, r4] = partes;
  if (r0 !== 'grupos') fail(404, 'Rota não encontrada.');

  // Criar sorteio
  if (!gid && m === 'POST') {
    const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
    if (await store.incr(K.criacao(ip), 3600) > 20) fail(429, 'Muitos sorteios criados agora. Tente daqui a pouco.');
    const b = req.body || {};
    const nomeGrupo = limpar(b.grupo?.nome, LIM.grupo);
    if (nomeGrupo.length < 2) fail(400, 'Dê um nome para o sorteio.');
    const nome = nomeValido(b.voce?.nome);
    const pin = checarPin(b.voce?.pin);
    let id; do id = novoId(); while (await store.get(K.grupo(id)));
    const salt = crypto.randomBytes(16).toString('hex');
    const adm = {
      id: novoId(10), nome, salt, pinHash: hashPin(pin, salt), itens: limparItens(b.voce?.itens),
      admin: true, participa: b.voce?.participa !== false, tirou: null, criadoEm: Date.now(),
    };
    const g = {
      id, nome: nomeGrupo, data: limparData(b.grupo?.data), valor: limpar(b.grupo?.valor, LIM.valor),
      status: 'aberto', criadoEm: Date.now(), sorteadoEm: null,
    };
    await salvarGrupo(g);
    await salvarPessoa(id, adm);
    return { status: 201, body: { id, token: await criarSessao(id, adm.id) } };
  }

  const g = await lerGrupo(gid);

  if (!r2 && m === 'GET') return { body: publico(g, await lerPessoas(gid)) };

  // Entrar no sorteio (cadastro)
  if (r2 === 'entrar' && m === 'POST') {
    if (g.status === 'sorteado') fail(409, 'O sorteio já foi realizado, então não dá mais para entrar. Fale com quem está organizando.');
    const b = req.body || {};
    const nome = nomeValido(b.nome);
    const pin = checarPin(b.pin);
    const pessoas = await lerPessoas(gid);
    if (pessoas.length >= 100) fail(400, 'Este sorteio chegou ao limite de 100 pessoas.');
    if (pessoas.some(p => norm(p.nome) === norm(nome))) fail(409, `Já existe alguém chamado "${nome}" neste sorteio. Se for você, use "Já me cadastrei". Se não, acrescente um sobrenome ou apelido.`);
    const salt = crypto.randomBytes(16).toString('hex');
    const p = { id: novoId(10), nome, salt, pinHash: hashPin(pin, salt), itens: limparItens(b.itens), admin: false, participa: true, tirou: null, criadoEm: Date.now() };
    await salvarPessoa(gid, p);
    return { status: 201, body: { token: await criarSessao(gid, p.id) } };
  }

  // Login
  if (r2 === 'login' && m === 'POST') {
    const b = req.body || {};
    const p = parse(await store.hget(K.pessoas(gid), String(b.pessoaId || '')));
    if (!p) fail(404, 'Escolha seu nome na lista.');
    const n = await store.incr(K.tentativas(gid, p.id), 15 * 60);
    if (n > 8) fail(429, 'Muitas tentativas. Espere 15 minutos ou peça para quem organiza criar um novo PIN para você.');
    if (!pinConfere(p, checarPin(b.pin))) fail(401, 'PIN incorreto.');
    await store.del(K.tentativas(gid, p.id));
    return { body: { token: await criarSessao(gid, p.id) } };
  }

  // Sair
  if (r2 === 'sair' && m === 'POST') {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) await store.del(K.token(h.slice(7).trim()));
    return { body: { ok: true } };
  }

  // Meu perfil
  if (r2 === 'eu') {
    const eu = await autenticar(req, gid);
    if (m === 'GET') return { body: meuPerfil(g, await lerPessoas(gid), eu) };
    if (m === 'PUT') {
      const b = req.body || {};
      if (Array.isArray(b.itens)) eu.itens = limparItens(b.itens);
      if (typeof b.participa === 'boolean' && eu.admin) {
        if (g.status === 'sorteado') fail(409, 'Desfaça o sorteio antes de mudar sua participação.');
        eu.participa = b.participa;
      }
      await salvarPessoa(gid, eu);
      return { body: meuPerfil(g, await lerPessoas(gid), eu) };
    }
  }

  // ----- ações de quem organiza -----
  const exigeAdm = async () => {
    const eu = await autenticar(req, gid);
    if (!eu.admin) fail(403, 'Só quem organiza pode fazer isso.');
    return eu;
  };

  if (r2 === 'sortear' && m === 'POST') {
    const eu = await exigeAdm();
    if (g.status === 'sorteado') fail(409, 'O sorteio já foi realizado.');
    if (!(await store.setnx(K.trava(gid), '1', 30))) fail(409, 'O sorteio já está sendo feito. Aguarde alguns segundos.');
    try {
      const pessoas = await lerPessoas(gid);
      const ids = pessoas.filter(p => p.participa).map(p => p.id);
      if (ids.length < MIN_PESSOAS) fail(400, `São necessárias pelo menos ${MIN_PESSOAS} pessoas participando.`);
      const pares = sortear(ids);
      if (!paresValidos(ids, pares)) fail(500, 'Falha ao validar o sorteio. Tente de novo.');
      const atualiza = {};
      for (const p of pessoas) { p.tirou = p.participa ? pares[p.id] : null; atualiza[p.id] = JSON.stringify(p); }
      await store.hset(K.pessoas(gid), atualiza);
      g.status = 'sorteado'; g.sorteadoEm = Date.now();
      await salvarGrupo(g);
      const euAtual = pessoas.find(p => p.id === eu.id);
      return { body: meuPerfil(g, pessoas, euAtual) };
    } finally { await store.del(K.trava(gid)); }
  }

  if (r2 === 'desfazer' && m === 'POST') {
    const eu = await exigeAdm();
    const pessoas = await lerPessoas(gid);
    const atualiza = {};
    for (const p of pessoas) { p.tirou = null; atualiza[p.id] = JSON.stringify(p); }
    if (pessoas.length) await store.hset(K.pessoas(gid), atualiza);
    g.status = 'aberto'; g.sorteadoEm = null;
    await salvarGrupo(g);
    return { body: meuPerfil(g, pessoas, pessoas.find(p => p.id === eu.id)) };
  }

  if (r2 === 'pessoas' && r3) {
    const eu = await exigeAdm();
    const alvo = parse(await store.hget(K.pessoas(gid), r3));
    if (!alvo) fail(404, 'Pessoa não encontrada.');
    if (!r4 && m === 'DELETE') {
      if (g.status === 'sorteado') fail(409, 'Desfaça o sorteio antes de remover alguém.');
      if (alvo.id === eu.id) fail(400, 'Você não pode remover a si mesmo.');
      await store.hdel(K.pessoas(gid), alvo.id);
      const pessoas = await lerPessoas(gid);
      return { body: meuPerfil(g, pessoas, pessoas.find(p => p.id === eu.id)) };
    }
    if (r4 === 'pin' && m === 'POST') {
      const pin = String(randInt(10000)).padStart(4, '0');
      alvo.salt = crypto.randomBytes(16).toString('hex');
      alvo.pinHash = hashPin(pin, alvo.salt);
      await salvarPessoa(gid, alvo);
      await store.del(K.tentativas(gid, alvo.id));
      return { body: { nome: alvo.nome, pin } };
    }
  }

  fail(404, 'Rota não encontrada.');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!hasDb) fail(503, 'O banco de dados ainda não foi conectado ao projeto na Vercel.');
    let caminho = req.query?.path;
    if (Array.isArray(caminho)) caminho = caminho.join('/');
    if (!caminho) caminho = new URL(req.url, 'http://x').pathname.replace(/^\/api\/?/, '');
    const partes = String(caminho).split('/').filter(Boolean);
    if (typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch { req.body = {}; } }
    const out = await rotear(req, partes);
    res.status(out.status || 200).json(out.body);
  } catch (e) {
    if (e instanceof HttpErr) return res.status(e.code).json({ erro: e.message });
    console.error(e);
    res.status(500).json({ erro: 'Erro inesperado. Tente de novo em instantes.' });
  }
}
