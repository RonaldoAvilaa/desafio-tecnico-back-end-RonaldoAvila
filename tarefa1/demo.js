/**
 * Tarefa 1 - Demonstração executável da modelagem descrita no SOLUCAO.md.
 * Usa um banco separado (tarefa1_demo) para não alterar os dados do seed.
 *
 * Rodar:  node tarefa1/demo.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { MongoClient, ObjectId } = require('mongodb');

const client = new MongoClient(process.env.MONGO_URI);
const db = client.db('tarefa1_demo');
const products = db.collection('products');
const reviews = db.collection('reviews');
const orders = db.collection('orders');

const RECENT_LIMIT = 10;

/** Grava a review completa e atualiza resumo + subconjunto do produto, na mesma transação. */
async function adicionarReview({ productId, userId, authorName, rating, comment }) {
  const review = { _id: new ObjectId(), productId, userId, authorName, rating, comment, createdAt: new Date() };
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await reviews.insertOne(review, { session });
      await products.updateOne({ _id: productId }, [
        { $set: {
          'ratingSummary.count': { $add: [{ $ifNull: ['$ratingSummary.count', 0] }, 1] },
          'ratingSummary.sum': { $add: [{ $ifNull: ['$ratingSummary.sum', 0] }, rating] },
        } },
        { $set: { 'ratingSummary.average': { $round: [{ $divide: ['$ratingSummary.sum', '$ratingSummary.count'] }, 2] } } },
      ], { session });
      const { productId: _p, _id: reviewId, ...resumo } = review;
      await products.updateOne({ _id: productId }, {
        $inc: { [`ratingSummary.distribution.${rating}`]: 1 },
        $push: { recentReviews: { $each: [{ reviewId, ...resumo }], $position: 0, $slice: RECENT_LIMIT } },
      }, { session });
    });
  } finally {
    await session.endSession();
  }
}

/** Avança o status somente se o status atual for o esperado, registrando a auditoria. */
async function mudarStatus(orderId, de, para, changedBy) {
  const r = await orders.updateOne(
    { _id: orderId, status: de },
    { $set: { status: para }, $push: { statusHistory: { from: de, to: para, at: new Date(), changedBy } } },
  );
  return r.modifiedCount === 1;
}

(async () => {
  await client.connect();
  await db.dropDatabase();
  await reviews.createIndex({ productId: 1, createdAt: -1 });
  await reviews.createIndex({ productId: 1, userId: 1 }, { unique: true });

  // --- Reviews ---
  const productId = new ObjectId();
  await products.insertOne({ _id: productId, sku: 'SKU-00042', name: 'Teclado Mecânico', price: 250, stock: 120 });

  const notas = [];
  for (let i = 1; i <= 25; i++) {
    const rating = (i % 5) + 1;
    notas.push(rating);
    await adicionarReview({ productId, userId: new ObjectId(), authorName: `Cliente ${i}`, rating, comment: `Comentário ${i}` });
  }

  const tela = await products.findOne({ _id: productId }, { projection: { name: 1, ratingSummary: 1, recentReviews: 1 } });
  const mediaEsperada = Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 100) / 100;

  console.log('=== Tela do produto (1 leitura por _id) ===');
  console.log('ratingSummary:', JSON.stringify(tela.ratingSummary));
  console.log('recentReviews (autores):', tela.recentReviews.map((r) => r.authorName).join(', '));
  console.log(`Total na coleção reviews: ${await reviews.countDocuments({ productId })}`);
  console.log(`Itens embutidos no produto: ${tela.recentReviews.length} (limite ${RECENT_LIMIT})`);
  console.log(`Média esperada ${mediaEsperada} | gravada ${tela.ratingSummary.average} -> ${mediaEsperada === tela.ratingSummary.average ? 'OK' : 'ERRO'}`);
  const tamanho = (await db.command({ collStats: 'products' })).avgObjSize;
  console.log(`Tamanho do documento do produto: ~${tamanho} bytes (constante, não cresce com o nº de reviews)`);

  // --- Auditoria de pedidos ---
  const orderId = new ObjectId();
  const cliente = { userId: new ObjectId(), name: 'Cliente 777', role: 'customer' };
  await orders.insertOne({
    _id: orderId, status: 'PENDING', totalAmount: 500, createdAt: new Date(),
    statusHistory: [{ from: null, to: 'PENDING', at: new Date(), changedBy: cliente }],
  });
  const sistema = { userId: null, name: 'gateway-pagamento', role: 'system' };
  const operador = { userId: new ObjectId(), name: 'Operador Logística', role: 'staff' };

  console.log('\n=== Auditoria de status do pedido ===');
  console.log('PENDING -> PAID     :', await mudarStatus(orderId, 'PENDING', 'PAID', sistema));
  console.log('PAID -> SHIPPED     :', await mudarStatus(orderId, 'PAID', 'SHIPPED', operador));
  console.log('PENDING -> DELIVERED (transição inválida, deve ser false):', await mudarStatus(orderId, 'PENDING', 'DELIVERED', operador));
  console.log('SHIPPED -> DELIVERED:', await mudarStatus(orderId, 'SHIPPED', 'DELIVERED', { userId: null, name: 'transportadora-api', role: 'system' }));

  const pedido = await orders.findOne({ _id: orderId });
  console.log(`Status atual: ${pedido.status}`);
  console.table(pedido.statusHistory.map((h) => ({ de: h.from, para: h.to, por: h.changedBy.name, quando: h.at.toISOString() })));

  await client.close();
})().catch(async (e) => {
  console.error(e);
  await client.close();
  process.exit(1);
});
