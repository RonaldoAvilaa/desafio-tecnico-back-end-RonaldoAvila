# Tarefa 2: Relatório com Aggregation Framework

Os dois relatórios foram feitos no banco `marketplace`, com os 100.000 pedidos gerados pelo seed da Parte 4. Toda a conta é feita dentro do MongoDB com `db.orders.aggregate([...])`; a aplicação só recebe o resultado pronto.

Considerei como venda os pedidos com status PAID, SHIPPED, DELIVERED. Pedidos PENDING e CANCELED ficaram de fora porque não geraram receita.

## 1. Faturamento por categoria (últimos 90 dias)

O período usado foi `createdAt >= ISODate("2026-08-24T00:00:00.000Z")`. A consulta levou 248 ms.

| Categoria | Faturamento | Itens vendidos | Pedidos |
|---|---:|---:|---:|
| Casa e Cozinha | R$ 8.296.986,18 | 29.204 | 11.935 |
| Eletrônicos | R$ 8.296.342,51 | 29.868 | 12.226 |
| Livros | R$ 8.039.898,35 | 29.878 | 12.291 |
| Esportes | R$ 7.819.636,57 | 29.901 | 12.262 |
| Moda | R$ 7.558.038,20 | 30.426 | 12.382 |

Somando as cinco categorias, o faturamento foi de R$ 40.010.901,81, com 149.277 itens vendidos. A coluna "Pedidos" conta quantos pedidos diferentes tiveram pelo menos um item da categoria, então um pedido com itens de duas categorias entra nas duas.

Pipeline usado:

```js
db.orders.aggregate([
  {$match: {status: {$in: ["PAID", "SHIPPED", "DELIVERED"]}, createdAt: {$gte: ISODate("2026-08-24T00:00:00.000Z")}}},
  {$unwind: "$items"},
  {$group: {_id: "$items.category", faturamentoTotal: {$sum: {$multiply: ["$items.unitPrice", "$items.quantity"]}}, quantidadeItens: {$sum: "$items.quantity"}, pedidos: {$addToSet: "$_id"}}},
  {$project: {_id: 0, categoria: "$_id", faturamentoTotal: {$round: ["$faturamentoTotal", 2]}, quantidadeItens: 1, totalPedidos: {$size: "$pedidos"}}},
  {$sort: {faturamentoTotal: -1}}
])
```

O `$match` vem primeiro para filtrar só os pedidos faturados do período e diminuir o volume logo no começo (ele também pode usar índice). Como a categoria fica em cada item e não no pedido, o `$unwind` abre o array `items` em um documento por item. O `$group` junta por categoria somando `unitPrice * quantity` e as quantidades, e guarda os ids dos pedidos para contar depois. O `$project` arredonda os valores e conta os pedidos distintos, e o `$sort` deixa a categoria que mais faturou em primeiro.

## 2. Ranking de clientes VIP de São Paulo (paginado)

Foram encontrados 846 clientes com compras faturadas e entrega em São Paulo. Com 10 por página isso dá 85 páginas. Abaixo está a página 1 (a consulta levou 32 ms):

| Posição | Nome | E-mail | Total gasto | Pedidos |
|---|---|---|---:|---:|
| 1 | Cliente 1520 | cliente1520@exemplo.com | R$ 37.385,28 | 25 |
| 2 | Cliente 1534 | cliente1534@exemplo.com | R$ 33.863,82 | 19 |
| 3 | Cliente 77 | cliente77@exemplo.com | R$ 33.425,12 | 20 |
| 4 | Cliente 24 | cliente24@exemplo.com | R$ 32.962,15 | 17 |
| 5 | Cliente 125 | cliente125@exemplo.com | R$ 32.272,76 | 14 |
| 6 | Cliente 1596 | cliente1596@exemplo.com | R$ 31.807,68 | 19 |
| 7 | Cliente 2320 | cliente2320@exemplo.com | R$ 31.593,40 | 19 |
| 8 | Cliente 4411 | cliente4411@exemplo.com | R$ 30.952,75 | 22 |
| 9 | Cliente 113 | cliente113@exemplo.com | R$ 30.859,64 | 18 |
| 10 | Cliente 70 | cliente70@exemplo.com | R$ 30.732,78 | 15 |

A resposta vem numa única consulta, já com a página e o total de clientes (mostrando só os dois primeiros):

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

Pipeline usado:

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

Primeiro o `$match` pega os pedidos faturados com entrega em São Paulo, e o `$group` transforma isso em um documento por cliente, com o total gasto e a quantidade de pedidos. O `$sort` ordena pelo maior gasto e usa o `_id` para desempatar; sem esse desempate, dois clientes com o mesmo valor poderiam trocar de página entre uma consulta e outra.

A paginação é feita com `$facet`, que roda duas sub-pipelines em cima do mesmo resultado: `dados`, que recorta a página com `$skip` e `$limit` (skip = (página - 1) * tamanho), e `total`, que conta quantos clientes existem. Assim a tela recebe a página e o total de uma vez só. O `$lookup` em `users`, para trazer nome e e-mail, ficou dentro do facet e depois do `$limit`, então ele busca só os 10 clientes da página e não os 846.

Para ver outra página é só passar o número da página e o tamanho: `node tarefa2/pipelines.js 2 10`.
