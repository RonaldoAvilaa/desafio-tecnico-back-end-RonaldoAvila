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

  const md = `# Tarefa 4: Consistência e Transações ACID (Checkout)

Os testes foram feitos num MongoDB rodando como replica set (\`rs0\`), porque transação com vários documentos não funciona numa instância standalone.

## Como o checkout foi feito

O código está em \`tarefa4/checkout.js\`, na função \`checkout(client, { userId, productId, quantity })\`. Ela abre uma sessão, inicia a transação com read concern snapshot e write concern majority e faz estes passos:

1. busca o produto e confere se ele existe e se tem estoque suficiente;
2. busca o cliente e confere se o saldo da carteira cobre o preço vezes a quantidade;
3. tira a quantidade do estoque com \`$inc\`;
4. tira o valor do saldo do cliente com \`$inc\`;
5. cria o pedido com status PAID.

Se tudo der certo, chama \`commitTransaction()\`. Se qualquer passo der erro, o \`catch\` chama \`abortTransaction()\` e nada do que foi feito dentro da transação fica gravado. No \`finally\` a sessão é encerrada.

Todas as operações recebem a mesma \`session\`, que é o que coloca elas dentro da transação. Nos \`updateOne\` eu repeti a condição (\`stock: { $gte: quantity }\` e \`walletBalance: { $gte: total }\`) como uma segunda proteção para compras ao mesmo tempo. E se duas transações tentarem mudar o mesmo documento juntas, o MongoDB aborta uma delas com \`WriteConflict\`, que é o que aparece no cenário 6.

## Testes

Para testar criei dois produtos e dois clientes: o "Fone" (R$ 150, estoque 5), o "Último item" (R$ 50, estoque 1), um cliente com R$ 1.000 de saldo e outro com R$ 100. Foram ${resultados.length} cenários e ${resultados.filter((r) => r.passou).length} passaram.

${resultados.map((r) => `${r.nome}. Esperado: ${r.esperado}. Resultado: ${r.saida.detalhe} Estoque do Fone ${r.antes.estoqueFone} para ${r.depois.estoqueFone}, Último item ${r.antes.estoqueUltimo} para ${r.depois.estoqueUltimo}, saldos ${r.antes.saldoRico}/${r.antes.saldoPobre} para ${r.depois.saldoRico}/${r.depois.saldoPobre}, pedidos ${r.antes.pedidos} para ${r.depois.pedidos}. ${r.passou ? 'Passou.' : 'Falhou.'}`).join('\n\n')}

O cenário 5 é o mais importante. Nele o erro acontece depois que o estoque e o saldo já tinham sido descontados dentro da transação, e mesmo assim tudo voltou como estava antes: o \`abortTransaction()\` desfez os dois descontos e nenhum pedido foi criado. Sem transação, o cliente ficaria sem o dinheiro e sem o pedido.

Os dados de teste (SKUs \`SKU-T4-001\` e \`SKU-T4-002\`, e-mails \`teste.rico@exemplo.com\` e \`teste.pobre@exemplo.com\`) ficam no banco para dar para conferir no Compass, e são apagados e criados de novo a cada execução. O resto do seed da Parte 4 não é alterado.
`;
  fs.writeFileSync(path.join(__dirname, 'RESULTADO.md'), md);
  console.log('Relatório salvo em tarefa4/RESULTADO.md');
  await client.close();
  process.exit(todos ? 0 : 1);
})().catch(async (e) => { console.error(e); await client.close(); process.exit(1); });
