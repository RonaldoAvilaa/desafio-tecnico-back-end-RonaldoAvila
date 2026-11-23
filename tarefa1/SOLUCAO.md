# Tarefa 1: Modelagem e Evolução de Schema

A área de produto pediu duas funcionalidades novas: avaliações de produtos (reviews) e um log de auditoria dos pedidos. Para decidir entre Embedding e Referencing usei uma regra simples: se o dado é lido junto com o documento pai e tem um tamanho que não cresce sem parar, ele fica embutido; se pode crescer sem limite ou é consultado separado, vai para outra coleção e é referenciado pelo `_id`.

## 1. Avaliações de produtos

Um produto popular pode chegar a dezenas de milhares de avaliações, mas a tela do produto só mostra a média, o total e as 10 avaliações mais recentes. Então separei as coisas assim:

- Todas as avaliações ficam numa coleção nova, `reviews`, com um documento por avaliação e o campo `productId` apontando para o produto (Referencing).
- A média e o total ficam calculados dentro do próprio produto, no campo `ratingSummary` (Embedding de um valor pré-calculado).
- As 10 últimas avaliações ficam copiadas dentro do produto, no array `recentReviews`, que nunca passa de 10 itens (Embedding de um subconjunto).

Isso é o que a documentação do MongoDB chama de Subset Pattern junto com Computed Pattern.

### Coleção products (alterada)

```json
{
  "_id": { "$oid": "665f1c2e9b1e8a0012a1b001" },
  "sku": "SKU-00042",
  "name": "Teclado Mecânico",
  "category": "Eletrônicos",
  "price": 250.0,
  "stock": 120,
  "sellerId": "SELLER-7",
  "active": true,

  "ratingSummary": {
    "count": 18432,
    "sum": 80124,
    "average": 4.35,
    "distribution": { "1": 512, "2": 734, "3": 2101, "4": 5890, "5": 9195 }
  },

  "recentReviews": [
    {
      "reviewId": { "$oid": "6660a1b29b1e8a0012c9f010" },
      "userId": { "$oid": "665f1c2e9b1e8a0012a2c777" },
      "authorName": "Cliente 777",
      "rating": 5,
      "comment": "Excelente, chegou antes do prazo.",
      "createdAt": { "$date": "2026-11-20T14:02:11Z" }
    }
    // no máximo 10 itens, do mais novo para o mais antigo
  ]
}
```

### Coleção reviews (nova)

```json
{
  "_id": { "$oid": "6660a1b29b1e8a0012c9f010" },
  "productId": { "$oid": "665f1c2e9b1e8a0012a1b001" },
  "userId": { "$oid": "665f1c2e9b1e8a0012a2c777" },
  "authorName": "Cliente 777",
  "rating": 5,
  "comment": "Excelente, chegou antes do prazo.",
  "createdAt": { "$date": "2026-11-20T14:02:11Z" }
}
```

Criei dois índices nessa coleção. O primeiro serve para a página "ver todas as avaliações" (paginada pela data) e o segundo impede que o mesmo usuário avalie o mesmo produto duas vezes.

```js
db.reviews.createIndex({ productId: 1, createdAt: -1 });
db.reviews.createIndex({ productId: 1, userId: 1 }, { unique: true });
```

### Como grava uma avaliação nova

As duas escritas rodam dentro da mesma transação, para o resumo do produto nunca ficar diferente do que está na coleção `reviews`.

```js
// 1) documento completo na coleção reviews
db.reviews.insertOne(review);

// 2) atualiza o resumo do produto
db.products.updateOne({ _id: productId }, [
  { $set: {
      "ratingSummary.count": { $add: [{ $ifNull: ["$ratingSummary.count", 0] }, 1] },
      "ratingSummary.sum":   { $add: [{ $ifNull: ["$ratingSummary.sum", 0] }, review.rating] }
  }},
  { $set: {
      "ratingSummary.average": { $round: [{ $divide: ["$ratingSummary.sum", "$ratingSummary.count"] }, 2] }
  }}
]);

// 3) coloca a avaliação no topo do array e corta em 10
db.products.updateOne(
  { _id: productId },
  { $inc: { [`ratingSummary.distribution.${review.rating}`]: 1 },
    $push: { recentReviews: { $each: [resumoDaReview], $position: 0, $slice: 10 } } }
);
```

O `$position: 0` coloca a avaliação nova na primeira posição e o `$slice: 10` joga fora a mais antiga quando passa de 10. Assim o array fica sempre do mesmo tamanho.

### Leitura na tela do produto

```js
db.products.findOne(
  { _id: productId },
  { name: 1, price: 1, ratingSummary: 1, recentReviews: 1 }
);
```

A tela inteira sai de uma única leitura pelo `_id`. Não precisa de `$lookup` nem de `$group`, e não passa pelas milhares de avaliações da coleção `reviews`.

## 2. Log de auditoria dos pedidos

O pedido passa por poucos status: PENDING, PAID, SHIPPED, DELIVERED e, às vezes, CANCELED. Na prática são menos de 10 mudanças por pedido, e esse histórico é mostrado junto com o pedido na tela de acompanhamento. Por isso deixei o histórico embutido no próprio pedido, num array `statusHistory`. O status atual continua no campo `status`, que é o que as consultas usam (e que ganha índice na Tarefa 3).

Para o usuário responsável pela mudança, guardei o `userId` (referência para `users`) e também uma cópia do nome e do papel. Assim dá para mostrar quem mudou o status sem precisar consultar outra coleção.

### Coleção orders (alterada)

```json
{
  "_id": { "$oid": "6661b0c49b1e8a0012d0a123" },
  "userId": { "$oid": "665f1c2e9b1e8a0012a2c777" },
  "shippingCity": "São Paulo",
  "status": "DELIVERED",
  "items": [
    { "productId": { "$oid": "665f1c2e9b1e8a0012a1b001" }, "sku": "SKU-00042",
      "category": "Eletrônicos", "unitPrice": 250.0, "quantity": 2 }
  ],
  "totalAmount": 500.0,
  "createdAt": { "$date": "2026-11-10T10:00:00Z" },

  "statusHistory": [
    { "from": null,      "to": "PENDING",   "at": { "$date": "2026-11-10T10:00:00Z" },
      "changedBy": { "userId": { "$oid": "665f1c2e9b1e8a0012a2c777" }, "name": "Cliente 777", "role": "customer" } },
    { "from": "PENDING", "to": "PAID",      "at": { "$date": "2026-11-10T10:03:12Z" },
      "changedBy": { "userId": null, "name": "gateway-pagamento", "role": "system" } },
    { "from": "PAID",    "to": "SHIPPED",   "at": { "$date": "2026-11-11T08:40:00Z" },
      "changedBy": { "userId": { "$oid": "665f1c2e9b1e8a0012a3e001" }, "name": "Operador Logística", "role": "staff" } },
    { "from": "SHIPPED", "to": "DELIVERED", "at": { "$date": "2026-11-13T16:21:00Z" },
      "changedBy": { "userId": null, "name": "transportadora-api", "role": "system" } }
  ]
}
```

### Mudança de status

```js
db.orders.updateOne(
  { _id: orderId, status: "PAID" },
  { $set:  { status: "SHIPPED" },
    $push: { statusHistory: { from: "PAID", to: "SHIPPED", at: new Date(), changedBy } } }
);
```

O filtro `status: "PAID"` garante que o pedido só avança se estiver no status esperado. Se duas atualizações chegarem ao mesmo tempo, só a primeira encontra o pedido como PAID; a outra volta com `modifiedCount` igual a 0 e não grava nada errado no histórico.

Se um dia a auditoria tiver que registrar qualquer evento do pedido (troca de endereço, nova tentativa de pagamento, reemissão de nota etc.), o histórico deixa de ser limitado. Aí o certo seria mover o log para uma coleção própria, `order_audit_logs`, com um documento por evento e índice em `{ orderId: 1, at: 1 }`, deixando no pedido só os últimos eventos, do mesmo jeito que foi feito com as reviews.

## 3. Por que essa modelagem evita o Unbounded Arrays

Um documento no MongoDB pode ter no máximo 16 MB. O problema de Unbounded Arrays aparece quando um array cresce sem limite, por exemplo guardar todas as avaliações dentro do produto. Com dezenas de milhares de avaliações com comentário, o documento passaria dos 16 MB e as gravações começariam a dar erro. Mas bem antes disso já teria outros problemas: toda vez que alguém abrisse a tela do produto viriam megabytes de avaliações que nem aparecem na tela, e cada avaliação nova teria que reescrever um documento enorme, que ainda fica disputado por todas as gravações ao mesmo tempo.

No modelo que montei isso não acontece porque:

- as avaliações completas estão na coleção `reviews`, e o produto guarda no máximo 10 delas;
- a média e o total já estão calculados no `ratingSummary`, então não precisa somar milhares de documentos a cada visita;
- o documento do produto fica sempre com poucos KB, não importa quantas avaliações existam;
- o histórico de status é limitado pelo próprio ciclo de vida do pedido;
- a lista com todas as avaliações é uma consulta separada, paginada e usando o índice `{ productId: 1, createdAt: -1 }`, e só roda quando o usuário pede.

Com isso a tela do produto é montada com uma leitura só, e a consulta pesada fica para quando realmente for necessária.

Para testar a modelagem fiz o script `demo.js` (rodar com `node tarefa1/demo.js`). Ele insere 25 avaliações em um produto e mostra que o produto ficou só com as 10 mais recentes e com a média certa. Depois ele muda o status de um pedido algumas vezes e mostra o histórico gravado.
