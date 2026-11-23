/**
 * Tarefa 4 - Cenários de teste do checkout transacional.
 * Cria um produto e usuários de teste com valores conhecidos, executa os
 * cenários, confere estoque/saldo/pedidos após cada um e apaga os dados de teste.
 *
 * Rodar:  node tarefa4/testar-checkout.js
 * Gera:   tarefa4/RESULTADO.md
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { checkout } = require('./checkout');

const client = new MongoClient(process.env.MONGO_URI);
const db = client.db('marketplace');
const products = db.collection('products');
const users = db.collection('users');
const orders = db.collection('orders');

const PRODUTO = { _id: new ObjectId(), sku: 'SKU-T4-001', name: 'Fone Bluetooth (teste T4)', category: 'Eletrônicos', price: 150, stock: 5, sellerId: 'SELLER-1', active: true };
const RICO = { _id: new ObjectId(), name: 'Cliente Teste Rico', email: 'teste.rico@exemplo.com', city: 'São Paulo', walletBalance: 1000, createdAt: new Date() };
const POBRE = { _id: new ObjectId(), name: 'Cliente Teste Saldo Baixo', email: 'teste.pobre@exemplo.com', city: 'Recife', walletBalance: 100, createdAt: new Date() };
const ULTIMO = { _id: new ObjectId(), sku: 'SKU-T4-002', name: 'Último item (teste T4)', category: 'Livros', price: 50, stock: 1, sellerId: 'SELLER-1', active: true };

async function estado() {
  const [p, u1, u2, ult, nPedidos] = await Promise.all([
    products.findOne({ _id: PRODUTO._id }),
    users.findOne({ _id: RICO._id }),
    users.findOne({ _id: POBRE._id }),
    products.findOne({ _id: ULTIMO._id }),
    orders.countDocuments({ userId: { $in: [RICO._id, POBRE._id] } }),
  ]);
  return { estoqueFone: p.stock, estoqueUltimo: ult.stock, saldoRico: u1.walletBalance, saldoPobre: u2.walletBalance, pedidos: nPedidos };
}

const resultados = [];
async function cenario(nome, esperado, fn, conferir) {
  const antes = await estado();
  let saida;
  try {
    const r = await fn();
    saida = { ok: true, detalhe: Array.isArray(r) ? r.map((x) => x.status).join(' | ') : `Pedido ${r._id} criado (PAID, total R$ ${r.totalAmount})` };
  } catch (e) {
    saida = { ok: false, detalhe: `${e.codigo || e.codeName || e.name}: ${e.message}` };
  }
  const depois = await estado();
  const passou = conferir(antes, depois, saida);
  resultados.push({ nome, esperado, saida, antes, depois, passou });
  console.log(`\n${passou ? '✅' : '❌'} ${nome}`);
  console.log(`   resultado: ${saida.detalhe}`);
  console.log('   antes :', JSON.stringify(antes));
  console.log('   depois:', JSON.stringify(depois));
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function limparExecucaoAnterior() {
  const antigos = await users.find({ email: { $in: [RICO.email, POBRE.email] } }, { projection: { _id: 1 } }).toArray();
  await orders.deleteMany({ userId: { $in: antigos.map((u) => u._id) } });
  await users.deleteMany({ email: { $in: [RICO.email, POBRE.email] } });
  await products.deleteMany({ sku: { $in: [PRODUTO.sku, ULTIMO.sku] } });
}

(async () => {
  await client.connect();
  await limparExecucaoAnterior();
  await products.insertMany([PRODUTO, ULTIMO]);
  await users.insertMany([RICO, POBRE]);

  try {
    await cenario('1. Compra válida (2 × R$ 150 = R$ 300)', 'Commit: estoque 5→3, saldo 1000→700, +1 pedido PAID',
      () => checkout(client, { userId: RICO._id, productId: PRODUTO._id, quantity: 2 }),
      (a, d, s) => s.ok && d.estoqueFone === a.estoqueFone - 2 && d.saldoRico === a.saldoRico - 300 && d.pedidos === a.pedidos + 1);

    await cenario('2. Estoque insuficiente (pede 10, há 3)', 'Rollback: nada muda',
      () => checkout(client, { userId: RICO._id, productId: PRODUTO._id, quantity: 10 }),
      (a, d, s) => !s.ok && igual(a, d));

    await cenario('3. Saldo insuficiente (R$ 100 para comprar R$ 150)', 'Rollback: nada muda',
      () => checkout(client, { userId: POBRE._id, productId: PRODUTO._id, quantity: 1 }),
      (a, d, s) => !s.ok && igual(a, d));

    await cenario('4. Produto inexistente', 'Rollback: nada muda',
      () => checkout(client, { userId: RICO._id, productId: new ObjectId(), quantity: 1 }),
      (a, d, s) => !s.ok && igual(a, d));

    await cenario('5. Erro no meio do processo (após debitar estoque e saldo)', 'abortTransaction desfaz os dois débitos',
      () => checkout(client, { userId: RICO._id, productId: PRODUTO._id, quantity: 1 }, { falharAntesDeInserirPedido: true }),
      (a, d, s) => !s.ok && igual(a, d));

    await cenario('6. Concorrência: 2 compras simultâneas do último item', 'Só uma compra confirma; estoque 1→0, nunca negativo',
      async () => {
        const rs = await Promise.allSettled([
          checkout(client, { userId: RICO._id, productId: ULTIMO._id, quantity: 1 }),
          checkout(client, { userId: RICO._id, productId: ULTIMO._id, quantity: 1 }),
        ]);
        return rs.map((r) => ({ status: r.status === 'fulfilled' ? 'confirmada' : `abortada (${r.reason.codeName || r.reason.codigo || r.reason.message})` }));
      },
      (a, d, s) => s.ok && d.estoqueUltimo === 0 && d.pedidos === a.pedidos + 1 && d.saldoRico === a.saldoRico - 50);
  } finally {
    // Os dados de teste ficam no banco como evidência (consultáveis no Compass);
    // são removidos automaticamente no início da próxima execução.
  }

  const todos = resultados.every((r) => r.passou);
  console.log(`\n${resultados.filter((r) => r.passou).length}/${resultados.length} cenários OK`);

  const md = `# Tarefa 4 — Consistência e Transações ACID (Checkout)

Executado contra um MongoDB em **replica set** (\`rs0\`). Transações multi-documento não funcionam em instância standalone.

## Implementação

Arquivo [\`checkout.js\`](checkout.js), função \`checkout(client, { userId, productId, quantity })\`:

\`\`\`text
startTransaction (readConcern: snapshot, writeConcern: majority)
 1. products.findOne        -> existe? stock >= quantity?       (senão: erro)
 2. users.findOne           -> walletBalance >= price*quantity? (senão: erro)
 3. products.updateOne $inc  { stock: -quantity }
 4. users.updateOne    $inc  { walletBalance: -total }
 5. orders.insertOne         { status: "PAID", ... }
commitTransaction
-- qualquer erro em qualquer passo --> abortTransaction (rollback)
\`\`\`

Pontos importantes:
- Todas as operações recebem a mesma \`session\`. É isso que as coloca dentro da transação.
- Os \`updateOne\` repetem a condição (\`stock: { $gte: quantity }\` e \`walletBalance: { $gte: total }\`) como segunda barreira contra concorrência.
- Se duas transações alteram o mesmo documento ao mesmo tempo, o MongoDB aborta uma delas com \`WriteConflict\`. O cenário 6 comprova isso.
- O bloco \`catch\` chama \`session.abortTransaction()\` explicitamente, e o \`finally\` encerra a sessão.

## Cenários testados — ${resultados.filter((r) => r.passou).length}/${resultados.length} OK

Dados de teste: produto "Fone" (R$ 150, estoque 5), produto "Último item" (R$ 50, estoque 1), cliente com saldo R$ 1.000 e cliente com saldo R$ 100.

| Cenário | Esperado | Resultado obtido | Estado antes → depois | OK |
|---|---|---|---|:-:|
${resultados.map((r) => `| ${r.nome} | ${r.esperado} | ${r.saida.detalhe.replace(/\|/g, '/')} | estoque Fone ${r.antes.estoqueFone}→${r.depois.estoqueFone}, Último ${r.antes.estoqueUltimo}→${r.depois.estoqueUltimo}; saldo ${r.antes.saldoRico}→${r.depois.saldoRico} / ${r.antes.saldoPobre}→${r.depois.saldoPobre}; pedidos ${r.antes.pedidos}→${r.depois.pedidos} | ${r.passou ? '✅' : '❌'} |`).join('\n')}

**Destaque — cenário 5:** o erro acontece **depois** que o estoque e o saldo já foram debitados dentro da transação. Mesmo assim, o estado depois é idêntico ao de antes: o \`abortTransaction()\` desfez os dois débitos e nenhum pedido foi criado. Sem transação, o cliente perderia o dinheiro e o estoque sem receber o pedido.

Os dados de teste (SKUs \`SKU-T4-001\`/\`SKU-T4-002\` e os e-mails \`teste.rico@exemplo.com\`/\`teste.pobre@exemplo.com\`) ficam gravados no banco como evidência e são substituídos a cada nova execução. O restante do seed da Parte 4 não é alterado.
`;
  fs.writeFileSync(path.join(__dirname, 'RESULTADO.md'), md);
  console.log('Relatório salvo em tarefa4/RESULTADO.md');
  await client.close();
  process.exit(todos ? 0 : 1);
})().catch(async (e) => { console.error(e); await client.close(); process.exit(1); });
