# SlangBridge — AI slang-to-slang translator

MIS3011 · Advanced AI for Business · Fall 2026 · Group project
Amaya Garo · Faustine Lepauvre · Farida Benandrianina · Luc Zhan · Tiana Chérel-Robson

SlangBridge translates informal student messages between **Chinese, English and French** while keeping
the slang, tone and sarcasm. Paste a WeChat/WhatsApp message (and, optionally, the conversation around it),
pick the target language, who you are writing to, and an output mode:

| Mode | What you get |
|---|---|
| **Same Vibe** | slang → equivalent slang (`yyds` → "GOAT", `j'ai le seum` → "酸了") |
| **Neutral** | clear standard language, no slang, intent (incl. sarcasm) kept |
| **Explain** | translation + a card per slang term: literal meaning, real meaning, equivalent, usage |

Every translation is shown next to a **literal machine translation** (the baseline) so the difference is visible.

---

## Run it locally

Requirements: **Node.js 18+** (check with `node -v`) and an AI API key.

```bash
npm install
```

```bash
cp .env.example .env
```

Put your key in `.env` (`ANTHROPIC_API_KEY=...`, or the DeepSeek/Qwen option, see below), then:

```bash
npm start
```

Open http://localhost:3000. Without any key the app still runs in **dictionary-only mode** (slang
definitions from the database + baseline translation). Keep that as the demo backup plan.

### Choosing the AI provider

| Provider | Variables | Notes |
|---|---|---|
| Anthropic Claude (default) | `ANTHROPIC_API_KEY`, optional `CLAUDE_MODEL` (default `claude-opus-5-5`; cheaper: `claude-haiku-5-5`) | Structured JSON output, prompt caching, automatic fallback if a request is declined. **Not reachable from mainland China without a VPN.** |
| DeepSeek / Qwen / any OpenAI-compatible API | `LLM_PROVIDER=openai-compatible`, `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_MODEL` | Works from China. Example base URLs are in `.env.example`. |

Comparing two providers on the Evaluation page is a good "technology choice" argument for the report.

## Deploy it (make it accessible to others)

The app is one Node server (`node server.js`) with no build step, so any Node host works:

- **Render / Railway**: new Web Service → connect the GitHub repo → build `npm install`, start `npm start` →
  add the API key as an environment variable. You get a public URL.
- **Users in China**: `*.vercel.app` and some foreign hosts are blocked. A small Alibaba Cloud / Tencent Cloud
  server running `npm start` with the DeepSeek or Qwen provider is the most reliable option for a live demo
  in class. The UI loads no external fonts or CDNs, so it works behind the firewall.

Never commit `.env`. The server applies a per-IP rate limit (`RATE_LIMIT_PER_10MIN`, default 150) so a
public link cannot burn the API budget.

---

## Architecture

```
Browser (public/)                Node server (server.js)                   External
──────────────────               ─────────────────────────                 ────────
message, context,   ──POST──▶   /api/translate
mode, recipient                    │ 1. lib/glossary.js  retrieve slang terms found in the message
                                   │    (3,000+ entries: CIBuzzBench + team list)
                                   │ 2. lib/translate.js build grounded prompt
                                   │ 3. lib/llm.js       LLM call, JSON-schema output ──▶ Claude / DeepSeek / Qwen
result cards        ◀──JSON──     └─ translation, slang_items, tone, notes, warnings, confidence
                    ──POST──▶   /api/baseline   lib/baseline.js ───────────────────▶ MyMemory MT (baseline)
Evaluation page     ──POST──▶   /api/judge      lib/judge.js (LLM-as-judge, fixed anchors)
Slang database page ──GET───▶   /api/glossary   search over the knowledge base
```

Why this design (for the "Technology Selection" section):
- **No model training**: a general LLM already knows a lot of slang; the **retrieval step** grounds it on a
  curated database so rare, new or Chinese-specific terms are not hallucinated, and the team can add terms
  without retraining.
- **Structured output** (JSON schema): the UI always receives the same fields (slang cards, warnings, confidence).
- **Relationship-aware prompt**: slang is softened automatically when writing to a professor.
- **Baseline built in**: every result is compared with standard machine translation.

## Data

| File | Content | Source |
|---|---|---|
| `data/slang_zh_cibuzzbench.json` | 3,001 Chinese internet buzzwords: English meaning, English equivalent, Chinese explanation, category, harmful flag, train/test split | [CIBuzzBench](https://github.com/SuperYFan/CIBuzzBench) (built with `scripts/build_glossary.py` from `data/raw/cibuzzbench.csv`) |
| `data/slang_curated.json` | ~100 ZH / EN / FR slang terms with **cross-language equivalents** (number slang, pinyin abbreviations, French verlan/SMS, Gen-Z English) | Team curated — see sources below. **Luc should review every "Team curated" Chinese entry.** |
| `data/test_cases.json` | 16 realistic student messages with the team's reference meaning (sarcasm, context-dependent slang, formal recipient…) | Team written |

The CIBuzzBench repository does not state a license: cite it in the report and use it for academic purposes only.

### Slang sources found

Chinese → English
- **CIBuzzBench** (dataset, 3,001 terms, Chinese→English meaning + equivalent): https://github.com/SuperYFan/CIBuzzBench
- **SlangDIT** (paper + data, 25k English–Chinese sentence pairs containing slang, from subtitles): https://arxiv.org/abs/2505.14181 · https://github.com/XL2248/SlangDIT
- Wikipedia, *Chinese Internet slang*: https://en.wikipedia.org/wiki/Chinese_Internet_slang
- Migaku, *Chinese internet abbreviations (YYDS, XSWL, 520)*: https://migaku.com/blog/chinese/chinese-internet-abbreviations
- HSK Lord, *Chinese slang guide 2026* (50+ terms): https://hsklord.com/blog/chinese-slang-guide
- Go East Mandarin, *Chinese abbreviations & acronyms*: https://goeastmandarin.com/chinese-abbreviations-acronyms/
- Classy Mandarin, *REDnote abbreviations*: https://classymandarin.substack.com/p/before-you-using-rednote-master-these
- LingoAce, *Chinese number slang*: https://www.lingoace.com/blog/chinese-number-slang/
- The Chairman's Bao, *Chinese number slang*: https://www.thechairmansbao.com/?p=5297337
- Shanghai government, *Must-know Chinese internet slang abbreviations*: https://english.shanghai.gov.cn/en-LearnChinese/20240918/78e8049ddc2044fab5f4134ee4bf7ea4.html

French / English
- Wiktionnaire (argot, verlan, SMS): https://fr.wiktionary.org/
- Superprof, *expressions de jeunes*: https://www.superprof.fr/blog/definition-expression-de-jeune/
- techno-science.net, *Liste de termes d'argot Internet*: https://www.techno-science.net/fr/definitions/liste-de-termes-d-argot-internet
- Merriam-Webster, *slang & trending words*: https://www.merriam-webster.com/slang

---

## Evaluation (Evaluation tab)

1. **Realistic student messages** — 16 cases. Baseline (MyMemory) vs SlangBridge (Same Vibe). An LLM judge
   scores each output against the team's reference meaning: *meaning* 0–2, *slang & tone* 0–2,
   *naturalness* 0–2 (total /6). Every score can be corrected by hand; export to CSV for the report.
2. **CIBuzzBench benchmark** — 10/20/50 random entries from the dataset's **test split**. Three systems:
   baseline MT, AI without glossary, AI + glossary. Test entries are excluded from retrieval, so the
   glossary cannot leak the answer. Score: 1 / 0.5 / 0 against the gold meaning.

The ablation "AI without glossary vs AI + glossary" is the change-the-evaluation-caused evidence the final
report asks for: run it, then improve the glossary or the prompt and run it again.

### Early evidence (measured 11 Nov 2026, baseline only)

Real MyMemory outputs for our test cases — this is what students get today:

| Message | Literal machine translation |
|---|---|
| 今天的讲座真的绝绝子，教授yyds！ | Today's lecture is truly absolute, Professor yyds! |
| 我真的会谢，ddl前一晚电脑崩了，直接破防了😭 | I really appreciate it. The ddl computer crashed the other night, and it directly broke the defenses. |
| 这学期太卷了，我决定躺平了 | This semester is too rolling, I decided to lie down |
| 芭比Q了 (after "how did the interview go?") | Barbie Q's |
| 你可真行啊，又迟到了 (sarcastic) | You're doing great. You're late again. |
| No cap, that party was lowkey fire 🔥 we should link up again fr | 没有帽子，那个派对是低调的火，🔥我们应该再联系一次 |
| Wesh, t'es chaud ce soir ? On se fait un grec, c'est moi qui régale | 哇，你今晚热吗？我们做一个希腊人，我喜欢 |
| Bro the exam was mid, I'm not stressing it | Frère, l'examen était au milieu, je ne le souligne pas |

On CIBuzzBench test entries the baseline was literal every time (e.g. 法拉利老了还是法拉利 → "Is Ferrari old
or is it Ferrari?", gold: "aging like fine wine"). **The AI columns still have to be run with a real API key.**

## Limitations & responsible use

- Messages go to the AI provider and to MyMemory; nothing is stored by our server. Ask users to remove names.
- Slang is local and changes fast; the app shows a confidence level and warnings, and should not be trusted
  for sensitive or formal communication.
- 427 CIBuzzBench entries are flagged harmful (insults, sexual content…); they are kept so the app can warn
  users, and are excluded from the benchmark sample.
- The judge is an LLM (possible self-preference bias): report manual-checked scores and say so.

## Project structure

```
server.js              HTTP server + API routes (no framework)
lib/glossary.js        knowledge base loading, retrieval, search, benchmark sampling
lib/translate.js       prompt, JSON schema, dictionary-only fallback
lib/llm.js             provider abstraction (Claude SDK / OpenAI-compatible)
lib/baseline.js        MyMemory baseline
lib/judge.js           LLM-as-judge with scoring anchors
public/                web UI (index.html, styles.css, app.js)
data/                  slang databases and test cases
scripts/build_glossary.py
```
