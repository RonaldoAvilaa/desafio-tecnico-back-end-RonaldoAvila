/**
 * Parte 2 - Testa o fluxo da API na ordem pedida no enunciado
 * (substitui o Postman/Insomnia por um script reproduzível).
 *
 * Uso:  node parte2/testar-api.js [urlBase] [arquivoSaida.md]
 *       padrão: http://localhost:3000  e  parte2/RESULTADO.md
 *
 * Usa os ids devolvidos pela própria API, então funciona tanto com a Parte 1
 * (ids numéricos 1, 2, 1) quanto com a Parte 3 (ObjectIds do MongoDB).
 */
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:3000';
const SAIDA = process.argv[3] || path.join(__dirname, 'RESULTADO.md');
const id = (doc) => doc.id ?? doc._id;

const log = [];

async function chamar(titulo, metodo, rota, corpo) {
  const resp = await fetch(BASE + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await resp.json();
  console.log(`\n### ${titulo}\n${metodo} ${rota} -> HTTP ${resp.status}`);
  console.log(JSON.stringify(json, null, 2));
  log.push({ titulo, metodo, rota, corpo, status: resp.status, json });
  if (!resp.ok && !titulo.startsWith('Extra')) throw new Error(`${titulo} falhou (HTTP ${resp.status})`);
  return json;
}

(async () => {
  const vendedor = await chamar('1. Criar um vendedor', 'POST', '/usuarios', { nome: 'Loja Tech', tipo: 'vendedor' });
  const comprador = await chamar('2. Criar um comprador', 'POST', '/usuarios', { nome: 'João Silva', tipo: 'comprador' });
  const produto = await chamar('3. Cadastrar um produto', 'POST', '/produtos', {
    vendedorId: id(vendedor), nome: 'Teclado Mecânico', preco: 250, estoque: 5,
  });
  await chamar('4. Ver a vitrine', 'GET', '/produtos');
  await chamar('5. Fazer uma compra', 'POST', '/pedidos', {
    compradorId: id(comprador), produtoId: id(produto), quantidade: 2,
  });
  const vitrine = await chamar('6. Conferir o estoque após a compra', 'GET', '/produtos');

  // Casos de erro (regras de negócio)
  await chamar('Extra: compra acima do estoque deve falhar', 'POST', '/pedidos', {
    compradorId: id(comprador), produtoId: id(produto), quantidade: 99,
  });
  await chamar('Extra: comprador tentando anunciar deve falhar', 'POST', '/produtos', {
    vendedorId: id(comprador), nome: 'Mouse', preco: 50, estoque: 1,
  });

  const estoqueFinal = vitrine.find((p) => String(id(p)) === String(id(produto)))?.estoque;
  const ok = estoqueFinal === 3;
  console.log(`\nEstoque final do Teclado Mecânico: ${estoqueFinal} -> ${ok ? 'OK (5 - 2 = 3)' : 'ERRO'}`);

  const md = [
    `# Parte 2 - Resultado dos testes da API`,
    ``,
    `Servidor testado: \`${BASE}\``,
    ``,
    ...log.flatMap((l) => [
      `## ${l.titulo}`,
      ``,
      `\`${l.metodo} ${l.rota}\`${l.corpo ? ' com corpo:' : ''}`,
      ...(l.corpo ? ['```json', JSON.stringify(l.corpo, null, 2), '```'] : []),
      ``,
      `Resposta: **HTTP ${l.status}**`,
      '```json', JSON.stringify(l.json, null, 2), '```',
      ``,
    ]),
    `## Conclusão`,
    ``,
    `Estoque do "Teclado Mecânico" após a compra de 2 unidades: **${estoqueFinal}** ${ok ? '✅ (5 − 2 = 3)' : '❌'}`,
    ``,
  ].join('\n');
  fs.writeFileSync(SAIDA, md);
  console.log(`Relatório salvo em ${SAIDA}`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('Falha no teste:', e.message);
  process.exit(1);
});
