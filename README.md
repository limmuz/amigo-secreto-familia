# Amigo Secreto da Família

Site de sorteio de amigo secreto com cadastro, lista de presentes e perfil.

- Quem organiza cria o sorteio e envia o link de convite.
- Cada pessoa se cadastra (nome, PIN de 4 números e lista de presentes).
- Quem organiza realiza o sorteio quando quiser.
- Cada pessoa volta pelo link, entra com nome e PIN e vê quem tirou e a lista dessa pessoa.

Regras do sorteio: ninguém tira a si mesmo, ninguém é tirado por duas pessoas e cada um tira exatamente uma pessoa.

## Publicação (Vercel)

1. Importe este repositório na Vercel.
2. Em **Storage**, conecte um banco **Upstash for Redis** (gratuito) ao projeto.
3. Faça um novo deploy. As variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` são criadas pela integração.

## Teste local

```
npm install
node dev/server.mjs   # http://localhost:3456 (dados só em memória)
```
