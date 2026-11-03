# FlagTrack — análise e evolução de atletas de Flag Football

PWA mobile-first para o atleta planejar a semana, manter a ofensiva diária, registrar
estatísticas de jogos, coletivos e desafios, e exportar relatórios PDF/Excel.

## Executar

Requisitos: Node.js 20+.

```bash
npm run setup      # instala dependências e cria o banco SQLite (server/prisma/dev.db)
npm run dev        # API em :3001 + interface em http://localhost:5173
npm test           # unitários (shared) + integração (server) com SQLite e com o banco em memória
npm run typecheck
```

Produção (um único processo serve API + PWA compilado):

```bash
npm run build      # gera web/dist
npm start          # usa PORT (padrão 3001)
```

Na primeira execução em desenvolvimento, `server/.env` recebe automaticamente
`JWT_SECRET` e as chaves VAPID de Web Push. Em produção elas são obrigatórias.

## Versão offline no celular (sem conta, sem internet)

Build alternativo em que **tudo roda no aparelho**: as mesmas rotas da API (`server/src/routes`)
são empacotadas no app e executadas sobre um banco em memória compatível com o Prisma
(`server/src/local-db/memory.ts`), salvo no IndexedDB do navegador. Não há login nem servidor.

```bash
npm run build:offline              # gera web/dist-offline (PWA estático)
npm run preview:offline -w web     # testa em http://localhost:4173
```

**Publicar no GitHub Pages:** crie um repositório, envie o código e em
*Settings → Pages → Source* escolha **GitHub Actions**. O workflow
`.github/workflows/pages.yml` roda os testes, gera o build com o caminho do repositório e publica.
No Android, abra o endereço no Chrome uma vez e use **Adicionar à tela inicial / Instalar app**;
depois disso o app abre e funciona sem internet. Os dados nunca saem do celular.

Diferenças do modo local:
- **Janela de 24h:** sem servidor não há relógio confiável; o app usa um relógio **monotônico**
  (o maior horário já visto). Atrasar o relógio do celular não reabre uma janela encerrada, e o app
  avisa quando detecta o relógio atrasado. Adiantar o relógio só prejudica o próprio atleta.
- **Lembretes:** aparecem com o app aberto (ou em segundo plano recente); não há Web Push.
- **Backup:** Configurações → *Fazer backup* / *Restaurar* (arquivo JSON). Desinstalar o app ou
  limpar os dados do site apaga os registros — faça backups. O app pede armazenamento persistente.
- Relatórios PDF/Excel são gerados no próprio aparelho.
- Os testes de integração rodam também contra o banco em memória (`npm run test:memory -w server`).

## Variáveis de ambiente (`server/.env`, ver `server/.env.example`)

| Variável | Uso |
|---|---|
| `DATABASE_URL` | `file:./dev.db` (SQLite) ou `postgresql://…` |
| `JWT_SECRET` | assinatura do cookie de sessão (httpOnly) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push (`npx web-push generate-vapid-keys`) |
| `PORT` | porta em produção (em dev a API usa `API_PORT` ou 3001) |

**PostgreSQL:** troque `provider = "sqlite"` por `"postgresql"` em `server/prisma/schema.prisma`,
ajuste `DATABASE_URL` e rode `npm run db:push -w server`. Nenhuma outra mudança é necessária.

## Publicação

Qualquer host Node (Render, Railway, Fly.io, VPS): `npm run setup && npm run build && npm start`
com as variáveis acima e HTTPS (necessário para cookie `secure`, service worker e push).
Para SQLite, use um volume persistente; para produção com vários usuários, prefira PostgreSQL.

## Arquitetura

```
shared/   Regras de negócio puras (TS) usadas pela API e pela UI
          time.ts (janela retroativa, fuso), streak.ts, stats.ts, challenges.ts,
          gamification.ts, schemas.ts (validação zod), constants.ts
server/   Express + Prisma. routes/ (REST), services/analytics.ts (totais/médias
          derivados dos registros), services/rewards.ts (XP/conquistas idempotentes),
          reports/ (PDF com pdfkit, XLSX com ExcelJS), push.ts (Web Push + agendador)
web/      React 18 + Vite + Tailwind + TanStack Query + Recharts; PWA (manifest + sw.js)
```

**Por que esta stack:** a pasta estava vazia e a máquina não tinha PostgreSQL/Docker. SQLite via
Prisma permite rodar já, com migração trivial para PostgreSQL. As regras críticas vivem em
`shared/`, então a interface mostra a mesma pré-validação que o servidor aplica de forma definitiva.

### Modelo de dados

`User 1—1 AthleteProfile`, `User 1—N WeightEntry`, `Activity`, `Championship 1—N Stage 1—N Game 1—1 GameStat`,
`Challenge 1—N ChallengeAttempt`, `Collective 1—1 CollectiveStat`, `WeeklyGoal`, `XpEntry` (livro-razão com
chave única), `Achievement`, `PushSubscription`. Todas as tabelas têm `userId` e todas as consultas filtram por ele.
Exclusões em cascata: campeonato → etapas → jogos → estatísticas; desafio → tentativas; conta → tudo.

## Regras de negócio implementadas

- **Janela retroativa de 24h** (`shared/src/time.ts → checkCompletion`): começa à meia-noite seguinte ao dia
  esportivo no fuso do atleta e dura exatamente 24h. Validada no servidor com o relógio do servidor
  (o horário do navegador é ignorado). Atividades futuras ou de hoje antes do horário de início não podem
  ser concluídas. Uma atividade concluída não pode ser movida para fora da janela.
- **Ofensiva**: dia ativo = ≥1 atividade elegível concluída (Descanso não conta). Vários registros no
  mesmo dia contam uma vez. Ausência de registro, “não realizada” confirmada e “planejada não registrada”
  são distinguidas em telas e relatórios.
- **Estatísticas**: 7 indicadores inteiros ≥ 0. Sem linha = não informado; campo nulo = indicador não
  informado; 0 = zero. Médias consideram apenas jogos realizados com o indicador informado. Nada é
  armazenado de forma agregada — tudo é recalculado a partir dos registros.
- **Desafios**: voltas = atual − anterior; tempo = anterior − atual (tempo economizado); % só quando a
  referência > 0. Recorde = estritamente melhor que todas as tentativas anteriores.
- **XP** (sem duplicidade — cada recompensa tem chave única e a sincronização é idempotente):
  atividade +10, tentativa +15, recorde +30, meta semanal +40, a cada 7 dias de ofensiva +50.
  Desfazer uma conclusão remove o XP. Conquistas são permanentes.
- **Idempotência de formulários**: criações enviam `clientId` (UUID); reenvios retornam o registro existente.
- **Dados de demonstração**: opcionais (onboarding ou Configurações), marcados `isDemo` e com selo DEMO,
  removíveis em um clique sem afetar dados reais.

## Histórico permanente e análise de evolução

- **Histórico:** cada tentativa e cada jogo é um registro independente; nada é sobrescrito. Editar a
  descrição ou arquivar um desafio preserva todas as tentativas. Exclusões pedem confirmação e
  recalculam os indicadores. Relatórios usam os mesmos registros e cálculos das telas.
- **Desafios:** histórico cronológico, gráfico, primeira/anterior/atual/melhor marca, diferença
  absoluta (“40s mais rápido”, “+2 voltas”), variação % e lista de recordes pessoais com datas.
- **Campeonatos:** totais, média por jogo, resultado de cada partida, evolução jogo a jogo, tabela por
  etapa e comparação entre campeonatos ou temporadas (inclui arquivados), sempre por média por jogo.
- **Comparar períodos** (`/evolution/compare`): semana × semana anterior, mês × mês anterior, mês ×
  mês escolhido, 1º × 2º semestre, temporada (ano) atual × anterior ou períodos livres. Mostra
  diferença absoluta e %, gráficos, e avisa quando as durações diferem: totais ficam “n/c” e a
  comparação usa médias por semana, por jogo e por tentativa. Períodos em andamento são cortados em hoje.
- **Pontos fortes e oportunidades** (`shared/src/insights.ts`): indicadores que melhoraram/pioraram,
  tendências, regularidade, frequência de treino, desafio com maior evolução e recordes. Regras de
  dados mínimos: tendência ≥ 4 registros; comparação de médias ≥ 2 jogos com o indicador em cada
  período e variação ≥ 20%; abaixo disso o app mostra “dados insuficientes” em vez de concluir.

## Lembretes e notificações

- Dentro do app: lembretes exibidos enquanto o app está aberto.
- Web Push: com permissão explícita (Configurações). Um agendador no servidor (a cada 30s) envia
  lembretes somente de atividades **planejadas**. Requer HTTPS em produção; no iPhone, o app precisa
  estar instalado na tela de início (iOS 16.4+).

## Testes

- `shared/test/rules.test.ts` (21): janela retroativa (virada de dia, fuso, horário de verão),
  ofensiva, estatísticas, comparação de desafios, durações, níveis.
- `shared/test/insights.test.ts` (10): tendência, regularidade, dados insuficientes, normalização por semana.
- `server/test/api.test.ts` (24): persistência após logout/login, isolamento entre atletas,
  janela retroativa no servidor, XP sem duplicidade, recorrência e lembretes, jogos/etapas com
  recálculo após edição/exclusão, validação de estatísticas, desafios de voltas e tempo, coletivos,
  geração real de PDF/XLSX, dados de demonstração, preservação do histórico ao editar/arquivar,
  comparação de temporadas e de períodos com durações diferentes, destaques da evolução.

## Limitações conhecidas

- Sem modo offline para escrita: o service worker guarda só a casca do app. Registros exigem conexão,
  o que garante que a janela de 24h use sempre o relógio do servidor.
- Login por e-mail/senha próprio (sem recuperação de senha por e-mail — exigiria um provedor SMTP).
- Push depende de HTTPS e do navegador; sem chaves VAPID em produção o servidor não inicia.
- Semana começa na segunda-feira.
