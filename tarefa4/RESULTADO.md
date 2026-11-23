# Tarefa 4: Consistência e Transações ACID (Checkout)

Os testes foram feitos num MongoDB rodando como replica set (`rs0`), porque transação com vários documentos não funciona numa instância standalone.

## Como o checkout foi feito

O código está em `tarefa4/checkout.js`, na função `checkout(client, { userId, productId, quantity })`. Ela abre uma sessão, inicia a transação com read concern snapshot e write concern majority e faz estes passos:

1. busca o produto e confere se ele existe e se tem estoque suficiente;
2. busca o cliente e confere se o saldo da carteira cobre o preço vezes a quantidade;
3. tira a quantidade do estoque com `$inc`;
4. tira o valor do saldo do cliente com `$inc`;
5. cria o pedido com status PAID.

Se tudo der certo, chama `commitTransaction()`. Se qualquer passo der erro, o `catch` chama `abortTransaction()` e nada do que foi feito dentro da transação fica gravado. No `finally` a sessão é encerrada.

Todas as operações recebem a mesma `session`, que é o que coloca elas dentro da transação. Nos `updateOne` eu repeti a condição (`stock: { $gte: quantity }` e `walletBalance: { $gte: total }`) como uma segunda proteção para compras ao mesmo tempo. E se duas transações tentarem mudar o mesmo documento juntas, o MongoDB aborta uma delas com `WriteConflict`, que é o que aparece no cenário 6.

## Testes

Para testar criei dois produtos e dois clientes: o "Fone" (R$ 150, estoque 5), o "Último item" (R$ 50, estoque 1), um cliente com R$ 1.000 de saldo e outro com R$ 100. Foram 6 cenários e os 6 passaram.

1. Compra válida (2 x R$ 150 = R$ 300). O pedido 6b0320beddba3f364cd6d2e4 foi criado como PAID, com total de R$ 300. O estoque do Fone foi de 5 para 3, o saldo do cliente de 1000 para 700 e entrou 1 pedido. Passou.

2. Estoque insuficiente (pediu 10, tinha 3). Deu o erro ESTOQUE_INSUFICIENTE ("Estoque insuficiente (disponível: 3)") e nada mudou no banco. Passou.

3. Saldo insuficiente (cliente com R$ 100 tentando comprar R$ 150). Deu o erro SALDO_INSUFICIENTE ("Saldo insuficiente (saldo: 100, total: 150)") e nada mudou. Passou.

4. Produto que não existe. Deu o erro PRODUTO_INEXISTENTE ("Produto não encontrado") e nada mudou. Passou.

5. Erro no meio do processo, depois de já ter tirado o estoque e o saldo. Simulei uma falha (como uma queda de rede) antes de criar o pedido. O estoque continuou 3, o saldo continuou 700 e nenhum pedido foi criado. Passou.

6. Duas compras ao mesmo tempo do último item. Uma foi confirmada e a outra foi abortada com WriteConflict. O estoque do "Último item" foi de 1 para 0 (sem ficar negativo), o saldo foi de 700 para 650 e entrou só 1 pedido. Passou.

O cenário 5 é o mais importante. Nele o erro acontece depois que o estoque e o saldo já tinham sido descontados dentro da transação, e mesmo assim tudo voltou como estava antes: o `abortTransaction()` desfez os dois descontos e nenhum pedido foi criado. Sem transação, o cliente ficaria sem o dinheiro e sem o pedido.

Os dados de teste (SKUs `SKU-T4-001` e `SKU-T4-002`, e-mails `teste.rico@exemplo.com` e `teste.pobre@exemplo.com`) ficam no banco para dar para conferir no Compass, e são apagados e criados de novo a cada execução. O resto do seed da Parte 4 não é alterado.
