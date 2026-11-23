/**
 * Tarefa 4 - Consistência e Transações ACID: checkout atômico.
 *
 * checkout({ userId, productId, quantity }) executa numa única transação:
 *   1. verifica se o produto existe e se stock >= quantity
 *   2. verifica se o usuário tem walletBalance >= price * quantity
 *   3. debita o estoque do produto ($inc)
 *   4. debita o saldo da carteira do usuário ($inc)
 *   5. insere o pedido em orders com status "PAID"
 * Qualquer falha -> abortTransaction(): nada do que foi feito é gravado.
 *
 * Requer MongoDB em replica set (transações não funcionam em standalone).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { MongoClient, ObjectId } = require('mongodb');

class ErroCheckout extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo;
  }
}

const centavos = (v) => Math.round(v * 100) / 100;

const OPCOES_TRANSACAO = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

/**
 * @param {MongoClient} client
 * @param {{userId: ObjectId|string, productId: ObjectId|string, quantity: number}} dados
 * @param {{falharAntesDeInserirPedido?: boolean}} [opcoes] usado só para demonstrar o rollback
 */
async function checkout(client, { userId, productId, quantity }, opcoes = {}) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ErroCheckout('QUANTIDADE_INVALIDA', 'quantity deve ser um inteiro maior que zero.');
  }
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(productId)) {
    throw new ErroCheckout('ID_INVALIDO', 'userId ou productId inválido.');
  }
  userId = new ObjectId(userId);
  productId = new ObjectId(productId);

  const db = client.db('marketplace');
  const products = db.collection('products');
  const users = db.collection('users');
  const orders = db.collection('orders');

  const session = client.startSession();
  try {
    session.startTransaction(OPCOES_TRANSACAO);

    // 1. Produto existe e tem estoque?
    const produto = await products.findOne({ _id: productId }, { session });
    if (!produto) throw new ErroCheckout('PRODUTO_INEXISTENTE', 'Produto não encontrado.');
    if (produto.stock < quantity) {
      throw new ErroCheckout('ESTOQUE_INSUFICIENTE', `Estoque insuficiente (disponível: ${produto.stock}).`);
    }

    // 2. Usuário existe e tem saldo?
    const total = centavos(produto.price * quantity);
    const usuario = await users.findOne({ _id: userId }, { session });
    if (!usuario) throw new ErroCheckout('USUARIO_INEXISTENTE', 'Usuário não encontrado.');
    if (usuario.walletBalance < total) {
      throw new ErroCheckout('SALDO_INSUFICIENTE', `Saldo insuficiente (saldo: ${usuario.walletBalance}, total: ${total}).`);
    }

    // 3. Debita o estoque. A condição no filtro é uma segunda barreira: se outra
    //    transação mexeu no documento, o MongoDB detecta o conflito de escrita.
    const r1 = await products.updateOne(
      { _id: productId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { session },
    );
    if (r1.modifiedCount !== 1) throw new ErroCheckout('ESTOQUE_INSUFICIENTE', 'Estoque alterado durante o checkout.');

    // 4. Debita a carteira
    const r2 = await users.updateOne(
      { _id: userId, walletBalance: { $gte: total } },
      { $inc: { walletBalance: -total } },
      { session },
    );
    if (r2.modifiedCount !== 1) throw new ErroCheckout('SALDO_INSUFICIENTE', 'Saldo alterado durante o checkout.');

    if (opcoes.falharAntesDeInserirPedido) {
      throw new Error('Falha simulada no meio do processo (ex.: queda de rede).');
    }

    // 5. Cria o pedido já pago
    const pedido = {
      userId,
      shippingCity: usuario.city,
      status: 'PAID',
      items: [{ productId, sku: produto.sku, category: produto.category, unitPrice: produto.price, quantity }],
      totalAmount: total,
      createdAt: new Date(),
    };
    const { insertedId } = await orders.insertOne(pedido, { session });

    await session.commitTransaction();
    return { _id: insertedId, ...pedido };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction(); // ROLLBACK
    throw err;
  } finally {
    await session.endSession();
  }
}

module.exports = { checkout, ErroCheckout };
