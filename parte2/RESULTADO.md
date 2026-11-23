# Parte 2 - Resultado dos testes da API

Servidor testado: `http://localhost:3000` — executado em 22/11/2026, 14:04:42

## 1. Criar um vendedor

`POST /usuarios` com corpo:
```json
{
  "nome": "Loja Tech",
  "tipo": "vendedor"
}
```

Resposta: **HTTP 201**
```json
{
  "id": 1,
  "nome": "Loja Tech",
  "tipo": "vendedor"
}
```

## 2. Criar um comprador

`POST /usuarios` com corpo:
```json
{
  "nome": "João Silva",
  "tipo": "comprador"
}
```

Resposta: **HTTP 201**
```json
{
  "id": 2,
  "nome": "João Silva",
  "tipo": "comprador"
}
```

## 3. Cadastrar um produto

`POST /produtos` com corpo:
```json
{
  "vendedorId": 1,
  "nome": "Teclado Mecânico",
  "preco": 250,
  "estoque": 5
}
```

Resposta: **HTTP 201**
```json
{
  "id": 1,
  "vendedorId": 1,
  "nome": "Teclado Mecânico",
  "preco": 250,
  "estoque": 5
}
```

## 4. Ver a vitrine

`GET /produtos`

Resposta: **HTTP 200**
```json
[
  {
    "id": 1,
    "vendedorId": 1,
    "nome": "Teclado Mecânico",
    "preco": 250,
    "estoque": 5,
    "vendedor": "Loja Tech"
  }
]
```

## 5. Fazer uma compra

`POST /pedidos` com corpo:
```json
{
  "compradorId": 2,
  "produtoId": 1,
  "quantidade": 2
}
```

Resposta: **HTTP 201**
```json
{
  "id": 1,
  "compradorId": 2,
  "produtoId": 1,
  "quantidade": 2,
  "valorTotal": 500,
  "data": "2026-11-22T17:04:42.297Z",
  "estoqueRestante": 3
}
```

## 6. Conferir o estoque após a compra

`GET /produtos`

Resposta: **HTTP 200**
```json
[
  {
    "id": 1,
    "vendedorId": 1,
    "nome": "Teclado Mecânico",
    "preco": 250,
    "estoque": 3,
    "vendedor": "Loja Tech"
  }
]
```

## Extra: compra acima do estoque deve falhar

`POST /pedidos` com corpo:
```json
{
  "compradorId": 2,
  "produtoId": 1,
  "quantidade": 99
}
```

Resposta: **HTTP 400**
```json
{
  "erro": "Produto indisponível ou estoque insuficiente."
}
```

## Extra: comprador tentando anunciar deve falhar

`POST /produtos` com corpo:
```json
{
  "vendedorId": 2,
  "nome": "Mouse",
  "preco": 50,
  "estoque": 1
}
```

Resposta: **HTTP 403**
```json
{
  "erro": "Vendedor não encontrado ou sem permissão."
}
```

## Conclusão

Estoque do "Teclado Mecânico" após a compra de 2 unidades: **3** ✅ (5 − 2 = 3)
