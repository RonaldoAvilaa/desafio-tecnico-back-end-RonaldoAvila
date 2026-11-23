# Tarefa 1 — Modelagem e Evolução de Schema

Duas novas funcionalidades: **Avaliações de Produtos (Reviews)** e **Logs de Auditoria de Pedidos**.

A regra que guiou as decisões:

> **Embedding** quando o dado é lido junto com o pai e tem tamanho **limitado**.
> **Referencing** quando o dado pode crescer **sem limite** ou é consultado de forma independente.

---

## 1. Avaliações de Produtos (Reviews)

Um produto popular pode ter **dezenas de milhares** de avaliações, mas a tela do produto só precisa de três coisas: **média**, **total** e as **10 mais recentes**.

Por isso usei o padrão **Subset + Computed** (subconjunto e valores pré-calculados):

| Dado | Onde fica | Estratégia |
|---|---|---|
| Todas as avaliações | Coleção `reviews` (1 documento por avaliação) | **Referencing** (`productId`) |
| Média e total | Campo `ratingSummary` dentro de `products` | **Embedding** (valor pré-calculado) |
| 10 avaliações mais recentes | Array `recentReviews` dentro de `products`, com no máximo 10 itens | **Embedding** (subconjunto limitado) |

### Coleção `products` (alterada)

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
    // ... no máximo 10 itens, do mais novo para o mais antigo
  ]
}
```

### Coleção `reviews` (nova)

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

Índices:

```js
db.reviews.createIndex({ productId: 1, createdAt: -1 });          // paginação "ver todas as avaliações"
db.reviews.createIndex({ productId: 1, userId: 1 }, { unique: true }); // 1 avaliação por usuário/produto
```

### Gravação de uma nova avaliação

As duas escritas abaixo rodam **na mesma transação**, para o resumo nunca divergir da coleção:

```js
// 1) documento completo na coleção reviews
db.reviews.insertOne(review);

// 2) atualiza o resumo e o subconjunto do produto numa única operação
db.products.updateOne({ _id: productId }, [
  { $set: {
      "ratingSummary.count": { $add: [{ $ifNull: ["$ratingSummary.count", 0] }, 1] },
      "ratingSummary.sum":   { $add: [{ $ifNull: ["$ratingSummary.sum", 0] }, review.rating] }
  }},
  { $set: {
      "ratingSummary.average": { $round: [{ $divide: ["$ratingSummary.sum", "$ratingSummary.count"] }, 2] }
  }}
]);
db.products.updateOne(
  { _id: productId },
  { $inc: { [`ratingSummary.distribution.${review.rating}`]: 1 },
    $push: { recentReviews: { $each: [resumoDaReview], $position: 0, $slice: 10 } } }
);
```

O `$slice: 10` com `$position: 0` coloca a avaliação nova no topo e **descarta automaticamente** a mais antiga. Assim o array nunca passa de 10 itens.

### Leitura na tela do produto

```js
db.products.findOne(
  { _id: productId },
  { name: 1, price: 1, ratingSummary: 1, recentReviews: 1 }
);
```

A tela é montada com **uma leitura de um único documento pelo `_id`**. Não há `$lookup`, `$group` nem varredura das 18 mil avaliações.

---

## 2. Logs de Auditoria de Pedidos

Um pedido passa por poucos estados (`PENDING → PAID → SHIPPED → DELIVERED`, e às vezes `CANCELED`). Esse histórico é **naturalmente limitado**: na prática, menos de 10 eventos por pedido. Ele também é lido junto com o pedido (na tela de "acompanhar pedido").

| Dado | Onde fica | Estratégia |
|---|---|---|
| Status atual | Campo `status` em `orders` | Campo simples (indexado na Tarefa 3) |
| Histórico de mudanças | Array `statusHistory` dentro de `orders` | **Embedding** (array limitado) |
| Usuário responsável | `changedBy` com `userId` e nome | **Referencing** para `users` + nome copiado (*extended reference*) |

### Coleção `orders` (alterada)

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

### Mudança de status (atômica, com validação da transição)

```js
db.orders.updateOne(
  { _id: orderId, status: "PAID" },              // só avança se o status atual for o esperado
  { $set:  { status: "SHIPPED" },
    $push: { statusHistory: { from: "PAID", to: "SHIPPED", at: new Date(), changedBy } } }
);
```

O filtro `status: "PAID"` impede que duas atualizações concorrentes gravem transições inválidas, como `PENDING → DELIVERED`. Se o status atual não for o esperado, `modifiedCount` volta 0.

### E se a auditoria precisar ser ilimitada?

Se a regra de negócio mudar e passar a registrar **qualquer** evento (edição de endereço, reemissão de nota, tentativas de pagamento etc.), o array deixa de ser limitado. Nesse caso, o caminho é mover o log para uma coleção própria, `order_audit_logs`, com um documento por evento, `orderId` referenciado e índice `{ orderId: 1, at: 1 }`. Ela pode ter um índice TTL, se houver prazo de retenção. Em `orders` ficaria só o status atual e, no máximo, os últimos N eventos (o mesmo padrão Subset das reviews).

---

## 3. Como a modelagem evita o antipadrão *Unbounded Arrays*

Um documento no MongoDB tem limite de **16 MB**. O antipadrão é guardar em um array algo que cresce sem limite: por exemplo, todas as avaliações dentro do produto. Na escala do enunciado (dezenas de milhares de reviews com comentário), isso:

1. **estoura os 16 MB** e as escritas começam a falhar;
2. muito antes disso, **deixa a leitura lenta**: toda abertura da tela traz megabytes de dados que não serão exibidos;
3. **piora as escritas**: cada nova avaliação reescreve um documento enorme, e o documento é disputado por todas as gravações simultâneas.

Como esta modelagem resolve:

| Risco | Solução adotada |
|---|---|
| Reviews crescem sem limite | Ficam na coleção `reviews` (Referencing). O produto guarda **no máximo 10** (`$push` + `$slice: 10`) |
| Calcular média/total custaria um `$group` sobre milhares de docs | `ratingSummary` é **pré-calculado** a cada nova avaliação (Computed Pattern) |
| Tamanho do documento `products` | Fica **constante**, alguns KB, não importa quantas avaliações existam |
| Histórico de status | É limitado pelo ciclo de vida do pedido (menos de 10 eventos). Se deixar de ser, vai para `order_audit_logs` |
| "Ver todas as avaliações" | Consulta paginada em `reviews`, usando o índice `{ productId: 1, createdAt: -1 }` |

**Resultado:** a tela do produto faz **1 leitura por `_id`** e já recebe média, total e as 10 últimas avaliações. A consulta pesada (todas as avaliações) só acontece quando o usuário pede, paginada e indexada.

> A demonstração executável desta modelagem está em [`demo.js`](demo.js) (`node tarefa1/demo.js`). Ela insere 25 avaliações, mostra que o produto guarda só as 10 mais recentes com a média correta e registra as mudanças de status de um pedido.
