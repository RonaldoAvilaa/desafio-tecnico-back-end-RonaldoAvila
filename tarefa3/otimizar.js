/**
 * Tarefa 3 - Diagnóstico e Otimização de Performance.
 *  1. explain("executionStats") da consulta original (sem índice -> COLLSCAN)
 *  2. cria o índice composto seguindo a regra ESR (Equality, Sort, Range)
 *  3. explain("executionStats") de novo e compara os indicadores
 *
 * Rodar:  node tarefa3/otimizar.js
 * Gera:   tarefa3/SOLUCAO.md
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const INDICE = { shippingCity: 1, status: 1, createdAt: -1 };
const NOME_INDICE = 'idx_city_status_createdAt_ESR';
const RODADAS = 5; // repete para reduzir ruído de cache no tempo

// Percorre a árvore do plano e lista os estágios (ex.: FETCH -> IXSCAN)
function estagios(plano) {
  const lista = [];
  for (let p = plano; p; p = p.inputStage || (p.inputStages && p.inputStages[0])) lista.push(p.stage);
  return lista;
}

async function medir(orders, filtro, sort) {
  let melhor;
  const tempos = [];
  for (let i = 0; i < RODADAS; i++) {
    const exp = await orders.find(filtro).sort(sort).explain('executionStats');
    const s = exp.executionStats;
    const r = {
      executionTimeMillis: s.executionTimeMillis,
      totalDocsExamined: s.totalDocsExamined,
      totalKeysExamined: s.totalKeysExamined,
      nReturned: s.nReturned,
      estagios: estagios(exp.queryPlanner.winningPlan.queryPlan || exp.queryPlanner.winningPlan).join(' → '),
      sortEmMemoria: JSON.stringify(exp.queryPlanner.winningPlan).includes('"SORT"'),
      indice: JSON.stringify(exp.queryPlanner.winningPlan).match(/"indexName":"([^"]+)"/)?.[1] || '—',
    };
    tempos.push(r.executionTimeMillis);
    if (!melhor || r.executionTimeMillis < melhor.executionTimeMillis) melhor = r;
  }
  return { ...melhor, tempos };
}

(async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const orders = client.db('marketplace').collection('orders');

  // Garante o cenário "antes": só o índice _id
  for (const idx of await orders.indexes()) if (idx.name !== '_id_') await orders.dropIndex(idx.name);

  // "últimos 30 dias" a partir da meia-noite (UTC), para o resultado ser reproduzível
  // e igual ao da consulta feita no Compass com ISODate("AAAA-MM-DDT00:00:00Z").
  const desde = new Date(Date.now() - 30 * 86400000);
  desde.setUTCHours(0, 0, 0, 0);
  const filtro = { shippingCity: 'São Paulo', status: 'DELIVERED', createdAt: { $gte: desde } };
  const sort = { createdAt: -1 };
  const totalColecao = await orders.estimatedDocumentCount();

  console.log('1) Consulta original, sem índice...');
  const antes = await medir(orders, filtro, sort);
  console.log(antes);

  console.log(`\n2) Criando índice ${JSON.stringify(INDICE)}...`);
  await orders.createIndex(INDICE, { name: NOME_INDICE });

  console.log('\n3) Mesma consulta, com índice...');
  const depois = await medir(orders, filtro, sort);
  console.log(depois);

  // Comparação com uma ordem de campos que NÃO segue ESR (Range antes do Sort)
  await orders.createIndex({ shippingCity: 1, createdAt: 1, status: 1 }, { name: 'idx_comparacao_ERS' });
  const errado = (await orders.find(filtro).sort(sort).hint('idx_comparacao_ERS').explain('executionStats')).executionStats;
  await orders.dropIndex('idx_comparacao_ERS');

  const reducao = (a, b) => (a === 0 ? '—' : `${(((a - b) / a) * 100).toFixed(1)}%`);
  const vezes = (a, b) => (b === 0 ? `${a}× → 0` : `${(a / b).toFixed(0)}× menos`);
  const n = (v) => v.toLocaleString('pt-BR');

  const md = `# Tarefa 3: Diagnóstico e Otimização de Performance

A análise foi feita no banco \`marketplace\`, na coleção \`orders\`, que tem ${n(totalColecao)} documentos gerados pelo seed da Parte 4.

## Consulta analisada

\`\`\`js
db.orders.find({
  shippingCity: "São Paulo",
  status: "DELIVERED",
  createdAt: { $gte: new Date(Date.now() - 30 * 86400000) }
}).sort({ createdAt: -1 })
\`\`\`

Para conseguir repetir o teste e comparar com os prints do Compass, fixei a data de corte na meia-noite (UTC) de 30 dias atrás: \`createdAt >= ISODate("${desde.toISOString()}")\`.

## 1. Diagnóstico da consulta original

Rodei a consulta com \`explain("executionStats")\` ${RODADAS} vezes, ainda sem nenhum índice além do \`_id\`. Os tempos foram ${antes.tempos.join(', ')} ms; o melhor foi ${antes.executionTimeMillis} ms.

\`\`\`js
db.orders.find({ ... }).sort({ createdAt: -1 }).explain("executionStats")
\`\`\`

O plano usado foi \`${antes.estagios}\`. O COLLSCAN quer dizer que o MongoDB leu a coleção inteira: foram ${n(antes.totalDocsExamined)} documentos examinados (\`totalDocsExamined\`) para devolver só ${n(antes.nReturned)} (\`nReturned\`), ou seja, só ${((antes.nReturned / antes.totalDocsExamined) * 100).toFixed(2)}% do que foi lido era útil. O \`totalKeysExamined\` ficou em ${n(antes.totalKeysExamined)} porque nenhum índice foi usado. Além disso, apareceu o estágio SORT, então o resultado ainda teve que ser ordenado na memória. Esse custo cresce junto com a coleção: com 10 milhões de pedidos seriam 10 milhões de documentos lidos em cada busca.

## 2. Solução: índice composto seguindo a regra ESR

\`\`\`js
db.orders.createIndex(
  { shippingCity: 1, status: 1, createdAt: -1 },
  { name: "${NOME_INDICE}" }
)
\`\`\`

A regra ESR (Equality, Sort, Range) diz a ordem dos campos no índice. Primeiro vêm os campos de igualdade, \`shippingCity\` e \`status\`: com eles o MongoDB vai direto para o pedaço do índice que tem só São Paulo e DELIVERED (a ordem entre os dois não faz diferença aqui). Depois vem o campo do sort, \`createdAt\`. Dentro daquele pedaço as entradas já estão em ordem de data, então o MongoDB lê o índice na ordem certa e não precisa mais ordenar na memória. Por último viria o campo de range, mas nesta consulta o range (\`$gte\`) é no mesmo \`createdAt\` do sort, então o mesmo campo atende os dois e o \`$gte\` só marca onde a leitura do índice termina. Deixei \`createdAt: -1\` para acompanhar o sort, mas com um campo só de sort o \`1\` também funcionaria, porque o índice pode ser lido de trás para frente.

## 3. Resultado depois do índice

| | Antes | Depois |
|---|---|---|
| Plano | ${antes.estagios} | ${depois.estagios} |
| Documentos examinados | ${n(antes.totalDocsExamined)} | ${n(depois.totalDocsExamined)} |
| Chaves examinadas | ${n(antes.totalKeysExamined)} | ${n(depois.totalKeysExamined)} |
| Documentos retornados | ${n(antes.nReturned)} | ${n(depois.nReturned)} |
| Ordenação em memória | ${antes.sortEmMemoria ? 'sim' : 'não'} | ${depois.sortEmMemoria ? 'sim' : 'não'} |
| Tempo | ${antes.executionTimeMillis} ms | ${depois.executionTimeMillis} ms |

Com o índice \`${depois.indice}\`, o plano passou a ser IXSCAN (busca no índice) e depois FETCH (leitura só dos documentos encontrados), sem o SORT. Os documentos examinados caíram de ${n(antes.totalDocsExamined)} para ${n(depois.totalDocsExamined)}, e o \`totalDocsExamined\`, o \`totalKeysExamined\` e o \`nReturned\` ficaram iguais (${n(depois.nReturned)}). Isso é o melhor caso possível, porque todo documento lido é um documento que volta no resultado.

Para confirmar que a ordem dos campos importa, criei também um índice com os mesmos campos fora da ordem ESR, \`{ shippingCity: 1, createdAt: 1, status: 1 }\`, e forcei o uso dele com \`hint\`. Ele trouxe os mesmos ${n(errado.nReturned)} documentos, mas precisou ler ${n(errado.totalKeysExamined)} chaves (contra ${n(depois.totalKeysExamined)} do índice ESR), porque com o range no meio ele percorre todos os pedidos de São Paulo dos últimos 30 dias, de qualquer status, e só depois descarta os que não são DELIVERED.

Sobre o tempo em milissegundos: com ${n(totalColecao)} documentos a coleção cabe inteira na memória RAM, então o tempo fica pequeno nos dois casos e muda um pouco a cada execução. Por isso o número mais confiável para comparar é o de documentos examinados, que não depende de cache. Em produção, com milhões de pedidos que não cabem na memória, essa diferença viraria segundos contra milissegundos.
`;
  fs.writeFileSync(path.join(__dirname, 'SOLUCAO.md'), md);
  console.log('\nRelatório salvo em tarefa3/SOLUCAO.md');
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
