/**
 * Parte 4 - Script de Seed: 1.000 produtos, 5.000 usuários e 100.000 pedidos.
 *
 * Mesma estrutura de dados do seed.txt do professor (propositalmente SEM
 * índices secundários — eles são criados e analisados na Tarefa 3).
 * Refatorações:
 *  - URI lida do .env (MONGO_URI), em vez de fixa no código;
 *  - apaga só as coleções do seed (products, users, orders) em vez de
 *    dropDatabase(), para não destruir os dados da API da Parte 3;
 *  - insertMany com ordered:false (mais rápido) e tempo total medido;
 *  - ao final gera parte4/AMOSTRA.md com contagens e documentos de exemplo.
 *
 * Rodar:  node parte4/seed.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const URI = process.env.MONGO_URI || 'mongodb://localhost:27017/?replicaSet=rs0';
const DB_NAME = 'marketplace';

const CATEGORIES = ['Eletrônicos', 'Livros', 'Casa e Cozinha', 'Esportes', 'Moda'];
const STATUSES = ['PAID', 'PENDING', 'SHIPPED', 'DELIVERED', 'CANCELED'];
const CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Recife'];

const TOTAL_PRODUCTS = 1000;
const TOTAL_USERS = 5000;
const TOTAL_ORDERS = 100000;
const BATCH_SIZE = 10000;
const DAY = 86400000;

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
const money = (v) => Number(v.toFixed(2));

function gerarProdutos() {
  return Array.from({ length: TOTAL_PRODUCTS }, (_, k) => {
    const i = k + 1;
    return {
      _id: new ObjectId(),
      sku: `SKU-${String(i).padStart(5, '0')}`,
      name: `Produto Exemplo ${i}`,
      category: randomItem(CATEGORIES),
      price: money(Math.random() * 500 + 20),
      stock: randomInt(10, 500),
      sellerId: `SELLER-${randomInt(1, 50)}`,
      active: Math.random() > 0.1,
    };
  });
}

function gerarUsuarios() {
  return Array.from({ length: TOTAL_USERS }, (_, k) => {
    const i = k + 1;
    return {
      _id: new ObjectId(),
      name: `Cliente ${i}`,
      email: `cliente${i}@exemplo.com`,
      city: randomItem(CITIES),
      walletBalance: money(Math.random() * 2000 + 100),
      createdAt: new Date(Date.now() - randomInt(0, 365) * DAY),
    };
  });
}

function gerarPedido(users, products) {
  const user = randomItem(users);
  const items = Array.from({ length: randomInt(1, 4) }, () => {
    const prod = randomItem(products);
    return {
      productId: prod._id,
      sku: prod.sku,
      category: prod.category,
      unitPrice: prod.price,
      quantity: randomInt(1, 3),
    };
  });
  const totalAmount = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  return {
    userId: user._id,
    shippingCity: user.city,
    status: randomItem(STATUSES),
    items,
    totalAmount: money(totalAmount),
    createdAt: new Date(Date.now() - randomInt(0, 180) * DAY),
  };
}

async function gerarAmostra(db) {
  const [nProd, nUsers, nOrders, porStatus, porCidade, idx] = await Promise.all([
    db.collection('products').countDocuments(),
    db.collection('users').countDocuments(),
    db.collection('orders').countDocuments(),
    db.collection('orders').aggregate([{ $group: { _id: '$status', total: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
    db.collection('orders').aggregate([{ $group: { _id: '$shippingCity', total: { $sum: 1 } } }, { $sort: { total: -1 } }]).toArray(),
    db.collection('orders').indexes(),
  ]);
  const amostra = async (nome) => db.collection(nome).find().limit(2).toArray();
  const bloco = (obj) => ['```json', JSON.stringify(obj, null, 2), '```'].join('\n');

  const md = `# Parte 4 - Amostra do banco instanciado

Banco: \`${DB_NAME}\` — gerado em ${new Date().toLocaleString('pt-BR')}

## Contagem de documentos

| Coleção | Documentos |
|---|---|
| products | ${nProd.toLocaleString('pt-BR')} |
| users | ${nUsers.toLocaleString('pt-BR')} |
| orders | ${nOrders.toLocaleString('pt-BR')} |

## Pedidos por status
${porStatus.map((s) => `- **${s._id}**: ${s.total.toLocaleString('pt-BR')}`).join('\n')}

## Pedidos por cidade
${porCidade.map((s) => `- **${s._id}**: ${s.total.toLocaleString('pt-BR')}`).join('\n')}

## Índices existentes em \`orders\`
Apenas o índice padrão (\`_id\`) — sem índices secundários, como pede o enunciado:
${bloco(idx.map((i) => i.key))}

## Exemplos de \`products\`
${bloco(await amostra('products'))}

## Exemplos de \`users\`
${bloco(await amostra('users'))}

## Exemplos de \`orders\`
${bloco(await amostra('orders'))}
`;
  const arquivo = path.join(__dirname, 'AMOSTRA.md');
  fs.writeFileSync(arquivo, md);
  console.log(`Amostra salva em ${arquivo}`);
}

async function runSeed() {
  const client = new MongoClient(URI);
  const inicio = Date.now();
  try {
    await client.connect();
    console.log('Conectado ao MongoDB...');
    const db = client.db(DB_NAME);

    for (const nome of ['products', 'users', 'orders']) {
      await db.collection(nome).drop().catch(() => {}); // ignora "ns not found"
    }

    console.log(`Gerando ${TOTAL_PRODUCTS} produtos...`);
    const products = gerarProdutos();
    await db.collection('products').insertMany(products, { ordered: false });

    console.log(`Gerando ${TOTAL_USERS} usuários...`);
    const users = gerarUsuarios();
    await db.collection('users').insertMany(users, { ordered: false });

    console.log(`Gerando ${TOTAL_ORDERS} pedidos em lotes de ${BATCH_SIZE}...`);
    for (let feitos = 0; feitos < TOTAL_ORDERS; feitos += BATCH_SIZE) {
      const lote = Array.from({ length: BATCH_SIZE }, () => gerarPedido(users, products));
      await db.collection('orders').insertMany(lote, { ordered: false });
      console.log(`Inseridos ${feitos + BATCH_SIZE} pedidos...`);
    }

    console.log(`Seed finalizado com sucesso em ${((Date.now() - inicio) / 1000).toFixed(1)}s!`);
    await gerarAmostra(db);
  } catch (err) {
    console.error('Erro ao executar seed:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

runSeed();
