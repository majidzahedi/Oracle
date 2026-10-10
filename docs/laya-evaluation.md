# Laya / TypeSafe Jev for structured AI output

Evaluated: [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya) at
`68804629` (v0.4.2, Apache-2.0), and TypeSafe's hosted **Jev** API, which Laya
mirrors (same `POST /v1/systemone` protocol and answer format).

## What it is

A non-autoregressive "System 1" **decision model**: given a text `state` and a
set of questions, it returns typed answers in one forward pass (~33 ms on GPU):

| Question type | Answer |
|---|---|
| `choice` | one label from a fixed set, with probabilities |
| `score` | a value on a described scale |
| `noul` | probability that the answer is yes |

It **cannot write free text**. Its JSON-schema helper (`decide`) accepts only
enums, booleans and bounded integers; strings, arrays and nested objects are
rejected. Persian (Arabic script) is routed to the `laya-multilingual`
checkpoint; Persian accuracy is not reported in its benchmarks.

## Where the game needs structured AI output

| Use | Output | Laya/Jev fit |
|---|---|---|
| Oracle night messages, Whisper, Mercy, Lie Detector wording | free text + claim | **No**: needs generated text |
| Bot chat lines | free text | **No** |
| Verifier: "does this text state its claim, its negation, or neither?" | 3-way choice over a text | **Yes**: a `choice` question; much faster and cheaper than the second LLM call we make today |
| Bots reading the table: "does this chat line accuse someone? who?" | choice / yes-no over text | **Yes**: could feed the bots' suspicion scores |
| Bot decisions (cards, votes, Pact) | choice, but driven by game state, not by reading text | Possible, but a poor fit: these are numeric/strategic, where the heuristics and the LLM do better |
| Oracle's Pact decision | choice over hidden state | Poor fit, same reason |

## Integration options

1. **HTTP (recommended):** one client for `POST /v1/systemone` works with both
   self-hosted `laya-serve` (Python, Docker compose files in the repo) and
   TypeSafe's hosted Jev (API key). It would be another provider kind in the
   admin dashboard, used only for the verifier and chat-reading.
2. **In-process TypeScript (`laya-ts`):** ONNX via `onnxruntime-node`, but it
   is not published on npm (v0.1.0 in the repo only), and Bun compatibility
   of `onnxruntime-node` is untested here. Not recommended yet.

## Caveats

- Young project (0.x, frequent releases; the 0.4.1 TypeScript tree did not
  parse). Pin a version.
- Weights come from Hugging Face; not reachable from this build environment,
  so nothing here was run against a real model.
- Accuracy drops on many-option questions (>20); our questions have 2–4.
- Confidence numbers differ between Laya and Jev; thresholds don't transfer.

## Recommendation

Keep the LLM for everything that writes text. Optionally add a "decision
engine" profile (Laya or Jev over HTTP) used for the claim verifier and for
bots' chat reading, falling back to the LLM when it isn't configured.
