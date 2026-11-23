# Tarefa 3: Diagnóstico e Otimização de Performance

A análise foi feita no banco `marketplace`, na coleção `orders`, que tem 100.002 documentos gerados pelo seed da Parte 4.

## Consulta analisada

```js
db.orders.find({
  shippingCity: "São Paulo",
  status: "DELIVERED",
  createdAt: { $gte: new Date(Date.now() - 30 * 86400000) }
}).sort({ createdAt: -1 })
```

Para conseguir repetir o teste e comparar com os prints do Compass, fixei a data de corte na meia-noite (UTC) de 30 dias atrás: `createdAt >= ISODate("2026-10-23T00:00:00.000Z")`.

## 1. Diagnóstico da consulta original

Rodei a consulta com `explain("executionStats")` 5 vezes, ainda sem nenhum índice além do `_id`. Os tempos foram 108, 88, 95, 86, 87 ms; o melhor foi 86 ms.

```js
db.orders.find({ ... }).sort({ createdAt: -1 }).explain("executionStats")
```

O plano usado foi `SORT → COLLSCAN`. O COLLSCAN quer dizer que o MongoDB leu a coleção inteira: foram 100.002 documentos examinados (`totalDocsExamined`) para devolver só 572 (`nReturned`), ou seja, só 0.57% do que foi lido era útil. O `totalKeysExamined` ficou em 0 porque nenhum índice foi usado. Além disso, apareceu o estágio SORT, então o resultado ainda teve que ser ordenado na memória. Esse custo cresce junto com a coleção: com 10 milhões de pedidos seriam 10 milhões de documentos lidos em cada busca.

## 2. Solução: índice composto seguindo a regra ESR

```js
db.orders.createIndex(
  { shippingCity: 1, status: 1, createdAt: -1 },
  { name: "idx_city_status_createdAt_ESR" }
)
```

A regra ESR (Equality, Sort, Range) diz a ordem dos campos no índice. Primeiro vêm os campos de igualdade, `shippingCity` e `status`: com eles o MongoDB vai direto para o pedaço do índice que tem só São Paulo e DELIVERED (a ordem entre os dois não faz diferença aqui). Depois vem o campo do sort, `createdAt`. Dentro daquele pedaço as entradas já estão em ordem de data, então o MongoDB lê o índice na ordem certa e não precisa mais ordenar na memória. Por último viria o campo de range, mas nesta consulta o range (`$gte`) é no mesmo `createdAt` do sort, então o mesmo campo atende os dois e o `$gte` só marca onde a leitura do índice termina. Deixei `createdAt: -1` para acompanhar o sort, mas com um campo só de sort o `1` também funcionaria, porque o índice pode ser lido de trás para frente.

## 3. Resultado depois do índice

| | Antes | Depois |
|---|---|---|
| Plano | SORT → COLLSCAN | FETCH → IXSCAN |
| Documentos examinados | 100.002 | 572 |
| Chaves examinadas | 0 | 572 |
| Documentos retornados | 572 | 572 |
| Ordenação em memória | sim | não |
| Tempo | 86 ms | 1 ms |

Com o índice `idx_city_status_createdAt_ESR`, o plano passou a ser IXSCAN (busca no índice) e depois FETCH (leitura só dos documentos encontrados), sem o SORT. Os documentos examinados caíram de 100.002 para 572, e o `totalDocsExamined`, o `totalKeysExamined` e o `nReturned` ficaram iguais (572). Isso é o melhor caso possível, porque todo documento lido é um documento que volta no resultado.

Para confirmar que a ordem dos campos importa, criei também um índice com os mesmos campos fora da ordem ESR, `{ shippingCity: 1, createdAt: 1, status: 1 }`, e forcei o uso dele com `hint`. Ele trouxe os mesmos 572 documentos, mas precisou ler 2.619 chaves (contra 572 do índice ESR), porque com o range no meio ele percorre todos os pedidos de São Paulo dos últimos 30 dias, de qualquer status, e só depois descarta os que não são DELIVERED.

Sobre o tempo em milissegundos: com 100.002 documentos a coleção cabe inteira na memória RAM, então o tempo fica pequeno nos dois casos e muda um pouco a cada execução. Por isso o número mais confiável para comparar é o de documentos examinados, que não depende de cache. Em produção, com milhões de pedidos que não cabem na memória, essa diferença viraria segundos contra milissegundos.
