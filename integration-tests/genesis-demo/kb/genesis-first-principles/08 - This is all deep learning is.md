# 08 — This is all deep learning is

You now understand the complete machinery of a learning model. Here's the part
that feels like a trick: **a large neural network — including a large language
model — is the same five beats, scaled.** Nothing new is added in kind.

## The one-to-one mapping
| Genesis (this vault) | A deep network / LLM |
|---|---|
| 2 parameters: `w`, `b` | billions of parameters (still just numbers) |
| `ŷ = w·x + b` | many such lines, stacked in **layers**, with a **nonlinearity** between them so they can bend |
| MSE loss ([[03 - Loss — making wrong measurable\|note 03]]) | a loss too (cross-entropy for "predict the next token") |
| `∂L/∂w`, `∂L/∂b` by hand ([[05 - Deriving the gradients by hand\|note 05]]) | the same chain rule, automated through every layer = **backpropagation** |
| `w -= lr * dw` ([[04 - Gradient descent — learning by going downhill\|note 04]]) | the **same** update rule, applied to billions of params at once |
| the training loop ([[06 - The training loop, line by line\|note 06]]) | the **same** loop, over batches, for a long time on many GPUs |
| `w → 2, b → 1` | weights that encode grammar, facts, reasoning patterns |

## What scaling actually adds
1. **More parameters** → capacity to represent richer functions than a line.
2. **Nonlinearity** (a squiggle like ReLU between layers) → the model can bend,
   so stacked linear pieces don't just collapse back into one line.
3. **A smarter input representation** (e.g. turning words into vectors) → so `x`
   can be a sentence, not a single number.
4. **Batches + lots of compute** → because billions of nudges over trillions of
   examples is a lot of arithmetic.

That's it. Every one of those is a *quantitative* change. The *qualitative*
thing — predict, measure wrongness, find downhill, step, repeat — is exactly
what you watched a straight line do.

> [!quote] The whole of it
> "There is nothing else under the hood of the giant models — only more
> parameters and more steps." — the comment in `train_gd`, and it is literally
> true.

## Why this matters for *governed* agents
The platform this KB lives in treats a model the way it treats any other
artifact: built by a reproducible pipeline, its learning **recorded** (the loss
curve + recovered parameters in the OpenShift AI Experiments view), and its
result **registered** and auditable. Understanding the five beats is what lets
you *trust* — and govern — what the bigger models are doing, instead of treating
them as magic.

→ Go make it happen: [[10 - Run it yourself]] · Terms: [[09 - Glossary]]
