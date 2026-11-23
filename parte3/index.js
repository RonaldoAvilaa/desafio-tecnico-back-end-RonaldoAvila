/**
 * Parte 3 - Persistência de dados com MongoDB (Mongoose + dotenv).
 *
 * Baseado no exemplo do professor (exemplo_mongodb.txt), com estas melhorias:
 *  - o servidor só sobe DEPOIS de conectar ao banco (no exemplo, a API aceitava
 *    requisições mesmo sem conexão);
 *  - validação de ObjectId para não devolver erro 500 com id malformado;
 *  - baixa de estoque ATÔMICA com findOneAndUpdate + $inc e condição
 *    { estoque: { $gte: quantidade } }. No exemplo havia "ler -> subtrair ->
 *    save()", que permite vender mais do que o estoque se duas compras chegarem
 *    ao mesmo tempo (condição de corrida);
 *  - timestamps automáticos, validação de preço/estoque no schema e o preço
 *    unitário gravado no pedido (histórico não muda se o preço mudar depois).
 *
 * Rodar:  node parte3/index.js   (lê MONGO_URI e PORT do arquivo .env)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const express = require('express');
const mongoose = require('mongoose');

const { Schema, model, isValidObjectId } = mongoose;

// --- MODELOS (SCHEMAS) ------------------------------------------------------
const Usuario = model('Usuario', new Schema({
  nome: { type: String, required: true, trim: true },
  tipo: { type: String, enum: ['vendedor', 'comprador'], required: true },
}, { timestamps: true }));

const Produto = model('Produto', new Schema({
  vendedorId: { type: Schema.Types.ObjectId, ref: 'Usuario', required: true },
  nome: { type: String, required: true, trim: true },
  preco: { type: Number, required: true, min: 0.01 },
  estoque: { type: Number, required: true, min: 0, validate: Number.isInteger },
}, { timestamps: true }));

const Pedido = model('Pedido', new Schema({
  compradorId: { type: Schema.Types.ObjectId, ref: 'Usuario', required: true },
  produtoId: { type: Schema.Types.ObjectId, ref: 'Produto', required: true },
  quantidade: { type: Number, required: true, min: 1 },
  precoUnitario: { type: Number, required: true },
  valorTotal: { type: Number, required: true },
  data: { type: Date, default: Date.now },
}));

// --- HELPERS ----------------------------------------------------------------
class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}
const exigirIds = (...ids) => {
  if (!ids.every(isValidObjectId)) throw new ErroHttp(400, 'Id inválido.');
};

// --- ROTAS ------------------------------------------------------------------
const app = express();
app.use(express.json());

// 1. Cadastrar usuário
app.post('/usuarios', async (req, res) => {
  const { nome, tipo } = req.body;
  res.status(201).json(await Usuario.create({ nome, tipo }));
});

app.get('/usuarios', async (req, res) => res.json(await Usuario.find().lean()));

// 2. Anunciar produto (apenas vendedores)
app.post('/produtos', async (req, res) => {
  const { vendedorId, nome, preco, estoque } = req.body;
  exigirIds(vendedorId);
  const vendedor = await Usuario.exists({ _id: vendedorId, tipo: 'vendedor' });
  if (!vendedor) throw new ErroHttp(403, 'Vendedor não encontrado ou sem permissão.');
  res.status(201).json(await Produto.create({ vendedorId, nome, preco, estoque }));
});

// 3. Vitrine (com o nome da loja via populate)
app.get('/produtos', async (req, res) => {
  const disponiveis = await Produto.find({ estoque: { $gt: 0 } })
    .populate('vendedorId', 'nome')
    .lean();
  res.json(disponiveis);
});

// 4. Realizar compra (apenas compradores)
app.post('/pedidos', async (req, res) => {
  const { compradorId, produtoId, quantidade } = req.body;
  exigirIds(compradorId, produtoId);
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new ErroHttp(400, 'Quantidade deve ser um inteiro maior que zero.');
  }

  const comprador = await Usuario.exists({ _id: compradorId, tipo: 'comprador' });
  if (!comprador) throw new ErroHttp(403, 'Comprador inválido.');

  // Verifica e baixa o estoque numa única operação atômica no banco.
  const produto = await Produto.findOneAndUpdate(
    { _id: produtoId, estoque: { $gte: quantidade } },
    { $inc: { estoque: -quantidade } },
    { new: true },
  );
  if (!produto) throw new ErroHttp(400, 'Produto indisponível ou estoque insuficiente.');

  const pedido = await Pedido.create({
    compradorId,
    produtoId,
    quantidade,
    precoUnitario: produto.preco,
    valorTotal: produto.preco * quantidade,
  });
  res.status(201).json({ ...pedido.toObject(), estoqueRestante: produto.estoque });
});

app.get('/pedidos', async (req, res) => {
  res.json(await Pedido.find().populate('compradorId', 'nome').populate('produtoId', 'nome').lean());
});

// --- ERROS ------------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: err.message });
  }
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ erro: status === 500 ? 'Erro interno.' : err.message });
});

// --- INICIALIZAÇÃO ----------------------------------------------------------
async function iniciar() {
  if (!process.env.MONGO_URI) throw new Error('Defina MONGO_URI no arquivo .env');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Conectado ao MongoDB com sucesso!');
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => console.log(`Marketplace (MongoDB) rodando em http://localhost:${PORT}`));
}

if (require.main === module) {
  iniciar().catch((err) => {
    console.error('Erro ao iniciar:', err.message);
    process.exit(1);
  });
}

module.exports = { app, Usuario, Produto, Pedido };
