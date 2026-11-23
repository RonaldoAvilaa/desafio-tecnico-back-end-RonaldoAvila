/**
 * Parte 1 - Marketplace simples (Node.js + Express) com armazenamento em memória.
 *
 * Refatoração do exemplo monolítico do professor:
 *  - "repositório" em memória isolado (fácil de trocar pelo MongoDB na Parte 3);
 *  - validação centralizada dos dados de entrada;
 *  - ids gerados por contador (o exemplo usava array.length + 1, que repete id
 *    se algum item for removido);
 *  - rotas extras de consulta (GET /usuarios, GET /pedidos, GET /produtos/:id);
 *  - tratamento de erro padronizado e de JSON inválido.
 *
 * Rodar:  node parte1/index.js   (porta 3000, ou PORT=xxxx)
 */
const express = require('express');

// ---------------------------------------------------------------------------
// "Banco de dados" em memória
// ---------------------------------------------------------------------------
function criarTabela() {
  let proximoId = 1;
  const linhas = [];
  return {
    inserir(dados) {
      const registro = { id: proximoId++, ...dados };
      linhas.push(registro);
      return registro;
    },
    buscarPorId: (id) => linhas.find((l) => l.id === id),
    listar: (filtro = () => true) => linhas.filter(filtro),
  };
}

const db = {
  usuarios: criarTabela(),
  produtos: criarTabela(),
  pedidos: criarTabela(),
};

const TIPOS_USUARIO = ['vendedor', 'comprador'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const inteiroPositivo = (v) => Number.isInteger(v) && v > 0;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// 1. Cadastrar usuário (vendedor ou comprador)
app.post('/usuarios', (req, res) => {
  const { nome, tipo } = req.body;
  if (!nome || typeof nome !== 'string' || !TIPOS_USUARIO.includes(tipo)) {
    throw new ErroHttp(400, 'Informe nome e tipo válido (vendedor/comprador).');
  }
  res.status(201).json(db.usuarios.inserir({ nome: nome.trim(), tipo }));
});

app.get('/usuarios', (req, res) => res.json(db.usuarios.listar()));

// 2. Anunciar produto (apenas vendedores)
app.post('/produtos', (req, res) => {
  const { vendedorId, nome, preco, estoque } = req.body;

  const vendedor = db.usuarios.buscarPorId(vendedorId);
  if (!vendedor || vendedor.tipo !== 'vendedor') {
    throw new ErroHttp(403, 'Vendedor não encontrado ou sem permissão.');
  }
  if (!nome || !(Number(preco) > 0) || !(Number.isInteger(Number(estoque)) && Number(estoque) >= 0)) {
    throw new ErroHttp(400, 'Informe nome, preco (> 0) e estoque (inteiro >= 0).');
  }

  const produto = db.produtos.inserir({
    vendedorId,
    nome,
    preco: Number(preco),
    estoque: Number(estoque),
  });
  res.status(201).json(produto);
});

// 3. Vitrine: produtos com estoque, já com o nome da loja
app.get('/produtos', (req, res) => {
  const vitrine = db.produtos
    .listar((p) => p.estoque > 0)
    .map((p) => ({ ...p, vendedor: db.usuarios.buscarPorId(p.vendedorId)?.nome }));
  res.json(vitrine);
});

app.get('/produtos/:id', (req, res) => {
  const produto = db.produtos.buscarPorId(Number(req.params.id));
  if (!produto) throw new ErroHttp(404, 'Produto não encontrado.');
  res.json(produto);
});

// 4. Realizar compra (apenas compradores)
app.post('/pedidos', (req, res) => {
  const { compradorId, produtoId, quantidade } = req.body;

  const comprador = db.usuarios.buscarPorId(compradorId);
  if (!comprador || comprador.tipo !== 'comprador') {
    throw new ErroHttp(403, 'Comprador inválido.');
  }
  if (!inteiroPositivo(quantidade)) {
    throw new ErroHttp(400, 'Quantidade deve ser um inteiro maior que zero.');
  }
  const produto = db.produtos.buscarPorId(produtoId);
  if (!produto || produto.estoque < quantidade) {
    throw new ErroHttp(400, 'Produto indisponível ou estoque insuficiente.');
  }

  produto.estoque -= quantidade;
  const pedido = db.pedidos.inserir({
    compradorId,
    produtoId,
    quantidade,
    valorTotal: produto.preco * quantidade,
    data: new Date().toISOString(),
  });
  res.status(201).json({ ...pedido, estoqueRestante: produto.estoque });
});

app.get('/pedidos', (req, res) => res.json(db.pedidos.listar()));

// Tratamento de erros (Express 5 captura exceções das rotas automaticamente)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido no corpo da requisição.' });
  }
  const status = err.status || 500;
  res.status(status).json({ erro: status === 500 ? 'Erro interno.' : err.message });
});

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Marketplace (memória) rodando em http://localhost:${PORT}`));
}

module.exports = app;
