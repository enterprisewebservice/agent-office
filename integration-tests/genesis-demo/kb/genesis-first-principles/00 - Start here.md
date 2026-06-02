# 00 — Start here

## What you'll be able to do by the end
- Explain, without hand-waving, what "a model learns" actually *means*.
- Write the entire training loop of a predictive model from memory.
- Read the math `∂L/∂w` and point to the exact line of code it became.
- Look at the loss falling in the OpenShift AI **Experiments** view and say
  precisely what each number is doing.

## The whole story in six sentences
1. A model is a function with knobs: `ŷ = w·x + b`. The knobs are `w` and `b`.
   → [[01 - A model is a function with adjustable beliefs]]
2. We have examples `(x, y)` from a world with a hidden rule (`y = 2x + 1 + noise`).
   → [[02 - The data and the hidden truth]]
3. We need one number that says *how wrong* the current knobs are: the **loss**.
   → [[03 - Loss — making wrong measurable]]
4. From the loss we can compute, for each knob, *which way is downhill* — the **gradient**.
   → [[04 - Gradient descent — learning by going downhill]] and the hand
   derivation in [[05 - Deriving the gradients by hand]].
5. We take a small step downhill, again and again. That loop **is** learning.
   → [[06 - The training loop, line by line]]
6. We check it didn't just memorize: it predicts *unseen* points and recovers
   the hidden rule (`w → 2`, `b → 1`). → [[07 - Did it actually learn]]

Then the punchline: [[08 - This is all deep learning is]].

> [!question] Hold this question the whole way through
> "Where, exactly, does the knowledge live?" The answer is never mystical. It
> lives in the **values of the parameters**. Training is the process of moving
> those values from *ignorant* (`w=0, b=0`) to *informed* (`w≈2, b≈1`).
