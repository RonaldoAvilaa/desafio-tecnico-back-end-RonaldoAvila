# Tarefa 4 — Consistência e Transações ACID (Checkout)

Executado em 22/11/2026, 14:05:03 contra um MongoDB em **replica set** (`rs0`). Transações multi-documento não funcionam em instância standalone.

## Implementação

Arquivo [`checkout.js`](checkout.js), função `checkout(client, { userId, productId, quantity })`:

```text
startTransaction (readConcern: snapshot, writeConcern: majority)
 1. products.findOne        -> existe? stock >= quantity?       (senão: erro)
 2. users.findOne           -> walletBalance >= price*quantity? (senão: erro)
 3. products.updateOne $inc  { stock: -quantity }
 4. users.updateOne    $inc  { walletBalance: -total }
 5. orders.insertOne         { status: "PAID", ... }
commitTransaction
-- qualquer erro em qualquer passo --> abortTransaction (rollback)
```

Pontos importantes:
- Todas as operações recebem a mesma `session`. É isso que as coloca dentro da transação.
- Os `updateOne` repetem a condição (`stock: { $gte: quantity }` e `walletBalance: { $gte: total }`) como segunda barreira contra concorrência.
- Se duas transações alteram o mesmo documento ao mesmo tempo, o MongoDB aborta uma delas com `WriteConflict`. O cenário 6 comprova isso.
- O bloco `catch` chama `session.abortTransaction()` explicitamente, e o `finally` encerra a sessão.

## Cenários testados — 6/6 OK

Dados de teste: produto "Fone" (R$ 150, estoque 5), produto "Último item" (R$ 50, estoque 1), cliente com saldo R$ 1.000 e cliente com saldo R$ 100.

| Cenário | Esperado | Resultado obtido | Estado antes → depois | OK |
|---|---|---|---|:-:|
| 1. Compra válida (2 × R$ 150 = R$ 300) | Commit: estoque 5→3, saldo 1000→700, +1 pedido PAID | Pedido 6b0320beddba3f364cd6d2e4 criado (PAID, total R$ 300) | estoque Fone 5→3, Último 1→1; saldo 1000→700 / 100→100; pedidos 0→1 | ✅ |
| 2. Estoque insuficiente (pede 10, há 3) | Rollback: nada muda | ESTOQUE_INSUFICIENTE: Estoque insuficiente (disponível: 3). | estoque Fone 3→3, Último 1→1; saldo 700→700 / 100→100; pedidos 1→1 | ✅ |
| 3. Saldo insuficiente (R$ 100 para comprar R$ 150) | Rollback: nada muda | SALDO_INSUFICIENTE: Saldo insuficiente (saldo: 100, total: 150). | estoque Fone 3→3, Último 1→1; saldo 700→700 / 100→100; pedidos 1→1 | ✅ |
| 4. Produto inexistente | Rollback: nada muda | PRODUTO_INEXISTENTE: Produto não encontrado. | estoque Fone 3→3, Último 1→1; saldo 700→700 / 100→100; pedidos 1→1 | ✅ |
| 5. Erro no meio do processo (após debitar estoque e saldo) | abortTransaction desfaz os dois débitos | Error: Falha simulada no meio do processo (ex.: queda de rede). | estoque Fone 3→3, Último 1→1; saldo 700→700 / 100→100; pedidos 1→1 | ✅ |
| 6. Concorrência: 2 compras simultâneas do último item | Só uma compra confirma; estoque 1→0, nunca negativo | abortada (WriteConflict) / confirmada | estoque Fone 3→3, Último 1→0; saldo 700→650 / 100→100; pedidos 1→2 | ✅ |

**Destaque — cenário 5:** o erro acontece **depois** que o estoque e o saldo já foram debitados dentro da transação. Mesmo assim, o estado depois é idêntico ao de antes: o `abortTransaction()` desfez os dois débitos e nenhum pedido foi criado. Sem transação, o cliente perderia o dinheiro e o estoque sem receber o pedido.

Os dados de teste (SKUs `SKU-T4-001`/`SKU-T4-002` e os e-mails `teste.rico@exemplo.com`/`teste.pobre@exemplo.com`) ficam gravados no banco como evidência e são substituídos a cada nova execução. O restante do seed da Parte 4 não é alterado.
