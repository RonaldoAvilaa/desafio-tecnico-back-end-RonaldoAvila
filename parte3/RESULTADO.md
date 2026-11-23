# Parte 2 - Resultado dos testes da API

Servidor testado: `http://localhost:3000`

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
  "nome": "Loja Tech",
  "tipo": "vendedor",
  "_id": "6b00f2b7cb0623323b04d9be",
  "createdAt": "2026-11-21T01:24:07.308Z",
  "updatedAt": "2026-11-21T01:24:07.308Z",
  "__v": 0
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
  "nome": "João Silva",
  "tipo": "comprador",
  "_id": "6b00f2b7cb0623323b04d9bf",
  "createdAt": "2026-11-21T01:24:07.363Z",
  "updatedAt": "2026-11-21T01:24:07.363Z",
  "__v": 0
}
```

## 3. Cadastrar um produto

`POST /produtos` com corpo:
```json
{
  "vendedorId": "6b00f2b7cb0623323b04d9be",
  "nome": "Teclado Mecânico",
  "preco": 250,
  "estoque": 5
}
```

Resposta: **HTTP 201**
```json
{
  "vendedorId": "6b00f2b7cb0623323b04d9be",
  "nome": "Teclado Mecânico",
  "preco": 250,
  "estoque": 5,
  "_id": "6b00f2b7cb0623323b04d9c0",
  "createdAt": "2026-11-21T01:24:07.392Z",
  "updatedAt": "2026-11-21T01:24:07.392Z",
  "__v": 0
}
```

## 4. Ver a vitrine

`GET /produtos`

Resposta: **HTTP 200**
```json
[
  {
    "_id": "6b00f2b7cb0623323b04d9c0",
    "vendedorId": {
      "_id": "6b00f2b7cb0623323b04d9be",
      "nome": "Loja Tech"
    },
    "nome": "Teclado Mecânico",
    "preco": 250,
    "estoque": 5,
    "createdAt": "2026-11-21T01:24:07.392Z",
    "updatedAt": "2026-11-21T01:24:07.392Z",
    "__v": 0
  }
]
```

## 5. Fazer uma compra

`POST /pedidos` com corpo:
```json
{
  "compradorId": "6b00f2b7cb0623323b04d9bf",
  "produtoId": "6b00f2b7cb0623323b04d9c0",
  "quantidade": 2
}
```

Resposta: **HTTP 201**
```json
{
  "compradorId": "6b00f2b7cb0623323b04d9bf",
  "produtoId": "6b00f2b7cb0623323b04d9c0",
  "quantidade": 2,
  "precoUnitario": 250,
  "valorTotal": 500,
  "_id": "6b00f2b7cb0623323b04d9c1",
  "data": "2026-11-21T01:24:07.454Z",
  "__v": 0,
  "estoqueRestante": 3
}
```

## 6. Conferir o estoque após a compra

`GET /produtos`

Resposta: **HTTP 200**
```json
[
  {
    "_id": "6b00f2b7cb0623323b04d9c0",
    "vendedorId": {
      "_id": "6b00f2b7cb0623323b04d9be",
      "nome": "Loja Tech"
    },
    "nome": "Teclado Mecânico",
    "preco": 250,
    "estoque": 3,
    "createdAt": "2026-11-21T01:24:07.392Z",
    "updatedAt": "2026-11-21T01:24:07.437Z",
    "__v": 0
  }
]
```

## Extra: compra acima do estoque deve falhar

`POST /pedidos` com corpo:
```json
{
  "compradorId": "6b00f2b7cb0623323b04d9bf",
  "produtoId": "6b00f2b7cb0623323b04d9c0",
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
  "vendedorId": "6b00f2b7cb0623323b04d9bf",
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
