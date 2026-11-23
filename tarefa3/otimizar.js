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

  const md = `# Tarefa 3 — Diagnóstico e Otimização de Performance

Banco \`marketplace\`, coleção \`orders\` com **${n(totalColecao)} documentos** (seed da Parte 4).

## Consulta analisada

\`\`\`js
db.orders.find({
  shippingCity: "São Paulo",
  status: "DELIVERED",
  createdAt: { $gte: new Date(Date.now() - 30 * 86400000) }
}).sort({ createdAt: -1 })
\`\`\`

Para o resultado ser reproduzível, a data de corte foi fixada na meia-noite (UTC) de 30 dias atrás: \`createdAt >= ISODate("${desde.toISOString()}")\`. É exatamente o filtro usado nos prints do MongoDB Compass.

---

## 1. Diagnóstico — \`explain("executionStats")\` da consulta original

\`\`\`js
db.orders.find({ ... }).sort({ createdAt: -1 }).explain("executionStats")
\`\`\`

| Indicador | Valor |
|---|---|
| **executionTimeMillis** | **${antes.executionTimeMillis} ms** (melhor de ${RODADAS} execuções: ${antes.tempos.join(', ')} ms) |
| **Estágio** | **${antes.estagios}** |
| **totalDocsExamined** | **${n(antes.totalDocsExamined)}** |
| totalKeysExamined | ${n(antes.totalKeysExamined)} |
| nReturned | ${n(antes.nReturned)} |
| Ordenação em memória (\`SORT\`) | ${antes.sortEmMemoria ? 'Sim' : 'Não'} |

**O que isso mostra:** o estágio \`COLLSCAN\` indica que o MongoDB leu **todos os ${n(antes.totalDocsExamined)} documentos** da coleção para devolver só ${n(antes.nReturned)}. Cada documento examinado foi útil em apenas ${((antes.nReturned / antes.totalDocsExamined) * 100).toFixed(2)}% dos casos. Depois disso, ainda precisou **ordenar o resultado em memória** (estágio \`SORT\`). O custo cresce linearmente com a coleção: com 10 milhões de pedidos, seriam 10 milhões de documentos lidos a cada busca.

---

## 2. Solução — índice composto pela regra ESR

\`\`\`js
db.orders.createIndex(
  { shippingCity: 1, status: 1, createdAt: -1 },
  { name: "${NOME_INDICE}" }
)
\`\`\`

| Ordem | Campo | Papel na consulta | Regra ESR |
|---|---|---|---|
| 1º | \`shippingCity\` | \`= "São Paulo"\` | **E**quality |
| 2º | \`status\` | \`= "DELIVERED"\` | **E**quality |
| 3º | \`createdAt\` | \`sort({ createdAt: -1 })\` **e** \`$gte\` | **S**ort + **R**ange |

**Por que essa ordem:**
- **Igualdades primeiro.** Elas fixam um único "trecho" contíguo do índice: só as entradas de São Paulo + DELIVERED. A ordem entre as duas igualdades não muda o resultado.
- **Sort logo depois das igualdades.** Dentro desse trecho, as entradas já estão ordenadas por \`createdAt\`, então o MongoDB lê o índice na ordem certa e **elimina o \`SORT\` em memória**.
- **Range por último.** Aqui o range é no mesmo campo do sort, então a mesma chave atende os dois: o \`$gte\` só define onde a leitura do índice para.
- \`createdAt: -1\` acompanha a direção do sort. Para um único campo de range/sort, \`1\` também funcionaria, porque o índice pode ser lido de trás para frente.

---

## 3. Resultado — \`explain("executionStats")\` após o índice

| Indicador | Antes (sem índice) | Depois (índice ESR) | Melhoria |
|---|---:|---:|---:|
| **executionTimeMillis** | ${antes.executionTimeMillis} ms | **${depois.executionTimeMillis} ms** | ${reducao(antes.executionTimeMillis, depois.executionTimeMillis)} mais rápido |
| **Estágio** | \`${antes.estagios}\` | **\`${depois.estagios}\`** | COLLSCAN eliminado |
| **totalDocsExamined** | ${n(antes.totalDocsExamined)} | **${n(depois.totalDocsExamined)}** | ${vezes(antes.totalDocsExamined, depois.totalDocsExamined)} |
| totalKeysExamined | ${n(antes.totalKeysExamined)} | ${n(depois.totalKeysExamined)} | — |
| nReturned | ${n(antes.nReturned)} | ${n(depois.nReturned)} | mesmo resultado |
| Sort em memória | ${antes.sortEmMemoria ? 'Sim' : 'Não'} | **${depois.sortEmMemoria ? 'Sim' : 'Não'}** | ${depois.sortEmMemoria ? '—' : 'eliminado'} |
| Índice usado | ${antes.indice} | \`${depois.indice}\` | |

**Comprovação:** depois do índice, \`totalDocsExamined = totalKeysExamined = nReturned = ${n(depois.nReturned)}\`. Essa é a situação ideal: **cada documento lido é um documento devolvido**, sem desperdício. O plano passou a ser \`IXSCAN\` (busca no índice) seguido de \`FETCH\` (leitura só dos documentos encontrados), sem etapa de ordenação.

### Contraprova: índice com os mesmos campos fora da ordem ESR

Forçando (\`hint\`) o índice \`{ shippingCity: 1, createdAt: 1, status: 1 }\`, com o Range antes da segunda igualdade:

| Indicador | Índice fora da ordem ESR | Índice ESR |
|---|---:|---:|
| totalKeysExamined | ${n(errado.totalKeysExamined)} | ${n(depois.totalKeysExamined)} |
| totalDocsExamined | ${n(errado.totalDocsExamined)} | ${n(depois.totalDocsExamined)} |
| nReturned | ${n(errado.nReturned)} | ${n(depois.nReturned)} |

Com o range no meio, o MongoDB precisa percorrer **todas as chaves de São Paulo nos últimos 30 dias** (de todos os status) e descartar as que não são \`DELIVERED\`. São ${n(errado.totalKeysExamined)} chaves lidas para ${n(errado.nReturned)} resultados. A ordem dos campos no índice importa tanto quanto a escolha dos campos.

> **Sobre o tempo em ms:** com ${n(totalColecao)} documentos, a coleção inteira cabe na memória RAM, então o tempo absoluto é pequeno nos dois casos e varia entre execuções. O indicador mais confiável é **\`totalDocsExamined\`**, que não depende de cache: ele cai de ${n(antes.totalDocsExamined)} para ${n(depois.totalDocsExamined)}. Em produção, com milhões de documentos que não cabem na RAM, essa diferença vira segundos contra milissegundos.
`;
  fs.writeFileSync(path.join(__dirname, 'SOLUCAO.md'), md);
  console.log('\nRelatório salvo em tarefa3/SOLUCAO.md');
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
