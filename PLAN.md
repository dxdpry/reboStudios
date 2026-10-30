# Agent Island — plano (nome provisório)

Ilha em pixel art onde cada **projeto** é uma construção e cada **sessão do Claude Code** é um colono que mostra ao vivo o que está fazendo.
É para uso pessoal, roda no navegador e é servido por um servidor local no PC. Já foi pensado para abrir no celular depois.

Decisões tomadas (2026-10-30): navegador + servidor local · tema ilha/colônia · só para mim · só Claude Code.

---

## 1. O que faz ser único

- **A ilha cresce com o trabalho.** Projeto novo = terreno desmatado. A construção evolui com as horas acumuladas (barraca → casa → oficina → torre).
- **Cada ferramenta tem um lugar na ilha**, e o colono anda até ele:

| Estado do agente (hook) | O colono... | Onde |
|---|---|---|
| Thinking (prompt enviado, sem ferramenta) | senta, balão "..." | porta da construção |
| Read / Grep / Glob | lê um livro | biblioteca |
| Edit / Write | martela a construção | canteiro do projeto |
| Bash / testes | trabalha na forja | oficina |
| WebSearch / WebFetch | olha na luneta | farol |
| Subagente | chegam barquinhos com ajudantes | cais |
| **Precisa de você** (PermissionRequest / Notification) | levanta bandeira vermelha, sino toca | cais, piscando |
| Terminou (Stop) | rede na praia / pescando | praia |
| Sessão encerrada (SessionEnd) | embarca e vai embora | barco |

- O ciclo de dia e noite segue a hora real. À noite as construções com agente trabalhando ficam com a janela acesa.
- O painel **"Precisa de você"** fica sempre visível por cima da ilha. É a parte útil, e a ilha é a camada divertida.

## 2. Arquitetura

```
Claude Code (CLI e app desktop)
   │  hooks (command, async: true)     statusLine (limites 5h/semana)
   ▼                                   ▼
hooks/emit.js ── POST 127.0.0.1:4848 ──► server/  (Node, sem dependências)
                                           ├─ state: sessões, projetos, eventos
                                           ├─ transcript reader: tokens/custo
                                           ├─ snapshot JSON (sobrevive a restart)
                                           └─ SSE /events ──► web/ (Canvas 2D)
                                                                navegador / celular
```

- **Hooks**: um único `emit.js` registrado em `~/.claude/settings.json` (hoje vazio) para SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Notification, Stop, SubagentStart/Stop, SessionEnd e PermissionRequest.
  - `async: true`, timeout de 1 s no POST, **sempre sai com 0**. Com o servidor desligado, o Claude Code nem percebe.
  - Valem para o CLI e para a aba Code do app desktop (mesmo settings, segundo a documentação).
- **Servidor**: `http` puro do Node. **SSE** em vez de WebSocket (zero dependências, reconecta sozinho, funciona no celular).
- **Tokens/custo**: lidos do `.jsonl` do transcript (`transcript_path` vem no hook). Conferido num arquivo real: cada linha de assistente tem `message.model` e `message.usage`. O formato não é documentado, então o parser precisa ser tolerante.
- **Limites de 5 h e semanal**: só existem no stdin do **statusLine** (`rate_limits.five_hour` e `seven_day`). Um script de statusline repassa esses números ao servidor. Hoje você não tem statusline configurada.
- **Privacidade**: prompts e comandos podem ter segredo. O servidor guarda só o resumo ("Bash: npm test", "Edit: api.ts"), corta o texto e escuta só `127.0.0.1`.

## 3. Fases

**F0 — prova (≈1 h)**: `emit.js` + servidor que só registra os eventos em log. Rodar sessões reais no CLI e no app desktop e confirmar:
- os payloads de cada evento;
- que o app desktop dispara os hooks;
- que nada fica lento.

**F1 — ilha viva (MVP)**:
- uma construção por projeto e um colono por sessão, andando entre os lugares da tabela;
- painel "Precisa de você" com som e notificação do navegador;
- lista de sessões com o projeto, o estado e há quanto tempo está assim.

**F2 — dados**:
- tokens e custo por sessão;
- "Meu dia" (tempo trabalhando, tempo esperando você);
- limites de 5 h e semanal pela statusline;
- crescimento das construções.

**F3 — celular**:
- acesso pela rede local ou Tailscale, com token de pareamento (nunca aberto sem autenticação);
- PWA instalável, com notificação push quando alguém levanta a bandeira.

**F4 — controlar (só depois de tudo testado)**:
- **Aprovar ou negar pela ilha** via hook `PermissionRequest`. O hook espera a sua decisão por alguns segundos e, se não houver resposta, devolve o controle ao prompt normal.
- **Mandar mensagem para a sessão**: pesquisar Remote Control e Channels (ainda em research preview).
- É a fase de maior risco: precisa de autenticação forte, porque aprovar comando é poder de executar coisas no PC.

### Resultado da F0 (2026-10-30)

Medido com o servidor rodando e os hooks instalados (Claude Code 2.1.277):
- **App desktop dispara os hooks**, e a sessão que já estava aberta passou a mandar eventos sem reiniciar.
- Funcionando: SessionStart, UserPromptSubmit, SessionEnd, PreToolUse, PostToolUse, PostToolUseFailure (com `error`), SubagentStart e SubagentStop.
- As ferramentas de um subagente chegam com `agent_id` e `agent_type` → dá para desenhar o ajudante separado do colono principal.
- Todo evento traz `session_id`, `cwd` e `transcript_path`. O `cwd` serve para agrupar por projeto.
- `UserPromptSubmit` também dispara quando o app injeta uma notificação de tarefa em segundo plano, não só quando você digita.
- Servidor desligado: `emit.js` sai com 0 em ~90 ms e, como é `async`, a sessão não espera.
- Entre o hook e o servidor: 3–5 ms.

Ainda sem teste:
- `Stop` (dispara no fim do turno);
- `Notification` e `PermissionRequest` (a sessão de teste estava em bypass, então não houve pedido de aprovação);
- sessão pelo CLI (`claude -p` falhou com "OAuth session expired").

### Resultado da F1 (2026-10-30)

O que funciona (testado no navegador com 5 sessões simuladas e 2 reais):
- **Ilha**:
  - construção por projeto, com o terreno fixo, guardado no navegador;
  - biblioteca, oficina com fumaça, farol, rede na praia, cais e coqueiros.
- **Colonos**:
  - andam até o lugar da ferramenta e fazem a pose (martelo, livro, luneta, aceno, balão "...");
  - ajudantes menores para os subagentes;
  - vão embora de barco quando a sessão acaba.
- **"Needs you"**: bandeira vermelha **no lugar onde o colono está** (mudei do cais: andar até lá atrasava o aviso), etiqueta vermelha com o comando, card no painel com o tempo de espera.
- **Alertas**: botão "Enable alerts" liga o sino (WebAudio) e a notificação do sistema; um "plim" quando alguém termina.
- **Lista**: colonos agrupados por projeto, com status, atividade, tempo e ajudantes. Clicar seleciona o colono.
- **Celular**: no layout de 375 px a ilha fica em cima, os painéis embaixo, sem rolagem lateral.

Ainda sem teste:
- o visual da noite (só a curva de horário foi testada);
- o som e a notificação de verdade (precisam do clique no botão).

Arte: sprites desenhados por código (`web/js/sprites.js`).

## 4. Riscos

- Hooks globais afetam **todas** as sessões. Por isso `async`, timeout curto e saída 0 sempre, e um interruptor para desligar tudo (`AGENT_ISLAND_OFF=1`).
- O formato do transcript pode mudar entre versões → parser tolerante, que ignora o que não reconhece.
- Arte em pixel art é o maior trabalho da F1 → ver decisão em aberto abaixo.

## 5. Em aberto

- **Nome** do projeto.
- **Arte**: sprites desenhados à mão por código (rápido e consistente, mais simples) ou gerados por IA e limpos (mais bonito, mais trabalho).
- **Pasta**: `C:\Users\LOW\Desktop\agent-island`, com git local.
- Texto da tela em inglês (código também), seguindo o padrão das regras.
