/**
 * Gera os relatórios em Word (.docx) a partir dos arquivos .md de cada atividade,
 * acrescentando os prints reais da execução (pasta evidencias/).
 * Depois, scripts/converter-pdf.ps1 converte cada .docx em PDF usando o Word.
 *
 * Rodar:  node scripts/gerar-relatorios.js
 * Opcional: defina ALUNO para incluir seu nome na capa, ex.:
 *   $env:ALUNO = "Seu Nome"; node scripts/gerar-relatorios.js
 *
 * Versão simples (sem capa, sem rodapé, sem fundo nos códigos e sem as datas de execução):
 *   node scripts/gerar-relatorios.js --simples      -> gera em relatorios_simples/
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, ImageRun, LevelFormat, PageBreak, Footer, PageNumber,
} = require('docx');

const RAIZ = path.join(__dirname, '..');
const EVID = path.join(RAIZ, 'evidencias');
const ALUNO = process.env.ALUNO || '';
const SIMPLES = process.argv.includes('--simples');
const PASTA_SIMPLES = path.join(RAIZ, 'relatorios_simples');
const DISCIPLINA = 'Banco de Dados Não Relacional';
const DESAFIO = 'Desafio Técnico Back-End: Engenharia de Dados com MongoDB';

// A4 com margens de 2 cm
const PAGE_W = 11906, MARGIN = 1134, CONTENT_W = PAGE_W - 2 * MARGIN;
const IMG_W_PX = 620; // largura da imagem no documento (px a 96 dpi ≈ 16,4 cm)
const FONT = 'Calibri', MONO = 'Consolas';
const COR = { titulo: '1F4E3D', destaque: '00684A', cinza: '595959', codigoFundo: 'F3F4F6', tabelaCab: 'E3F1EA', borda: 'BFBFBF' };

const ATIVIDADES = [
  {
    id: 'Parte2', titulo: 'Parte 2 — Testar a API', md: 'parte2/RESULTADO.md',
    evidencias: [
      ['parte2_1_terminal_inicio.jpg', 'Execução do teste (node parte2/testar-api.js) contra a API da Parte 1: criação do vendedor, do comprador, do produto e consulta da vitrine.'],
      ['parte2_2_terminal_fim.jpg', 'Final da execução: compra de 2 unidades, estoque reduzido de 5 para 3 e os casos de erro (estoque insuficiente e comprador tentando anunciar).'],
    ],
  },
  {
    id: 'Parte3', titulo: 'Parte 3 — Persistência de dados com MongoDB', md: 'parte3/RESULTADO.md',
    evidencias: [
      ['parte3_3_usuarios.jpg', 'MongoDB Compass — coleção marketplace.usuarios: o vendedor "Loja Tech" e o comprador "João Silva" gravados pela API.'],
      ['parte3_1_produtos_estoque3.jpg', 'MongoDB Compass — coleção marketplace.produtos: o "Teclado Mecânico" com estoque 3 após a compra de 2 unidades.'],
      ['parte3_2_pedidos.jpg', 'MongoDB Compass — coleção marketplace.pedidos: o pedido de 2 unidades com valor total de R$ 500.'],
    ],
  },
  {
    id: 'Parte4', titulo: 'Parte 4 — Script de Seed', md: 'parte4/AMOSTRA.md',
    evidencias: [
      ['parte4_1_banco_marketplace.jpg', 'MongoDB Compass — banco marketplace após o seed: orders com 100K documentos, products com 1K e users com 5K.'],
      ['parte4_2_documentos_orders.jpg', 'MongoDB Compass — documentos da coleção orders, com o array items expandido (productId, sku, category, unitPrice, quantity).'],
    ],
    nota: 'Observação: a contagem de orders aparece como 100.002 nos prints porque inclui 2 pedidos de teste gerados na Tarefa 4.',
  },
  {
    id: 'Tarefa1', titulo: 'Tarefa 1 — Modelagem e Evolução de Schema', md: 'tarefa1/SOLUCAO.md',
    evidencias: [
      ['tarefa1_1_banco_demo.jpg', 'MongoDB Compass — banco tarefa1_demo após executar node tarefa1/demo.js: 25 documentos em reviews e 1 produto.'],
      ['tarefa1_2_produto_resumo_reviews.jpg', 'Documento do produto: ratingSummary com count 25 e average 3, e recentReviews com exatamente 10 itens (as 25 avaliações completas ficam na coleção reviews).'],
      ['tarefa1_3_pedido_statusHistory.jpg', 'Pedido com o histórico de status embutido (statusHistory): cada mudança registra de/para, data e o responsável (changedBy).'],
    ],
  },
  {
    id: 'Tarefa2', titulo: 'Tarefa 2 — Aggregation Framework', md: 'tarefa2/RELATORIO.md',
    evidencias: [
      ['tarefa2_0_terminal.jpg', 'Execução de node tarefa2/pipelines.js: os dois relatórios calculados no MongoDB.'],
      ['tarefa2_1_pipeline_faturamento.jpg', 'MongoDB Compass (aba Aggregations) — pipeline 1, Faturamento por Categoria: $match → $unwind → $group → $project → $sort.'],
      ['tarefa2_2_resultado_faturamento.jpg', 'Resultado do pipeline 1 no Compass: faturamento e itens vendidos por categoria, do maior para o menor.'],
      ['tarefa2_3_pipeline_ranking_vip.jpg', 'MongoDB Compass — pipeline 2, Ranking VIP de São Paulo, com $facet (dados da página + contagem total) e $lookup em users.'],
      ['tarefa2_4_ranking_vip_top.jpg', 'Resultado do pipeline 2: primeiros clientes do ranking, com nome e e-mail vindos da coleção users.'],
      ['tarefa2_5_ranking_vip_total.jpg', 'Final do resultado do pipeline 2: o $facet devolve na mesma consulta o total de clientes elegíveis.'],
    ],
  },
  {
    id: 'Tarefa3', titulo: 'Tarefa 3 — Diagnóstico e Otimização de Performance', md: 'tarefa3/SOLUCAO.md',
    evidencias: [
      ['tarefa3_1_explain_antes_COLLSCAN.jpg', 'ANTES — Explain Plan no MongoDB Compass sem índice: COLLSCAN, 100.002 documentos examinados para retornar 572, ordenação em memória.'],
      ['tarefa3_2_indice_ESR_criado.jpg', 'Índice composto criado pela regra ESR: shippingCity ↑, status ↑, createdAt ↓ (aba Indexes).'],
      ['tarefa3_3_consulta_572_resultados.jpg', 'A consulta analisada no Compass (filtro + sort por createdAt), retornando 572 pedidos.'],
      ['tarefa3_4_explain_depois_IXSCAN.jpg', 'DEPOIS — Explain Plan com o índice: IXSCAN + FETCH, 572 documentos examinados para 572 retornados, sem ordenação em memória.'],
      ['tarefa3_0_terminal_explain.jpg', 'Execução de node tarefa3/otimizar.js: explain("executionStats") antes e depois do índice, com 5 medições de tempo cada.'],
    ],
  },
  {
    id: 'Tarefa4', titulo: 'Tarefa 4 — Consistência e Transações ACID', md: 'tarefa4/RESULTADO.md',
    evidencias: [
      ['tarefa4_0_terminal_6_cenarios.jpg', 'Execução de node tarefa4/testar-checkout.js: os 6 cenários com o estado antes e depois de cada um (6/6 OK).'],
      ['tarefa4_1_produtos_estoque.jpg', 'MongoDB Compass — produtos de teste após o checkout: Fone com estoque 3 (5 − 2) e Último item com estoque 0.'],
      ['tarefa4_2_usuarios_saldo.jpg', 'MongoDB Compass — saldos após o checkout: cliente com R$ 650 (1000 − 300 − 50) e o cliente de saldo baixo intacto em R$ 100.'],
      ['tarefa4_3_pedidos_PAID.jpg', 'MongoDB Compass — somente os 2 pedidos confirmados foram gravados, ambos com status PAID. Os cenários com rollback não deixaram pedidos.'],
    ],
  },
];

// ---------------------------------------------------------------------------
// Markdown -> elementos docx
// ---------------------------------------------------------------------------
function inline(texto, base = {}) {
  // remove links markdown mantendo o texto e o escape de crase
  texto = texto.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\\`/g, '`');
  const runs = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let ultimo = 0, m;
  while ((m = re.exec(texto))) {
    if (m.index > ultimo) runs.push(new TextRun({ text: texto.slice(ultimo, m.index), font: FONT, ...base }));
    const t = m[0];
    if (t.startsWith('**')) runs.push(...inline(t.slice(2, -2), { ...base, bold: true }));
    else runs.push(new TextRun({ text: t.slice(1, -1), font: MONO, size: (base.size || 22) - 2, color: 'B5223F', ...base, ...{ font: MONO } }));
    ultimo = m.index + t.length;
  }
  if (ultimo < texto.length) runs.push(new TextRun({ text: texto.slice(ultimo), font: FONT, ...base }));
  return runs;
}

function celula(texto, largura, cabecalho) {
  const alinhaDireita = /^-?[\d.,]+%?$|^R\$|^\*\*R\$/.test(texto.trim());
  return new TableCell({
    width: { size: largura, type: WidthType.DXA },
    shading: cabecalho ? { type: ShadingType.CLEAR, color: 'auto', fill: COR.tabelaCab } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: alinhaDireita && !cabecalho ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: inline(texto.trim(), { size: 18, bold: cabecalho || undefined }),
    })],
  });
}

function tabela(linhas) {
  const rows = linhas
    .filter((l) => !/^\|\s*:?-{2,}/.test(l.trim()))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|')));
  const nCol = Math.max(...rows.map((r) => r.length));
  // largura proporcional ao maior texto de cada coluna (mín. 8% da largura)
  const pesos = Array.from({ length: nCol }, (_, i) => Math.max(...rows.map((r) => (r[i] || '').length), 4));
  const soma = pesos.reduce((a, b) => a + b, 0);
  let larguras = pesos.map((p) => Math.max(Math.round((p / soma) * CONTENT_W), Math.round(CONTENT_W * 0.08)));
  const ajuste = CONTENT_W - larguras.reduce((a, b) => a + b, 0);
  larguras[larguras.indexOf(Math.max(...larguras))] += ajuste;
  const borda = { style: BorderStyle.SINGLE, size: 4, color: COR.borda };
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: larguras,
    borders: { top: borda, bottom: borda, left: borda, right: borda, insideHorizontal: borda, insideVertical: borda },
    rows: rows.map((r, i) => new TableRow({
      tableHeader: i === 0,
      cantSplit: true,
      children: Array.from({ length: nCol }, (_, c) => celula(r[c] || '', larguras[c], i === 0)),
    })),
  });
}

function blocoCodigo(linhas) {
  return linhas.map((l, i) => new Paragraph({
    shading: SIMPLES ? undefined : { type: ShadingType.CLEAR, color: 'auto', fill: COR.codigoFundo },
    spacing: { before: i === 0 ? 80 : 0, after: i === linhas.length - 1 ? 160 : 0, line: 240 },
    indent: { left: 120, right: 120 },
    children: [new TextRun({ text: l.replace(/\t/g, '  ') || ' ', font: MONO, size: 16 })],
  }));
}

function mdParaDocx(md) {
  const out = [];
  const linhas = md.replace(/\r/g, '').split('\n');
  let primeiroTitulo = true;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.startsWith('```')) {
      const bloco = [];
      for (i++; i < linhas.length && !linhas[i].startsWith('```'); i++) bloco.push(linhas[i]);
      // blocos de JSON muito longos (respostas brutas) são resumidos para não ocupar páginas
      if (bloco.length > 60) bloco.splice(45, bloco.length - 55, '  ... (trecho omitido — conteúdo completo no arquivo .md do zip) ...');
      out.push(...blocoCodigo(bloco));
    } else if (l.startsWith('|')) {
      const t = [];
      for (; i < linhas.length && linhas[i].startsWith('|'); i++) t.push(linhas[i]);
      i--;
      out.push(tabela(t), new Paragraph({ spacing: { after: 120 }, children: [] }));
    } else if (/^#\s/.test(l)) {
      if (primeiroTitulo) { primeiroTitulo = false; continue; } // o título vai na capa
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: inline(l.slice(2)) }));
    } else if (/^##\s/.test(l)) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: inline(l.slice(3)) }));
    } else if (/^###\s/.test(l)) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: inline(l.slice(4)) }));
    } else if (/^>\s?/.test(l)) {
      out.push(new Paragraph({
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: COR.destaque, space: 8 } },
        spacing: { before: 80, after: 120 },
        children: inline(l.replace(/^>\s?/, ''), { italics: true, color: COR.cinza }),
      }));
    } else if (/^\s*[-*]\s/.test(l)) {
      out.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: inline(l.replace(/^\s*[-*]\s/, '')) }));
    } else if (/^\d+\.\s/.test(l)) {
      out.push(new Paragraph({ indent: { left: 360, hanging: 360 }, spacing: { after: 60 }, children: inline(l) }));
    } else if (/^---+\s*$/.test(l) || !l.trim()) {
      continue;
    } else {
      out.push(new Paragraph({ spacing: { after: 120 }, children: inline(l) }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
function dimensoesJpg(buf) {
  for (let i = 2; i < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marcador = buf[i + 1];
    if (marcador >= 0xc0 && marcador <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: 1366, h: 768 };
}

function secaoEvidencias(atv) {
  const els = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Evidências da execução no MongoDB' })] }),
    new Paragraph({
      spacing: { after: 160 },
      children: inline('Prints reais tirados durante a execução, no **MongoDB Compass** (conexão **Desafio Técnico**: replica set local `rs0`, porta 27018) e no terminal. Os números dos prints conferem com as tabelas deste relatório.'),
    }),
  ];
  if (atv.nota) els.push(new Paragraph({ spacing: { after: 160 }, children: inline(atv.nota, { italics: true, color: COR.cinza }) }));
  atv.evidencias.forEach(([arquivo, legenda], i) => {
    const buf = fs.readFileSync(path.join(EVID, arquivo));
    const { w, h } = dimensoesJpg(buf);
    els.push(
      new Paragraph({
        alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 200, after: 60 },
        children: [new ImageRun({ type: 'jpg', data: buf, transformation: { width: IMG_W_PX, height: Math.round((IMG_W_PX * h) / w) },
          altText: { title: `Figura ${i + 1}`, description: legenda, name: arquivo } })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { after: 240 },
        children: [new TextRun({ text: `Figura ${i + 1} — `, bold: true, size: 18, font: FONT, color: COR.destaque }),
          ...inline(legenda, { size: 18, color: COR.cinza })],
      }),
    );
  });
  return els;
}

function capa(atv) {
  const linha = (texto, opts = {}) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: texto, font: FONT, ...opts })] });
  return [
    new Paragraph({ spacing: { before: 2400 }, children: [] }),
    linha(DISCIPLINA.toUpperCase(), { size: 22, color: COR.cinza, bold: true }),
    linha(DESAFIO, { size: 26, color: COR.cinza }),
    new Paragraph({ spacing: { before: 600 }, children: [] }),
    linha(atv.titulo, { size: 44, bold: true, color: COR.titulo }),
    linha('Relatório de resultados', { size: 28, color: COR.destaque }),
    new Paragraph({ spacing: { before: 1800 }, children: [] }),
    ...(ALUNO ? [linha(`Aluno: ${ALUNO}`, { size: 24 })] : []),
    linha(`Data: ${new Date().toLocaleDateString('pt-BR')}`, { size: 22, color: COR.cinza }),
    linha('Ambiente: Node.js + MongoDB 9.0 (replica set rs0) + MongoDB Compass', { size: 20, color: COR.cinza }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// Cabeçalho curto no topo da 1ª página (substitui a capa na versão simples)
function cabecalhoSimples(atv) {
  const linha = (texto, opts = {}, after = 40) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after }, children: [new TextRun({ text: texto, font: FONT, ...opts })] });
  return [
    linha(DISCIPLINA, { size: 22, bold: true, color: COR.cinza }),
    linha(DESAFIO, { size: 22, color: COR.cinza }),
    linha(atv.titulo, { size: 32, bold: true, color: COR.titulo }, 20),
    linha('Relatório', { size: 24, color: COR.destaque }),
    ...(ALUNO ? [linha(`Aluno: ${ALUNO}`, { size: 20, color: COR.cinza })] : []),
    linha(`Data: ${new Date().toLocaleDateString('pt-BR')}`, { size: 20, color: COR.cinza }, 240),
  ];
}

// Tira do texto os carimbos "gerado/executado em DD/MM/AAAA, HH:MM:SS"
function semDatasDeExecucao(md) {
  return md
    .replace(/(Executado) em \d{2}\/\d{2}\/\d{4},? [\d:]+ (contra)/g, '$1 $2')
    .replace(/\s*[—-]\s*(executado|gerado) em \d{2}\/\d{2}\/\d{4},? [\d:]+/gi, '')
    .replace(/\s*(Gerado|Executado) em \d{2}\/\d{2}\/\d{4},? [\d:]+\.?/g, '');
}

async function gerar(atv) {
  let md = fs.readFileSync(path.join(RAIZ, atv.md), 'utf8');
  if (SIMPLES) md = semDatasDeExecucao(md);
  const doc = new Document({
    creator: ALUNO || 'Aluno',
    title: `${atv.titulo} — ${DESAFIO}`,
    styles: {
      default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 276 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: FONT, size: 30, bold: true, color: COR.titulo },
          paragraph: { spacing: { before: 360, after: 140 }, keepNext: true, outlineLevel: 0,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COR.destaque, space: 4 } } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: FONT, size: 25, bold: true, color: COR.destaque },
          paragraph: { spacing: { before: 240, after: 100 }, keepNext: true, outlineLevel: 1 } },
      ],
    },
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 540, hanging: 270 }, spacing: { after: 60 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      footers: SIMPLES ? undefined : { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
        new TextRun({ text: `${atv.titulo}  |  página `, size: 16, color: COR.cinza, font: FONT }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: COR.cinza, font: FONT }),
      ] })] }) },
      children: [...(SIMPLES ? cabecalhoSimples(atv) : capa(atv)), ...mdParaDocx(md), ...secaoEvidencias(atv)],
    }],
  });
  if (SIMPLES) fs.mkdirSync(PASTA_SIMPLES, { recursive: true });
  const destino = SIMPLES
    ? path.join(PASTA_SIMPLES, `Relatorio_${atv.id}.docx`)
    : path.join(RAIZ, path.dirname(atv.md), `Relatorio_${atv.id}.docx`);
  fs.writeFileSync(destino, await Packer.toBuffer(doc));
  console.log('gerado', path.relative(RAIZ, destino));
}

(async () => {
  const filtro = process.argv.slice(2).find((a) => !a.startsWith('--'));
  for (const atv of ATIVIDADES) if (!filtro || atv.id === filtro) await gerar(atv);
})().catch((e) => { console.error(e); process.exit(1); });
