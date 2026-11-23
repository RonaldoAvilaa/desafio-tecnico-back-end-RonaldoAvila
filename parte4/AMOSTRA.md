# Parte 4 - Amostra do banco instanciado

Banco: `marketplace` — gerado em 20/11/2026, 22:24:39

## Contagem de documentos

| Coleção | Documentos |
|---|---|
| products | 1.000 |
| users | 5.000 |
| orders | 100.000 |

## Pedidos por status
- **CANCELED**: 19.951
- **DELIVERED**: 20.103
- **PAID**: 20.038
- **PENDING**: 20.212
- **SHIPPED**: 19.696

## Pedidos por cidade
- **Curitiba**: 17.856
- **São Paulo**: 16.720
- **Porto Alegre**: 16.696
- **Rio de Janeiro**: 16.655
- **Recife**: 16.217
- **Belo Horizonte**: 15.856

## Índices existentes em `orders`
Apenas o índice padrão (`_id`) — sem índices secundários, como pede o enunciado:
```json
[
  {
    "_id": 1
  }
]
```

## Exemplos de `products`
```json
[
  {
    "_id": "6b00f2d38eaf61f3cdd8726e",
    "sku": "SKU-00001",
    "name": "Produto Exemplo 1",
    "category": "Esportes",
    "price": 439.39,
    "stock": 237,
    "sellerId": "SELLER-16",
    "active": true
  },
  {
    "_id": "6b00f2d38eaf61f3cdd8726f",
    "sku": "SKU-00002",
    "name": "Produto Exemplo 2",
    "category": "Esportes",
    "price": 117.63,
    "stock": 298,
    "sellerId": "SELLER-16",
    "active": true
  }
]
```

## Exemplos de `users`
```json
[
  {
    "_id": "6b00f2d38eaf61f3cdd87656",
    "name": "Cliente 1",
    "email": "cliente1@exemplo.com",
    "city": "Curitiba",
    "walletBalance": 739.77,
    "createdAt": "2026-07-04T01:24:35.795Z"
  },
  {
    "_id": "6b00f2d38eaf61f3cdd87657",
    "name": "Cliente 2",
    "email": "cliente2@exemplo.com",
    "city": "Recife",
    "walletBalance": 1196.09,
    "createdAt": "2025-12-08T01:24:35.795Z"
  }
]
```

## Exemplos de `orders`
```json
[
  {
    "_id": "6b00f2d38eaf61f3cdd889de",
    "userId": "6b00f2d38eaf61f3cdd8805a",
    "shippingCity": "Curitiba",
    "status": "PAID",
    "items": [
      {
        "productId": "6b00f2d38eaf61f3cdd874fe",
        "sku": "SKU-00657",
        "category": "Eletrônicos",
        "unitPrice": 496.1,
        "quantity": 1
      },
      {
        "productId": "6b00f2d38eaf61f3cdd8755e",
        "sku": "SKU-00753",
        "category": "Moda",
        "unitPrice": 178.1,
        "quantity": 3
      },
      {
        "productId": "6b00f2d38eaf61f3cdd873c3",
        "sku": "SKU-00342",
        "category": "Casa e Cozinha",
        "unitPrice": 157.41,
        "quantity": 3
      }
    ],
    "totalAmount": 1502.63,
    "createdAt": "2026-06-30T01:24:35.917Z"
  },
  {
    "_id": "6b00f2d38eaf61f3cdd889df",
    "userId": "6b00f2d38eaf61f3cdd881e9",
    "shippingCity": "Belo Horizonte",
    "status": "PENDING",
    "items": [
      {
        "productId": "6b00f2d38eaf61f3cdd87270",
        "sku": "SKU-00003",
        "category": "Livros",
        "unitPrice": 330.84,
        "quantity": 3
      },
      {
        "productId": "6b00f2d38eaf61f3cdd872a2",
        "sku": "SKU-00053",
        "category": "Eletrônicos",
        "unitPrice": 257.36,
        "quantity": 2
      }
    ],
    "totalAmount": 1507.24,
    "createdAt": "2026-06-27T01:24:35.917Z"
  }
]
```
