/**
 * Tarefa 2 - Aggregation Framework.
 * Os dois relatórios são calculados 100% dentro do MongoDB (db.collection.aggregate);
 * a aplicação só recebe o resultado final.
 *
 * Rodar:  node tarefa2/pipelines.js [pagina] [tamanhoPagina]
 * Gera:   tarefa2/RELATORIO.md
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const STATUS_FATURADOS = ['PAID', 'SHIPPED', 'DELIVERED'];
const DAY = 86400000;

// ---------------------------------------------------------------------------
// 1. Faturamento por categoria (últimos 90 dias)
// ---------------------------------------------------------------------------
function pipelineFaturamentoPorCategoria(desde) {
  return [
    // filtra o mais cedo possível (pode usar índice em status/createdAt)
    { $match: { status: { $in: STATUS_FATURADOS }, createdAt: { $gte: desde } } },
    // um documento por item do pedido, pois a categoria está no item
    { $unwind: '$items' },
    { $group: {
      _id: '$items.category',
      faturamentoTotal: { $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] } },
      quantidadeItens: { $sum: '$items.quantity' },
      pedidos: { $addToSet: '$_id' },
    } },
    { $project: {
      _id: 0,
      categoria: '$_id',
      faturamentoTotal: { $round: ['$faturamentoTotal', 2] },
      quantidadeItens: 1,
      totalPedidos: { $size: '$pedidos' },
    } },
    { $sort: { faturamentoTotal: -1 } },
  ];
}

// ---------------------------------------------------------------------------
// 2. Ranking de clientes VIP de São Paulo (paginado com $facet)
// ---------------------------------------------------------------------------
function pipelineRankingVip({ cidade, pagina, tamanho }) {
  return [
    { $match: { shippingCity: cidade, status: { $in: STATUS_FATURADOS } } },
    { $group: {
      _id: '$userId',
      totalGasto: { $sum: '$totalAmount' },
      quantidadePedidos: { $sum: 1 },
    } },
    { $sort: { totalGasto: -1, _id: 1 } }, // _id desempata e deixa a paginação estável
    { $facet: {
      dados: [
        { $skip: (pagina - 1) * tamanho },
        { $limit: tamanho },
        // só busca nome/e-mail dos clientes da página (não dos milhares elegíveis)
        { $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'cliente',
          pipeline: [{ $project: { _id: 0, name: 1, email: 1 } }],
        } },
        { $unwind: '$cliente' },
        { $project: {
          _id: 0,
          userId: '$_id',
          nome: '$cliente.name',
          email: '$cliente.email',
          totalGasto: { $round: ['$totalGasto', 2] },
          quantidadePedidos: 1,
        } },
      ],
      total: [{ $count: 'clientesElegiveis' }],
    } },
    { $project: {
      dados: 1,
      clientesElegiveis: { $ifNull: [{ $first: '$total.clientesElegiveis' }, 0] },
    } },
  ];
}

// ---------------------------------------------------------------------------
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n = (v) => v.toLocaleString('pt-BR');
const bloco = (lang, s) => ['```' + lang, s, '```'].join('\n');

// Formata um pipeline no estilo do mongosh: um estágio por linha ($facet com uma sub-etapa por linha)
function formatarPipeline(pipeline) {
  // toJSON() converte Date em string antes do replacer; por isso olha o valor original em this[k]
  const js = (v) => JSON.stringify(v, function (k, x) { return this[k] instanceof Date ? `__ISODate(${this[k].toISOString()})__` : x; })
    .replace(/"__ISODate\(([^)]+)\)__"/g, 'ISODate("$1")')
    .replace(/"(\$?[A-Za-z_][\w.]*)":/g, (m, chave) => (chave.startsWith('$') || /^[A-Za-z_]\w*$/.test(chave) ? `${chave}: ` : `"${chave}": `))
    .replace(/,(?=[^\s])/g, ', ');
  const linhas = pipeline.map((estagio) => {
    if (!estagio.$facet) return `  ${js(estagio)}`;
    const ramos = Object.entries(estagio.$facet).map(([nome, sub]) =>
      `      ${nome}: [\n${sub.map((s) => `        ${js(s)}`).join(',\n')}\n      ]`);
    return `  { $facet: {\n${ramos.join(',\n')}\n  } }`;
  });
  return `db.orders.aggregate([\n${linhas.join(',\n')}\n])`;
}

(async () => {
  const pagina = Number(process.argv[2]) || 1;
  const tamanho = Number(process.argv[3]) || 10;
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const orders = client.db('marketplace').collection('orders');

  // 90 dias a partir da meia-noite (UTC): resultado reproduzível e igual ao do Compass
  const desde = new Date(Date.now() - 90 * DAY);
  desde.setUTCHours(0, 0, 0, 0);
  const p1 = pipelineFaturamentoPorCategoria(desde);
  let t = Date.now();
  const faturamento = await orders.aggregate(p1).toArray();
  const tempo1 = Date.now() - t;

  const p2 = pipelineRankingVip({ cidade: 'São Paulo', pagina, tamanho });
  t = Date.now();
  const [ranking] = await orders.aggregate(p2).toArray();
  const tempo2 = Date.now() - t;
  const totalPaginas = Math.ceil(ranking.clientesElegiveis / tamanho);

  console.log(`\n1) Faturamento por categoria (desde ${desde.toLocaleDateString('pt-BR')}) — ${tempo1} ms`);
  console.table(faturamento);
  console.log(`\n2) Ranking VIP São Paulo — página ${pagina}/${totalPaginas}, ${ranking.clientesElegiveis} clientes elegíveis — ${tempo2} ms`);
  console.table(ranking.dados.map(({ userId, ...r }) => r));

  const totalGeral = faturamento.reduce((s, c) => s + c.faturamentoTotal, 0);
  const md = `# Tarefa 2 — Relatório (Aggregation Framework)

Banco \`marketplace\` (seed da Parte 4: 100.000 pedidos). Gerado em ${new Date().toLocaleString('pt-BR')}.
Os dois relatórios rodam inteiros no MongoDB com \`db.orders.aggregate([...])\`; nenhum array é processado na aplicação.

**Status considerados como venda:** ${STATUS_FATURADOS.join(', ')}. \`PENDING\` e \`CANCELED\` ficam de fora, pois não geram receita.

---

## 1. Faturamento por Categoria (últimos 90 dias)

Período: de **${desde.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}** até hoje (\`createdAt >= ISODate("${desde.toISOString()}")\`) — tempo de execução: **${tempo1} ms**

| # | Categoria | Faturamento total | Itens vendidos | Pedidos |
|---|---|---:|---:|---:|
${faturamento.map((c, i) => `| ${i + 1} | ${c.categoria} | ${brl(c.faturamentoTotal)} | ${n(c.quantidadeItens)} | ${n(c.totalPedidos)} |`).join('\n')}
| | **Total** | **${brl(totalGeral)}** | **${n(faturamento.reduce((s, c) => s + c.quantidadeItens, 0))}** | |

> A coluna "Pedidos" conta pedidos distintos que tiveram ao menos um item da categoria. Um pedido com itens de duas categorias aparece nas duas.

### Pipeline

${bloco('js', formatarPipeline(p1))}

| Etapa | O que faz |
|---|---|
| \`$match\` | Mantém só pedidos faturados dos últimos 90 dias. Vem primeiro para reduzir o volume (e pode usar índice) |
| \`$unwind\` | Abre o array \`items\`: um documento por item, porque a categoria está no item, não no pedido |
| \`$group\` | Agrupa por categoria, somando \`unitPrice × quantity\` e as quantidades |
| \`$project\` | Renomeia campos, arredonda valores e conta pedidos distintos |
| \`$sort\` | Ordena do maior faturamento para o menor |

---

## 2. Ranking de Clientes VIP — São Paulo (paginado)

Página **${pagina}** de **${totalPaginas}** (${tamanho} por página) — **${n(ranking.clientesElegiveis)} clientes elegíveis** — tempo de execução: **${tempo2} ms**

| # | Nome | E-mail | Total gasto | Pedidos |
|---|---|---|---:|---:|
${ranking.dados.map((c, i) => `| ${(pagina - 1) * tamanho + i + 1} | ${c.nome} | ${c.email} | ${brl(c.totalGasto)} | ${c.quantidadePedidos} |`).join('\n')}

Resposta bruta da consulta (uma única ida ao banco traz a página e o total):

${bloco('json', JSON.stringify({ dados: ranking.dados.slice(0, 2), '...': `${ranking.dados.length - 2} itens omitidos`, clientesElegiveis: ranking.clientesElegiveis }, null, 2))}

### Pipeline

${bloco('js', formatarPipeline(p2))}

| Etapa | O que faz |
|---|---|
| \`$match\` | Pedidos faturados com entrega em São Paulo |
| \`$group\` | Um documento por cliente (\`userId\`) com total gasto e número de pedidos |
| \`$sort\` | Maior gasto primeiro. O \`_id\` desempata, deixando a paginação estável entre páginas |
| \`$facet\` | Executa **duas sub-pipelines sobre o mesmo resultado**: \`dados\` (página atual) e \`total\` (contagem de elegíveis) |
| \`$skip\`/\`$limit\` | Recortam a página: \`skip = (página − 1) × tamanho\` |
| \`$lookup\` | Busca nome e e-mail na coleção \`users\`. Fica **dentro** do facet, depois do \`$limit\`, para fazer apenas ${tamanho} buscas em vez de ${n(ranking.clientesElegiveis)} |
| \`$project\` | Formata a saída final \`{ dados: [...], clientesElegiveis: N }\` |

Para ver outra página: \`node tarefa2/pipelines.js 2 10\`.
`;
  fs.writeFileSync(path.join(__dirname, 'RELATORIO.md'), md);
  console.log('\nRelatório salvo em tarefa2/RELATORIO.md');
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
