# Tarefa 3 — Diagnóstico e Otimização de Performance

Banco `marketplace`, coleção `orders` com **100.002 documentos** (seed da Parte 4).

## Consulta analisada

```js
db.orders.find({
  shippingCity: "São Paulo",
  status: "DELIVERED",
  createdAt: { $gte: new Date(Date.now() - 30 * 86400000) }
}).sort({ createdAt: -1 })
```

Para o resultado ser reproduzível, a data de corte foi fixada na meia-noite (UTC) de 30 dias atrás: `createdAt >= ISODate("2026-10-23T00:00:00.000Z")`. É exatamente o filtro usado nos prints do MongoDB Compass.

---

## 1. Diagnóstico — `explain("executionStats")` da consulta original

```js
db.orders.find({ ... }).sort({ createdAt: -1 }).explain("executionStats")
```

| Indicador | Valor |
|---|---|
| **executionTimeMillis** | **86 ms** (melhor de 5 execuções: 108, 88, 95, 86, 87 ms) |
| **Estágio** | **SORT → COLLSCAN** |
| **totalDocsExamined** | **100.002** |
| totalKeysExamined | 0 |
| nReturned | 572 |
| Ordenação em memória (`SORT`) | Sim |

**O que isso mostra:** o estágio `COLLSCAN` indica que o MongoDB leu **todos os 100.002 documentos** da coleção para devolver só 572. Cada documento examinado foi útil em apenas 0.57% dos casos. Depois disso, ainda precisou **ordenar o resultado em memória** (estágio `SORT`). O custo cresce linearmente com a coleção: com 10 milhões de pedidos, seriam 10 milhões de documentos lidos a cada busca.

---

## 2. Solução — índice composto pela regra ESR

```js
db.orders.createIndex(
  { shippingCity: 1, status: 1, createdAt: -1 },
  { name: "idx_city_status_createdAt_ESR" }
)
```

| Ordem | Campo | Papel na consulta | Regra ESR |
|---|---|---|---|
| 1º | `shippingCity` | `= "São Paulo"` | **E**quality |
| 2º | `status` | `= "DELIVERED"` | **E**quality |
| 3º | `createdAt` | `sort({ createdAt: -1 })` **e** `$gte` | **S**ort + **R**ange |

**Por que essa ordem:**
- **Igualdades primeiro.** Elas fixam um único "trecho" contíguo do índice: só as entradas de São Paulo + DELIVERED. A ordem entre as duas igualdades não muda o resultado.
- **Sort logo depois das igualdades.** Dentro desse trecho, as entradas já estão ordenadas por `createdAt`, então o MongoDB lê o índice na ordem certa e **elimina o `SORT` em memória**.
- **Range por último.** Aqui o range é no mesmo campo do sort, então a mesma chave atende os dois: o `$gte` só define onde a leitura do índice para.
- `createdAt: -1` acompanha a direção do sort. Para um único campo de range/sort, `1` também funcionaria, porque o índice pode ser lido de trás para frente.

---

## 3. Resultado — `explain("executionStats")` após o índice

| Indicador | Antes (sem índice) | Depois (índice ESR) | Melhoria |
|---|---:|---:|---:|
| **executionTimeMillis** | 86 ms | **1 ms** | 98.8% mais rápido |
| **Estágio** | `SORT → COLLSCAN` | **`FETCH → IXSCAN`** | COLLSCAN eliminado |
| **totalDocsExamined** | 100.002 | **572** | 175× menos |
| totalKeysExamined | 0 | 572 | — |
| nReturned | 572 | 572 | mesmo resultado |
| Sort em memória | Sim | **Não** | eliminado |
| Índice usado | — | `idx_city_status_createdAt_ESR` | |

**Comprovação:** depois do índice, `totalDocsExamined = totalKeysExamined = nReturned = 572`. Essa é a situação ideal: **cada documento lido é um documento devolvido**, sem desperdício. O plano passou a ser `IXSCAN` (busca no índice) seguido de `FETCH` (leitura só dos documentos encontrados), sem etapa de ordenação.

### Contraprova: índice com os mesmos campos fora da ordem ESR

Forçando (`hint`) o índice `{ shippingCity: 1, createdAt: 1, status: 1 }`, com o Range antes da segunda igualdade:

| Indicador | Índice fora da ordem ESR | Índice ESR |
|---|---:|---:|
| totalKeysExamined | 2.619 | 572 |
| totalDocsExamined | 572 | 572 |
| nReturned | 572 | 572 |

Com o range no meio, o MongoDB precisa percorrer **todas as chaves de São Paulo nos últimos 30 dias** (de todos os status) e descartar as que não são `DELIVERED`. São 2.619 chaves lidas para 572 resultados. A ordem dos campos no índice importa tanto quanto a escolha dos campos.

> **Sobre o tempo em ms:** com 100.002 documentos, a coleção inteira cabe na memória RAM, então o tempo absoluto é pequeno nos dois casos e varia entre execuções. O indicador mais confiável é **`totalDocsExamined`**, que não depende de cache: ele cai de 100.002 para 572. Em produção, com milhões de documentos que não cabem na RAM, essa diferença vira segundos contra milissegundos.
