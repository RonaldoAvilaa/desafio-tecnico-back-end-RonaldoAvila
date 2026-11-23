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
  const md = `# Tarefa 2: Relatório com Aggregation Framework

Os dois relatórios foram feitos no banco \`marketplace\`, com os 100.000 pedidos gerados pelo seed da Parte 4. Toda a conta é feita dentro do MongoDB com \`db.orders.aggregate([...])\`; a aplicação só recebe o resultado pronto.

Considerei como venda os pedidos com status ${STATUS_FATURADOS.join(', ')}. Pedidos PENDING e CANCELED ficaram de fora porque não geraram receita.

## 1. Faturamento por categoria (últimos 90 dias)

O período usado foi \`createdAt >= ISODate("${desde.toISOString()}")\`. A consulta levou ${tempo1} ms.

| Categoria | Faturamento | Itens vendidos | Pedidos |
|---|---:|---:|---:|
${faturamento.map((c) => `| ${c.categoria} | ${brl(c.faturamentoTotal)} | ${n(c.quantidadeItens)} | ${n(c.totalPedidos)} |`).join('\n')}

Somando as cinco categorias, o faturamento foi de ${brl(totalGeral)}, com ${n(faturamento.reduce((s, c) => s + c.quantidadeItens, 0))} itens vendidos. A coluna "Pedidos" conta quantos pedidos diferentes tiveram pelo menos um item da categoria, então um pedido com itens de duas categorias entra nas duas.

Pipeline usado:

${bloco('js', formatarPipeline(p1))}

O \`$match\` vem primeiro para filtrar só os pedidos faturados do período e diminuir o volume logo no começo (ele também pode usar índice). Como a categoria fica em cada item e não no pedido, o \`$unwind\` abre o array \`items\` em um documento por item. O \`$group\` junta por categoria somando \`unitPrice * quantity\` e as quantidades, e guarda os ids dos pedidos para contar depois. O \`$project\` arredonda os valores e conta os pedidos distintos, e o \`$sort\` deixa a categoria que mais faturou em primeiro.

## 2. Ranking de clientes VIP de São Paulo (paginado)

Foram encontrados ${n(ranking.clientesElegiveis)} clientes com compras faturadas e entrega em São Paulo. Com ${tamanho} por página isso dá ${totalPaginas} páginas. Abaixo está a página ${pagina} (a consulta levou ${tempo2} ms):

| Posição | Nome | E-mail | Total gasto | Pedidos |
|---|---|---|---:|---:|
${ranking.dados.map((c, i) => `| ${(pagina - 1) * tamanho + i + 1} | ${c.nome} | ${c.email} | ${brl(c.totalGasto)} | ${c.quantidadePedidos} |`).join('\n')}

A resposta vem numa única consulta, já com a página e o total de clientes (mostrando só os dois primeiros):

${bloco('json', JSON.stringify({ dados: ranking.dados.slice(0, 2), '...': `${ranking.dados.length - 2} itens omitidos`, clientesElegiveis: ranking.clientesElegiveis }, null, 2))}

Pipeline usado:

${bloco('js', formatarPipeline(p2))}

Primeiro o \`$match\` pega os pedidos faturados com entrega em São Paulo, e o \`$group\` transforma isso em um documento por cliente, com o total gasto e a quantidade de pedidos. O \`$sort\` ordena pelo maior gasto e usa o \`_id\` para desempatar; sem esse desempate, dois clientes com o mesmo valor poderiam trocar de página entre uma consulta e outra.

A paginação é feita com \`$facet\`, que roda duas sub-pipelines em cima do mesmo resultado: \`dados\`, que recorta a página com \`$skip\` e \`$limit\` (skip = (página - 1) * tamanho), e \`total\`, que conta quantos clientes existem. Assim a tela recebe a página e o total de uma vez só. O \`$lookup\` em \`users\`, para trazer nome e e-mail, ficou dentro do facet e depois do \`$limit\`, então ele busca só os ${tamanho} clientes da página e não os ${n(ranking.clientesElegiveis)}.

Para ver outra página é só passar o número da página e o tamanho: \`node tarefa2/pipelines.js 2 10\`.
`;
  fs.writeFileSync(path.join(__dirname, 'RELATORIO.md'), md);
  console.log('\nRelatório salvo em tarefa2/RELATORIO.md');
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
