# Tarefa 2 — Relatório (Aggregation Framework)

Banco `marketplace` (seed da Parte 4: 100.000 pedidos).
Os dois relatórios rodam inteiros no MongoDB com `db.orders.aggregate([...])`; nenhum array é processado na aplicação.

**Status considerados como venda:** PAID, SHIPPED, DELIVERED. `PENDING` e `CANCELED` ficam de fora, pois não geram receita.

---

## 1. Faturamento por Categoria (últimos 90 dias)

Período: últimos 90 dias (`createdAt >= ISODate("2026-08-24T00:00:00.000Z")`) — tempo de execução: **248 ms**

| # | Categoria | Faturamento total | Itens vendidos | Pedidos |
|---|---|---:|---:|---:|
| 1 | Casa e Cozinha | R$ 8.296.986,18 | 29.204 | 11.935 |
| 2 | Eletrônicos | R$ 8.296.342,51 | 29.868 | 12.226 |
| 3 | Livros | R$ 8.039.898,35 | 29.878 | 12.291 |
| 4 | Esportes | R$ 7.819.636,57 | 29.901 | 12.262 |
| 5 | Moda | R$ 7.558.038,20 | 30.426 | 12.382 |
| | **Total** | **R$ 40.010.901,81** | **149.277** | |

> A coluna "Pedidos" conta pedidos distintos que tiveram ao menos um item da categoria. Um pedido com itens de duas categorias aparece nas duas.

### Pipeline

```js
db.orders.aggregate([
  {$match: {status: {$in: ["PAID", "SHIPPED", "DELIVERED"]}, createdAt: {$gte: ISODate("2026-08-24T00:00:00.000Z")}}},
  {$unwind: "$items"},
  {$group: {_id: "$items.category", faturamentoTotal: {$sum: {$multiply: ["$items.unitPrice", "$items.quantity"]}}, quantidadeItens: {$sum: "$items.quantity"}, pedidos: {$addToSet: "$_id"}}},
  {$project: {_id: 0, categoria: "$_id", faturamentoTotal: {$round: ["$faturamentoTotal", 2]}, quantidadeItens: 1, totalPedidos: {$size: "$pedidos"}}},
  {$sort: {faturamentoTotal: -1}}
])
```

| Etapa | O que faz |
|---|---|
| `$match` | Mantém só pedidos faturados dos últimos 90 dias. Vem primeiro para reduzir o volume (e pode usar índice) |
| `$unwind` | Abre o array `items`: um documento por item, porque a categoria está no item, não no pedido |
| `$group` | Agrupa por categoria, somando `unitPrice × quantity` e as quantidades |
| `$project` | Renomeia campos, arredonda valores e conta pedidos distintos |
| `$sort` | Ordena do maior faturamento para o menor |

---

## 2. Ranking de Clientes VIP — São Paulo (paginado)

Página **1** de **85** (10 por página) — **846 clientes elegíveis** — tempo de execução: **32 ms**

| # | Nome | E-mail | Total gasto | Pedidos |
|---|---|---|---:|---:|
| 1 | Cliente 1520 | cliente1520@exemplo.com | R$ 37.385,28 | 25 |
| 2 | Cliente 1534 | cliente1534@exemplo.com | R$ 33.863,82 | 19 |
| 3 | Cliente 77 | cliente77@exemplo.com | R$ 33.425,12 | 20 |
| 4 | Cliente 24 | cliente24@exemplo.com | R$ 32.962,15 | 17 |
| 5 | Cliente 125 | cliente125@exemplo.com | R$ 32.272,76 | 14 |
| 6 | Cliente 1596 | cliente1596@exemplo.com | R$ 31.807,68 | 19 |
| 7 | Cliente 2320 | cliente2320@exemplo.com | R$ 31.593,40 | 19 |
| 8 | Cliente 4411 | cliente4411@exemplo.com | R$ 30.952,75 | 22 |
| 9 | Cliente 113 | cliente113@exemplo.com | R$ 30.859,64 | 18 |
| 10 | Cliente 70 | cliente70@exemplo.com | R$ 30.732,78 | 15 |

Resposta bruta da consulta (uma única ida ao banco traz a página e o total):

```json
{
  "dados": [
    {
      "quantidadePedidos": 25,
      "userId": "6b00f2d38eaf61f3cdd87c45",
      "nome": "Cliente 1520",
      "email": "cliente1520@exemplo.com",
      "totalGasto": 37385.28
    },
    {
      "quantidadePedidos": 19,
      "userId": "6b00f2d38eaf61f3cdd87c53",
      "nome": "Cliente 1534",
      "email": "cliente1534@exemplo.com",
      "totalGasto": 33863.82
    }
  ],
  "...": "8 itens omitidos",
  "clientesElegiveis": 846
}
```

### Pipeline

```js
db.orders.aggregate([
  {$match: {shippingCity: "São Paulo", status: {$in: ["PAID", "SHIPPED", "DELIVERED"]}}},
  {$group: {_id: "$userId", totalGasto: {$sum: "$totalAmount"}, quantidadePedidos: {$sum: 1}}},
  {$sort: {totalGasto: -1, _id: 1}},
  { $facet: {
      dados: [
        {$skip: 0},
        {$limit: 10},
        {$lookup: {from: "users", localField: "_id", foreignField: "_id", as: "cliente", pipeline: [{$project: {_id: 0, name: 1, email: 1}}]}},
        {$unwind: "$cliente"},
        {$project: {_id: 0, userId: "$_id", nome: "$cliente.name", email: "$cliente.email", totalGasto: {$round: ["$totalGasto", 2]}, quantidadePedidos: 1}}
      ],
      total: [
        {$count: "clientesElegiveis"}
      ]
  } },
  {$project: {dados: 1, clientesElegiveis: {$ifNull: [{$first: "$total.clientesElegiveis"}, 0]}}}
])
```

| Etapa | O que faz |
|---|---|
| `$match` | Pedidos faturados com entrega em São Paulo |
| `$group` | Um documento por cliente (`userId`) com total gasto e número de pedidos |
| `$sort` | Maior gasto primeiro. O `_id` desempata, deixando a paginação estável entre páginas |
| `$facet` | Executa **duas sub-pipelines sobre o mesmo resultado**: `dados` (página atual) e `total` (contagem de elegíveis) |
| `$skip`/`$limit` | Recortam a página: `skip = (página − 1) × tamanho` |
| `$lookup` | Busca nome e e-mail na coleção `users`. Fica **dentro** do facet, depois do `$limit`, para fazer apenas 10 buscas em vez de 846 |
| `$project` | Formata a saída final `{ dados: [...], clientesElegiveis: N }` |

Para ver outra página: `node tarefa2/pipelines.js 2 10`.
